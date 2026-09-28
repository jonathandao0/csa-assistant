import { db } from './db.js';
import { lastPlayedMatch, matchLabel } from './logic.js';

// Builds two fake events sharing a team roster, entirely offline, so the UI — including
// cross-event team history — can be exercised without TBA/Nexus keys. Only ever surfaced
// behind import.meta.env.DEV (see pages/Settings.jsx).
const TEAM_COUNT = 24;
const ROWS = ['A', 'B', 'C', 'D'];
// Deliberately far above any real FRC team number (they're only in the low 10,000s), so
// demo teams can never be confused with — or pull TBA photos/data for — a real team.
const FIRST_TEAM = 99101;
export const DEMO_EVENT_KEYS = ['2026demo', '2026demo2'];

function buildTeams() {
  return Array.from({ length: TEAM_COUNT }, (_, i) => ({
    number: FIRST_TEAM + i,
    nickname: `Demo Team ${FIRST_TEAM + i}`,
    name: `Demo Team ${FIRST_TEAM + i} Robotics`,
    schoolName: 'Sample High School',
    city: 'Anytown',
    stateProv: 'CA',
    country: 'USA',
    rookieYear: 2012 + (i % 12),
    website: '',
  }));
}

// A real qual schedule plays each team ~10-12 times, not once — a thin schedule was hiding
// bugs in anything that lists "this team's matches" (like the ticket form's match picker).
function buildMatches(key, teams, dayOffsetSec) {
  const matchCount = Math.round((teams.length * 11) / 6);
  const matches = [];
  const baseSec = Math.floor(Date.now() / 1000) + dayOffsetSec;
  for (let matchNumber = 1; matchNumber <= matchCount; matchNumber++) {
    const group = [...teams].sort(() => Math.random() - 0.5).slice(0, 6).map((t) => t.number);
    const time = baseSec + matchNumber * 480;
    matches.push({
      key: `${key}_qm${matchNumber}`,
      compLevel: 'qm',
      setNumber: 1,
      matchNumber,
      red: group.slice(0, 3),
      blue: group.slice(3, 6),
      redScore: -1,
      blueScore: -1,
      time,
      predictedTime: time,
      actualTime: null,
      played: false,
    });
  }
  // Mark an early chunk as already played so match history/last-match has data too.
  const playedCount = Math.min(16, matches.length);
  matches.slice(0, playedCount).forEach((m, i) => {
    m.played = true;
    m.actualTime = baseSec - (playedCount - i) * 480;
    m.redScore = 42 + i * 6;
    m.blueScore = 38 + i * 4;
  });
  return matches;
}

function buildPitMap(teams) {
  const pits = {};
  const pitAddressByTeam = {};
  teams.forEach((t, i) => {
    const row = ROWS[Math.floor(i / 6)];
    const col = (i % 6) + 1;
    const address = `${row}${col}`;
    pits[address] = {
      position: { x: 100 + col * 140, y: 100 + ROWS.indexOf(row) * 150 },
      size: { x: 118, y: 100 },
      team: t.number,
    };
    pitAddressByTeam[t.number] = address;
  });
  const map = {
    size: { x: 140 + 6 * 140, y: 100 + ROWS.length * 150 },
    pits,
    areas: {
      a1: { position: { x: 140 + 6 * 140 - 90, y: 40 }, size: { x: 160, y: 60 }, label: 'Queue' },
    },
    labels: {},
    arrows: {},
    walls: {},
  };
  return { map, pitAddressByTeam };
}

function buildReadiness(key, teams) {
  return teams.map((t, i) => {
    const mod = i % 5;
    return {
      id: `${key}:${t.number}`,
      eventKey: key,
      team: t.number,
      radio: mod !== 0,
      inspection: mod >= 2,
      field: mod >= 3,
      ignored: i === teams.length - 1,
      notes: i === 3 ? 'Drive coach asked us to keep an eye on their swerve modules — looked loose in practice.' : '',
      updatedAt: Date.now(),
    };
  });
}

/** Builds one event's ticket set. `linked` optionally injects one ticket that links to a
 *  ticket at the other demo event, to show a continuing issue spanning events. `seq` is this
 *  event's position in each affected team's ticket history (1 = the older/District event). */
function buildTickets(key, eventName, teams, matches, linked, seq, withRepeats) {
  const samples = [
    { id: `${key}-t0`, team: teams[2].number, title: 'Robot browns out mid-match', tags: ['Brownout / power', 'Battery'], priority: 'high', status: 'unresolved' },
    { id: `${key}-t1`, team: teams[8].number, title: 'Intermittent CAN bus errors', tags: ['CAN bus'], priority: 'normal', status: 'resolved' },
    { id: `${key}-t2`, team: teams[11].number, title: 'Driver station shows code error', tags: ['Code', 'Driver Station'], priority: 'normal', status: 'declined' },
    { id: `${key}-t3`, team: teams[14].number, title: 'Systemcore will not image', tags: ['Systemcore', 'Firmware / imaging'], priority: 'high', status: 'unresolved' },
    { id: `${key}-t4`, team: teams[17].number, title: 'Noticed smoke smell after match, unconfirmed', tags: ['Follow-up'], priority: 'normal', status: 'unresolved' },
    { id: `${key}-t5`, team: teams[20].number, title: 'Intake jams on angled game pieces', tags: ['Mechanical', 'Sensors'], priority: 'normal', status: 'unresolved' },
  ];
  if (linked) samples.push(linked.ticket);
  // One team with a run of tickets over several matches, so the team page's
  // "Issues by match" chart has more than a single bar to show.
  if (withRepeats) {
    const team = teams[2].number;
    const played = matches.filter((m) => m.played && (m.red.includes(team) || m.blue.includes(team)));
    const early = [
      { title: 'Robot disabled for a few seconds in auto', tags: ['Field connection', 'Radio'], priority: 'normal', status: 'resolved' },
      { title: 'Brownout again, low battery voltage at match start', tags: ['Brownout / power', 'Battery'], priority: 'high', status: 'resolved' },
    ];
    const repeats = early.filter((_, i) => played[i + 1]);
    // Earlier tickets take the lower numbers; the main sample ticket comes last.
    repeats.forEach((t, i) => {
      samples.push({ ...t, id: `${key}-r${i}`, team, lastMatch: matchLabel(played[i]), seqOffset: i, createdAt: Date.now() - (8 - i) * 3600_000 });
    });
    samples[0].seqOffset = repeats.length;
  }

  // Each ticket's "last match" reflects that team's actual schedule, so the ticket form's
  // match dropdown has real, varied entries to show instead of one hardcoded value.
  const lastMatchFor = (team) => {
    const m = lastPlayedMatch({ matches }, team);
    return m ? matchLabel(m) : '';
  };

  return samples.map((s) => ({
    id: s.id,
    seq: seq + (s.seqOffset ?? 0),
    eventKey: key,
    eventName,
    team: s.team,
    title: s.title,
    description: s.id === `${key}-t4` ? 'Saw a puff of smoke from the electronics board during Q3 but didn\'t get to talk to the team before they left the field.' : 'Sample ticket generated by dev mode for UI preview.',
    status: s.status,
    priority: s.priority,
    tags: s.tags,
    lastMatch: s.lastMatch ?? lastMatchFor(s.team),
    resolution: s.status === 'resolved' ? 'Reseated the connector and re-ran the match.' : '',
    links: s.links ?? [],
    createdAt: s.createdAt ?? Date.now() - Math.random() * 5 * 3600_000,
    updatedAt: Date.now() - Math.random() * 2 * 3600_000,
    resolvedAt: s.status === 'resolved' ? Date.now() - 1800_000 : null,
  }));
}

async function buildEvent({ key, name, shortName, startDate, endDate, eventType, teams, dayOffsetSec, linked, ticketSeq }) {
  const matches = buildMatches(key, teams, dayOffsetSec);
  const { map, pitAddressByTeam } = buildPitMap(teams);

  const event = {
    key,
    name,
    shortName,
    year: 2026,
    eventType,
    eventTypeString: eventType === 1 ? 'District' : 'Regional',
    startDate,
    endDate,
    city: 'Anytown',
    stateProv: 'CA',
    country: 'USA',
    teams,
    matches,
    nexus: {
      enabled: true,
      map,
      pits: pitAddressByTeam,
      live: { nowQueuing: 'Qualification 4', matches: [] },
      inspection: {},
      error: null,
    },
    dayOverride: null,
    addedAt: Date.now(),
    fetchedAt: Date.now(),
  };

  await db.put('events', event);
  await Promise.all(buildReadiness(key, teams).map((r) => db.put('readiness', r)));
  const tickets = buildTickets(key, shortName, teams, matches, linked, ticketSeq, ticketSeq === 2);
  await Promise.all(tickets.map((t) => db.put('tickets', t)));
  return event;
}

/** Deletes the demo events plus every ticket and readiness record that belongs to them
 *  (including ones left over from an older demo roster). */
export async function removeDemoData() {
  const keys = new Set(DEMO_EVENT_KEYS);
  const [tickets, readiness] = await Promise.all([db.all('tickets'), db.all('readiness')]);
  for (const t of tickets) if (keys.has(t.eventKey)) await db.del('tickets', t.id);
  for (const r of readiness) if (keys.has(r.eventKey)) await db.del('readiness', r.id);
  for (const k of keys) await db.del('events', k);
}

/** Wipes any existing demo events and reseeds two fake events sharing a roster, so the
 *  team-page History section (continuing issues + prior-event summaries) has data to show. */
export async function seedDevEvent() {
  await removeDemoData();
  const teams = buildTeams();
  const linkedTeam = teams[5].number;

  // A team with the same radio problem at both events — shows up as a continuing issue.
  const firstLinkId = 'demo1-radio-chain';
  const secondLinkId = 'demo2-radio-chain';

  const day = 86400;
  await buildEvent({
    key: '2026demo2',
    name: 'Demo District Event (fake data)',
    shortName: 'Demo District',
    startDate: new Date(Date.now() - 14 * day * 1000).toISOString().slice(0, 10),
    endDate: new Date(Date.now() - 12 * day * 1000).toISOString().slice(0, 10),
    eventType: 1,
    teams,
    dayOffsetSec: -14 * day,
    ticketSeq: 1,
    linked: {
      ticket: {
        id: secondLinkId,
        team: linkedTeam,
        title: 'Radio drops after hard hits',
        tags: ['Radio'],
        priority: 'high',
        status: 'resolved',
        links: [firstLinkId],
      },
    },
  });

  const event1 = await buildEvent({
    key: '2026demo',
    name: 'Demo Regional (fake data)',
    shortName: 'Demo Regional',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 2 * day * 1000).toISOString().slice(0, 10),
    eventType: 0,
    teams,
    dayOffsetSec: 0,
    ticketSeq: 2,
    linked: {
      ticket: {
        id: firstLinkId,
        team: linkedTeam,
        title: 'Same radio issue as last event',
        tags: ['Radio'],
        priority: 'high',
        status: 'unresolved',
        links: [secondLinkId],
      },
    },
  });

  return event1;
}
