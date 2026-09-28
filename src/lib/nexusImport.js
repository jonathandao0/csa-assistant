// Turns a technical-help request that FRC Nexus posted to a CSA Slack channel (copied and
// pasted into the app) into a ticket draft. The exact wording of those messages isn't
// documented, so this doesn't assume one layout: it looks for a team number, a pit, a match
// and the list of issues anywhere in the text, and the result is always shown for review
// before anything is saved.

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

const TAG_RULES = [
  ['Radio', /\bradio\b|wi-?fi|wireless|vh-?109|\bbridge\b/i],
  ['Systemcore', /systemcore|roborio|\brio\b/i],
  ['CAN bus', /\bCAN\b|can ?bus|canivore/],
  ['Brownout / power', /brown ?-?out|\bpower\b|voltage|\bpdh\b|\bpdp\b|breaker/i],
  ['Battery', /batter(y|ies)/i],
  ['Wiring', /wiring|\bwires?\b|connector|crimp|ethernet|cable/i],
  ['Motor controller', /motor controller|spark ?(max|flex)?|talon|victor|kraken|falcon|\bneo\b/i],
  ['Code', /\bcode\b|software|programming|deploy|crash/i],
  ['Driver Station', /driver ?station|\bds\b|joystick|gamepad/i],
  ['Field connection', /\bfield\b|\bfms\b|comms|communication|disconnect|connection/i],
  ['Firmware / imaging', /firmware|imag(e|ing)|re-?flash|update/i],
  ['Camera / vision', /camera|vision|limelight|photon/i],
  ['Pneumatics', /pneumatic|compressor|solenoid|air leak/i],
  ['Sensors', /sensor|encoder|gyro|pigeon|navx|limit switch/i],
];

export function tagsFor(text) {
  return TAG_RULES.filter(([, re]) => re.test(text)).map(([tag]) => tag);
}

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

/** The issues the team picked: a bulleted/numbered list if there is one, otherwise whatever
 *  follows "help with" / "issues:" / "problem:". */
function issuesFrom(text) {
  const bullets = text
    .split('\n')
    .map((l) => /^\s*(?:[-•*◦▪]|\d+[.)])\s+(.+)$/.exec(l)?.[1]?.trim())
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
export function parseNexusMessage(raw, event) {
  const text = cleanSlackText(raw);
  const team = teamFrom(text, event);
  const match = matchFrom(text);
  const issues = issuesFrom(text);
  const pit = pitFrom(text);
  const summary = issues.length ? issues.join(', ') : text.split('\n').find((l) => l.trim())?.trim() ?? '';
  return {
    team,
    pit,
    issues,
    lastMatch: match && !match.upcoming ? match.label : '',
    mentionedMatch: match?.label ?? '',
    tags: tagsFor(issues.length ? issues.join('\n') : text),
    title: summary.length > 80 ? `${summary.slice(0, 77).trim()}…` : summary || 'Nexus help request',
    description: `Imported from a Nexus help request in Slack:\n\n${text}`,
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
