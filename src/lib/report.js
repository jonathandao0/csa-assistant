import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import {
  PRIORITIES,
  PRIORITY_WEIGHT,
  TICKET_STATUS,
  formatDateRange,
  tagCounts,
  ticketChains,
} from './logic.js';
import { dockerNames } from './dockerNames.js';

const FONT = 'Calibri';
const BLUE = '0B5CAD';
const TABLE_WIDTH = 9360; // US Letter with 1" margins
const border = { style: BorderStyle.SINGLE, size: 4, color: 'C9D1D9' };
const borders = { top: border, bottom: border, left: border, right: border };

const priorityLabel = Object.fromEntries(PRIORITIES);

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    ...opts,
    children: [new TextRun({ text, font: FONT, size: 22, ...(opts.run ?? {}) })],
  });
}

function bullet(runs) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    spacing: { after: 60 },
    children: (Array.isArray(runs) ? runs : [runs]).map((r) =>
      typeof r === 'string' ? new TextRun({ text: r, font: FONT, size: 22 }) : r,
    ),
  });
}

function heading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({ heading: level, spacing: { before: 280, after: 120 }, children: [new TextRun(text)] });
}

function table(columns, rows) {
  const widths = columns.map((c) => c.width);
  const cell = (text, width, header) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      borders,
      shading: header ? { fill: 'E6EEF7', type: ShadingType.CLEAR, color: 'auto' } : undefined,
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      children: [
        new Paragraph({
          children: [new TextRun({ text: String(text ?? ''), font: FONT, size: 20, bold: !!header })],
        }),
      ],
    });
  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: columns.map((c) => cell(c.label, c.width, true)) }),
      ...rows.map((r) => new TableRow({ children: r.map((v, i) => cell(v, widths[i])) })),
    ],
  });
}

function difficultyScore(chain) {
  const events = new Set(chain.map((t) => t.eventKey)).size;
  const weight = chain.reduce((s, t) => s + PRIORITY_WEIGHT[t.priority], 0);
  const unresolved = chain.some((t) => t.status === 'unresolved') ? 2 : 0;
  return chain.length * 3 + weight + (events - 1) * 3 + unresolved;
}

const time = (ms) =>
  new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Team labelling for the report. Anonymized, every team number becomes a random Docker-style
 *  name ("focused_lovelace"), nicknames are dropped, and team numbers or nicknames that turn
 *  up inside ticket text are swapped for the same name. */
function teamLabeller(event, allTickets, anonymize) {
  const nickname = Object.fromEntries(event.teams.map((t) => [t.number, t.nickname]));
  if (!anonymize) {
    return {
      team: (n) => `Team ${n}`,
      id: (n) => String(n),
      withNick: (n) => `Team ${n}${nickname[n] ? ` (${nickname[n]})` : ''}`,
      scrub: (text) => text,
    };
  }
  const numbers = [...new Set([...event.teams.map((t) => t.number), ...allTickets.map((t) => t.team)])];
  const names = dockerNames(numbers);
  // Nicknames long enough not to match ordinary words, longest first so "Robo Rams 2" wins
  // over "Robo Rams". One combined pattern replaced in a single pass, so an inserted name is
  // never re-matched by a later swap.
  const byNick = new Map();
  for (const n of numbers) {
    const nick = nickname[n]?.trim();
    if (nick && nick.length >= 4 && !/^\d+$/.test(nick)) byNick.set(nick.toLowerCase(), names.get(n));
  }
  const nickAlts = [...byNick.keys()].sort((x, y) => y.length - x.length).map(escapeRe);
  const pattern = new RegExp(
    `${nickAlts.length ? `(?<!\\w)(${nickAlts.join('|')})(?!\\w)|` : ''}(?<![\\w.])(?:frc)?(\\d{1,6})(?![\\w.])`,
    'gi',
  );
  const swap = (match, nick, num) =>
    nick ? byNick.get(nick.toLowerCase()) : names.get(Number(num)) ?? match;
  // With no nickname group, the number is the first capture.
  const replacer = nickAlts.length ? swap : (match, num) => swap(match, undefined, num);
  return {
    team: (n) => names.get(n),
    id: (n) => names.get(n),
    withNick: (n) => names.get(n),
    scrub: (text) => (text ? text.replace(pattern, replacer) : text),
  };
}

/** Builds the event summary as a .docx Blob. With `anonymize`, team identities are replaced
 *  by random Docker-style names (see teamLabeller). */
export async function buildEventReport(event, eventTickets, allTickets, { anonymize = false } = {}) {
  const allById = Object.fromEntries(allTickets.map((t) => [t.id, t]));
  const label = teamLabeller(event, allTickets, anonymize);
  const tickets = [...eventTickets].sort((a, b) => a.createdAt - b.createdAt);

  const count = (s) => tickets.filter((t) => t.status === s).length;
  const teamsHelped = new Set(tickets.map((t) => t.team)).size;
  const tags = tagCounts(tickets);

  // Most difficult / recurring: the highest-scoring chain of linked tickets that touches this event.
  const chains = ticketChains(tickets, allById);
  const ranked = chains.map((c) => ({ chain: c, score: difficultyScore(c) })).sort((a, b) => b.score - a.score);
  const top = ranked[0];

  const repeatTeams = Object.entries(
    tickets.reduce((acc, t) => ({ ...acc, [t.team]: (acc[t.team] ?? 0) + 1 }), {}),
  )
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1]);

  const children = [
    new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({ text: `CSA event report${anonymize ? ' (anonymized)' : ''}`, font: FONT, size: 40, bold: true, color: BLUE }),
      ],
    }),
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: event.name, font: FONT, size: 28, bold: true })],
    }),
    p(
      `${event.key} · ${formatDateRange(event.startDate, event.endDate)} · ${[event.city, event.stateProv]
        .filter(Boolean)
        .join(', ')}`,
      { run: { color: '5B6875' } },
    ),
    ...(anonymize
      ? [p('Team numbers and names are replaced with random placeholder names that change with every export.', { run: { color: '5B6875', italics: true } })]
      : []),
    p(`Prepared ${new Date().toLocaleString()}`, {
      run: { color: '5B6875' },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BLUE, space: 4 } },
    }),

    heading('Summary'),
    p(
      tickets.length
        ? `${tickets.length} ticket${tickets.length === 1 ? ' was' : 's were'} logged for ${teamsHelped} team${
            teamsHelped === 1 ? '' : 's'
          } out of ${event.teams.length} attending. ${count('resolved')} resolved, ${count(
            'declined',
          )} declined help, and ${count('unresolved')} still unresolved or being watched at the time of this report.`
        : 'No tickets were logged for this event.',
    ),
    table(
      [
        { label: 'Measure', width: 6360 },
        { label: 'Count', width: 3000 },
      ],
      [
        ['Tickets logged', tickets.length],
        ['Teams assisted', teamsHelped],
        ['Resolved', count('resolved')],
        ['Declined help', count('declined')],
        ['Unresolved / watching', count('unresolved')],
        ...PRIORITIES.map(([k, l]) => [`${l} priority`, tickets.filter((t) => t.priority === k).length]),
      ],
    ),

    heading('Most common issues'),
  ];

  if (tags.length) {
    children.push(
      table(
        [
          { label: 'Issue tag', width: 5360 },
          { label: 'Tickets', width: 2000 },
          { label: 'Teams', width: 2000 },
        ],
        tags.map(([tag, n]) => [tag, n, new Set(tickets.filter((t) => t.tags?.includes(tag)).map((t) => t.team)).size]),
      ),
    );
  } else {
    children.push(p('No tags were recorded on tickets.'));
  }

  children.push(heading('Most difficult or recurring issue'));
  if (top) {
    const c = top.chain;
    const teams = [...new Set(c.map((t) => t.team))];
    const events = [...new Set(c.map((t) => t.eventName || t.eventKey))];
    children.push(
      p(
        c.length > 1
          ? `${teams.map(label.team).join(', ')} had ${c.length} linked tickets${
              events.length > 1 ? ` across ${events.length} events (${events.join('; ')})` : ''
            }. The chain is listed oldest first.`
          : `${label.withNick(teams[0])} had the highest-priority issue of the event.`,
      ),
    );
    for (const t of c) {
      children.push(
        bullet([
          new TextRun({ text: label.scrub(t.title), font: FONT, size: 22, bold: true }),
          new TextRun({
            text: ` — ${t.eventKey}, ${time(t.createdAt)}, ${priorityLabel[t.priority]} priority, ${
              TICKET_STATUS[t.status].short
            }${t.tags?.length ? `, tags: ${t.tags.join(', ')}` : ''}`,
            font: FONT,
            size: 22,
          }),
        ]),
      );
      if (t.description) children.push(p(`Issue: ${label.scrub(t.description)}`, { indent: { left: 720 } }));
      if (t.resolution) children.push(p(`Resolution: ${label.scrub(t.resolution)}`, { indent: { left: 720 } }));
    }
  } else {
    children.push(p('No tickets to evaluate.'));
  }

  if (repeatTeams.length) {
    children.push(heading('Teams with repeat tickets', HeadingLevel.HEADING_2));
    for (const [team, n] of repeatTeams) {
      children.push(bullet(`${label.withNick(Number(team))}: ${n} tickets`));
    }
  }

  const open = tickets.filter((t) => t.status === 'unresolved');
  children.push(heading('Still unresolved at report time', HeadingLevel.HEADING_2));
  if (open.length) {
    for (const t of open) {
      children.push(bullet(`${label.team(t.team)}: ${label.scrub(t.title)} (${priorityLabel[t.priority]} priority)`));
    }
  } else {
    children.push(p('None.'));
  }

  children.push(heading('Ticket log'));
  if (tickets.length) {
    children.push(
      table(
        [
          { label: 'Time', width: 1400 },
          { label: 'Team', width: anonymize ? 1800 : 900 },
          { label: 'Issue', width: anonymize ? 2160 : 3060 },
          { label: 'Tags', width: 1800 },
          { label: 'Priority', width: 1000 },
          { label: 'Status', width: 1200 },
        ],
        tickets.map((t) => [
          time(t.createdAt),
          label.id(t.team),
          label.scrub(t.title) + (t.lastMatch ? ` (after ${t.lastMatch})` : ''),
          (t.tags ?? []).join(', '),
          priorityLabel[t.priority],
          TICKET_STATUS[t.status].short,
        ]),
      ),
    );
  } else {
    children.push(p('No tickets logged.'));
  }

  const doc = new Document({
    creator: 'CSA Assistant',
    title: `CSA report – ${event.name}${anonymize ? ' (anonymized)' : ''}`,
    styles: {
      default: { document: { run: { font: FONT, size: 22 } } },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 30, bold: true, font: FONT, color: BLUE },
          paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 25, bold: true, font: FONT },
          paragraph: { spacing: { before: 220, after: 100 }, outlineLevel: 1 },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 540, hanging: 270 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBlob(doc);
}
