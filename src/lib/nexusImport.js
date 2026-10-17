import { autoTags } from './logic.js';

// Turns a message FRC Nexus posted to a CSA Slack channel (copied and pasted into the app)
// into a ticket draft. The main format, confirmed from a real message, is one line:
//
//   FTA request for team 6560: CAN issues many many and didn’t move all match
//
// (handled by parseRequestLine). Two older, approximate formats are also accepted:
//
//   Team 9999 has requested help with the following:
//   Networking connection issues
//   Programming - java
//
//   An FTA has requested a CSA to follow up with team 9999
//   FTA notes:
//   The team had brownout issues
//
// Because the wording may drift, nothing depends on an exact sentence: it looks for a team
// number, a "...:" header followed by lines (the issues or the FTA's notes), a pit and a
// match anywhere in the text. The result is always shown for review before anything is saved.

/** Removes Slack formatting from pasted text: <url|label> links, *bold*, _italic_, ~strike~,
 *  `code`, :emoji: shortcodes, and the "APP" / timestamp line Slack adds when copying. */
export function cleanSlackText(raw) {
  return String(raw ?? '')
    .replace(/<(?:https?:\/\/|mailto:)[^|>]*\|([^>]+)>/g, '$1')
    .replace(/<((?:https?:\/\/|mailto:)[^>]+)>/g, '$1')
    .replace(/<[#@!][^|>]*\|([^>]+)>/g, '$1')
    .replace(/:[a-z0-9_+-]+:/gi, '')
    .replace(/(^|\s)[*_~`]+(?=\S)|(?<=\S)[*_~`]+(?=\s|$|[.,;:!?)])/gm, '$1')
    .replace(/^.*\b(?:APP|BOT)\s+\d{1,2}:\d{2}(?:\s*[AP]M)?\s*$/gim, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/^ +| +$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Keyword → tag rules live in logic.js (shared with the ticket form's auto-tagging).
export const tagsFor = autoTags;

/** Nexus match names → the labels used everywhere else in the app (see matchLabel). */
function matchFrom(text) {
  const rules = [
    [/\b(?:qualification|qual)s?\s*(?:match\s*)?#?\s*(\d+)/i, (n) => `Q${n}`],
    [/\bQ\s?(\d{1,3})\b/, (n) => `Q${n}`],
    [/\bplayoffs?\s*(?:match\s*)?#?\s*(\d+)/i, (n) => `M${n}`],
    [/\bfinals?\s*(?:match\s*)?#?\s*(\d+)/i, (n) => `F${n}`],
    [/\bpractice\s*(?:match\s*)?#?\s*(\d+)/i, (n) => `Practice ${n}`],
  ];
  for (const [re, fmt] of rules) {
    const m = re.exec(text);
    if (!m) continue;
    // A match mentioned as "next"/"queuing"/"upcoming" isn't the last one they played.
    const before = text.slice(Math.max(0, m.index - 24), m.index).toLowerCase();
    return { label: fmt(m[1]), upcoming: /next|upcoming|queu|scheduled/.test(before) };
  }
  return null;
}

function teamFrom(text, event) {
  const roster = new Set((event?.teams ?? []).map((t) => t.number));
  const explicit = [
    /\bteam\s*#?\s*(\d{1,5})\b/i,
    /\bfrc\s?(\d{1,5})\b/i,
    /#(\d{1,5})\b/,
  ];
  for (const re of explicit) {
    const m = re.exec(text);
    if (m) return Number(m[1]);
  }
  // Otherwise the first bare number that's actually on this event's roster.
  for (const m of text.matchAll(/(?<![\w.#])(\d{1,5})(?![\w.])/g)) {
    if (roster.has(Number(m[1]))) return Number(m[1]);
  }
  // Last resort: a pit address, reversed through Nexus's pit assignments.
  const pit = pitFrom(text);
  if (pit && event?.nexus?.pits) {
    const norm = (s) => String(s).replace(/\s+/g, '').toLowerCase();
    const hit = Object.entries(event.nexus.pits).find(([, addr]) => norm(addr) === norm(pit));
    if (hit) return Number(hit[0]);
  }
  return null;
}

function pitFrom(text) {
  return /\bpit\s*(?:#|:|address:?)?\s*([A-Z]{0,2}\s?-?\d{1,3}[A-Z]?)\b/i.exec(text)?.[1]?.replace(/\s/g, '') ?? null;
}

const BULLET = /^\s*(?:[-•*◦▪]|\d+[.)])\s+/;

/** The lines under a "...:" header — "…help with the following:" or "FTA notes:" — up to
 *  the next header. Bullets are stripped; the header line itself is not included. */
function linesUnderHeader(text) {
  const lines = text.split('\n').map((l) => l.trim());
  const start = lines.findIndex((l) => /:$/.test(l) && !/^\S+\s+\d{1,2}:\d{2}/.test(l));
  if (start === -1) return [];
  const out = [];
  for (const l of lines.slice(start + 1)) {
    if (!l) {
      if (out.length) break;
      continue;
    }
    // Another header, or a "Pit: A4" / "Last match: Q12" style field, ends the list.
    if (/:$/.test(l) || /^[A-Za-z][\w ]{1,24}:\s+\S/.test(l)) break;
    out.push(l.replace(BULLET, '').trim());
  }
  return out.filter(Boolean);
}

/** The issues the team picked: lines under a "...:" header, a bulleted/numbered list, or
 *  whatever follows "help with" / "issues:" on one line. */
function issuesFrom(text) {
  const listed = linesUnderHeader(text);
  if (listed.length) return listed;
  const bullets = text
    .split('\n')
    .map((l) => (BULLET.test(l) ? l.replace(BULLET, '').trim() : null))
    .filter(Boolean);
  if (bullets.length) return bullets;
  // Up to the end of that sentence or line.
  const m = /(?:help with|issues?|problems?|requested|needs?)\s*[:\-–]\s*([^\n]+?)(?:[.!](?:\s|$)|\n|$)/i.exec(text)
    ?? /help with\s+([^\n]+?)(?:[.!](?:\s|$)|\n|$)/i.exec(text);
  if (!m) return [];
  return m[1].split(/\s*(?:,|;|\band\b)\s*/i).map((s) => s.replace(/[.!]+$/, '').trim()).filter(Boolean);
}

/** Parses a pasted Nexus Slack message into ticket fields. Anything it can't find is left
 *  empty for the user to fill in. */
/** A number from the message that isn't on the roster may be a team's custom display number
 *  (the real number of an offseason placeholder); map it to that roster entry. */
function resolveLabelled(team, event, labels) {
  if (!team || !labels || event?.teams?.some((t) => t.number === team)) return team;
  const hit = event?.teams?.find((t) => labels.renumbered(t.number) && labels.num(t.number) === String(team));
  return hit ? hit.number : team;
}

// The main format Nexus posts (confirmed by the owner from a real message):
//   FTA request for team 6560: CAN issues many many and didn’t move all match
// "<who> request for team <n>: <free text>", where <who> is the role asking (FTA, LRI, …).
const REQUEST_LINE = /^\s*(?:([A-Za-z]{2,6})\s+)?request(?:ed)?\s+for\s+team\s+#?(\d{1,5})\s*[:\-–—]\s*([\s\S]*)$/i;

function parseRequestLine(text, event, labels) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.trim());
  const m = at >= 0 ? REQUEST_LINE.exec(lines[at]) : null;
  if (!m) return null;
  const who = (m[1] ?? '').toUpperCase();
  // Everything after the colon (plus any following lines), kept as written.
  const body = [m[3], ...lines.slice(at + 1)].map((l) => l.trim()).filter(Boolean).join('\n');
  const issues = body ? body.split('\n') : [];
  const match = matchFrom(body);
  return {
    kind: who === 'FTA' ? 'fta-request' : 'help',
    requester: who || null,
    team: resolveLabelled(Number(m[2]), event, labels),
    pit: pitFrom(text),
    issues,
    lastMatch: match && !match.upcoming ? match.label : '',
    mentionedMatch: match?.label ?? '',
    tags: tagsFor(body || text),
    // The owner's call: the header stays the title ("FTA request for team 6560") for them to
    // rename, and the free text after the colon is the description.
    title: `${who ? `${who} request` : 'Request'} for team ${m[2]}`,
    description: body,
  };
}

export function parseNexusMessage(raw, event, labels) {
  const text = cleanSlackText(raw);
  const request = parseRequestLine(text, event, labels);
  if (request) return request;
  // "An FTA has requested a CSA to follow up with team 9999" + "FTA notes:" — a follow-up
  // the FTA is asking for, rather than the team asking for help themselves.
  const fta = /\bFTA\b/.test(text) && /follow[\s-]?up/i.test(text);
  const team = resolveLabelled(teamFrom(text, event), event, labels);
  const match = matchFrom(text);
  const issues = issuesFrom(text);
  const pit = pitFrom(text);
  // An FTA request with no notes has nothing to summarize beyond "FTA follow-up".
  const firstLine = fta ? '' : text.split('\n').find((l) => l.trim())?.trim() ?? '';
  const summary = issues.length ? issues.join(', ') : firstLine;
  const prefix = fta ? 'FTA follow-up: ' : '';
  const room = 80 - prefix.length;
  const tags = tagsFor(issues.length ? issues.join('\n') : text);
  if (fta && !tags.includes('Follow-up')) tags.push('Follow-up');
  return {
    kind: fta ? 'fta' : 'help',
    team,
    pit,
    issues,
    lastMatch: match && !match.upcoming ? match.label : '',
    mentionedMatch: match?.label ?? '',
    tags,
    title: summary
      ? prefix + (summary.length > room ? `${summary.slice(0, room - 3).trim()}…` : summary)
      : fta ? 'FTA follow-up' : 'Nexus help request',
    description: `${fta ? 'FTA follow-up request from Nexus' : 'Help request from Nexus'} (pasted from Slack):\n\n${text}`,
  };
}

// The parsed draft is handed to the ticket form through this one-slot mailbox (and
// sessionStorage, so a reload of the form doesn't lose it).
const DRAFT_KEY = 'csa-import-draft';
export function stashDraft(draft) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Private mode etc.; the in-memory copy below still works for this navigation.
  }
  stashDraft.current = draft;
}
export function readDraft() {
  if (stashDraft.current) return stashDraft.current;
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null');
  } catch {
    return null;
  }
}
export function clearDraft() {
  stashDraft.current = null;
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to clear.
  }
}
