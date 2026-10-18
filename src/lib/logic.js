export const READINESS_ITEMS = [
  ['radio', 'Radio flashed', 'Radio'],
  ['inspection', 'Inspection passed', 'Insp.'],
  ['field', 'Connected to field', 'Field'],
];

export const TICKET_STATUS = {
  unresolved: { label: 'Unresolved / watch', short: 'Unresolved' },
  resolved: { label: 'Resolved', short: 'Resolved' },
  declined: { label: 'Declined help', short: 'Declined' },
};

export const PRIORITIES = [
  ['normal', 'Normal'],
  ['high', 'High'],
];
export const PRIORITY_WEIGHT = { normal: 1, high: 3 };

/** Maps the old four-level priorities (low/medium/high/critical) onto normal/high. Used by
 *  the v2 database upgrade and when restoring an older backup. */
export function normalizePriority(p) {
  return p === 'high' || p === 'critical' ? 'high' : 'normal';
}

export const TAG_CATEGORIES = [
  ['Electrical', ['Radio', 'Systemcore', 'CAN bus', 'Brownout / power', 'Battery', 'Wiring', 'Motor controller']],
  ['Software', ['Code', 'Driver Station', 'Field connection', 'Firmware / imaging', 'Camera / vision']],
  ['Mechanical', ['Pneumatics', 'Sensors', 'Mechanical']],
  ['Meta', ['Follow-up']],
];
export const PRESET_TAGS = TAG_CATEGORIES.flatMap(([, tags]) => tags);

export const TEAM_COLORS = {
  ready: { fill: 'var(--st-ready)', text: 'var(--st-ready-ink)', label: 'Ready (3 of 3)' },
  partial: { fill: 'var(--st-partial)', text: 'var(--st-partial-ink)', label: 'In progress (1–2 of 3)' },
  none: { fill: 'var(--st-none)', text: 'var(--st-none-ink)', label: 'Not started' },
  watch: { fill: 'var(--st-watch)', text: 'var(--st-watch-ink)', label: 'Unresolved ticket' },
  ignored: { fill: 'var(--st-ignored)', text: 'var(--st-ignored-ink)', label: 'Ignored (not present)' },
  out: { fill: 'var(--st-out)', text: 'var(--st-out-ink)', label: 'Eliminated / not in playoffs' },
};

// ---------- Event day ----------

/** Districts are treated as 2-day events, everything else as 3 days. */
export function eventLength(event) {
  return event.eventType === 1 ? 2 : 3;
}

export function eventDay(event, now = new Date()) {
  const len = eventLength(event);
  const [y, m, d] = event.startDate.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const raw = Math.round((today - start) / 86400000) + 1;
  const phase = raw < 1 ? 'before' : raw > len ? 'after' : 'during';
  const autoDay = Math.min(Math.max(raw, 1), len);
  const day = event.dayOverride ? Math.min(event.dayOverride, len) : autoDay;
  return { day, len, phase, raw, overridden: !!event.dayOverride };
}

export function dayCaption(info) {
  if (info.overridden) return `Day ${info.day} of ${info.len} (set manually)`;
  if (info.phase === 'before') {
    const n = 1 - info.raw;
    return `Starts in ${n} day${n === 1 ? '' : 's'}`;
  }
  if (info.phase === 'after') return 'Event finished';
  return `Day ${info.day} of ${info.len}`;
}

const startedBySchedule = (m, now) => {
  const startMs = ((m?.time ?? m?.predictedTime) || 0) * 1000;
  return !!startMs && now.getTime() >= startMs;
};

/** Which part of the competition the event is in, from the TBA schedule rather than the
 *  calendar day (so a rain delay or an early start doesn't fool it):
 *  - 'practice': no qualification match played, and the first one hasn't started by schedule;
 *  - 'event' (qualifications — the value predates playoffs being split out, kept so saved
 *    overrides still work): quals underway or done;
 *  - 'playoffs': alliances are picked (posted on TBA or Nexus), or a playoff match has been
 *    played or reached its scheduled time.
 *  `event.phaseOverride` ('practice' | 'event' | 'playoffs') wins if set. */
export function competitionPhase(event, now = new Date()) {
  const quals = event.matches.filter((m) => m.compLevel === 'qm');
  const playoffs = event.matches.filter((m) => m.compLevel !== 'qm');
  const first = quals[0];
  let auto;
  if (playoffAlliances(event) || playoffs.some((m) => m.played) || startedBySchedule(playoffs[0], now)) {
    auto = 'playoffs';
  } else if (quals.some((m) => m.played)) {
    auto = 'event';
  } else if (first) {
    auto = startedBySchedule(first, now) ? 'event' : 'practice';
  } else {
    auto = 'practice';
  }
  const phase = event.phaseOverride ?? auto;
  return { phase, auto, overridden: !!event.phaseOverride };
}

/** Display names for the phases. The internal values stay as they are ('event' is
 *  qualifications) so existing `phaseOverride` data keeps working. */
export const PHASE_LABELS = { practice: 'Load-In/Practice', event: 'Qualifications', playoffs: 'Playoffs' };

/** Which playoff alliances to use: The Blue Alliance's when posted, otherwise FRC Nexus's.
 *  Returns { source: 'tba' | 'nexus', list } or null. */
export function playoffAlliances(event) {
  if (event.alliances?.length) return { source: 'tba', list: event.alliances };
  if (event.nexus?.alliances?.length) return { source: 'nexus', list: event.nexus.alliances };
  return null;
}

/** The side that won a match: TBA's winner (covers tiebreakers), else the higher score. */
function matchWinner(m) {
  if (m.winner) return m.winner;
  if (!m.played || m.redScore < 0 || m.blueScore < 0 || m.redScore === m.blueScore) return null;
  return m.redScore > m.blueScore ? 'red' : 'blue';
}

/**
 * Alliances knocked out, worked out from TBA's playoff match results — for when the alliance
 * list has no status (Nexus never does; TBA often doesn't at offseason events).
 * - Double elimination (2023 on): playoff ('sf') matches are single games, and a second loss
 *   is out. Finals are best of three: two finals losses is out.
 * - Older/other formats (ef/qf/sf series): two losses within one series is out.
 * Each side is matched to its alliance by most of its teams. Returns a Set of alliance names.
 */
export function eliminatedFromResults(event, allianceOf) {
  const doubleElim = (event.year ?? Number(String(event.key).slice(0, 4))) >= 2023;
  const losses = {};
  const sideAlliance = (teams) => {
    const count = {};
    for (const t of teams) if (allianceOf[t]) count[allianceOf[t]] = (count[allianceOf[t]] ?? 0) + 1;
    const best = Object.entries(count).sort((x, y) => y[1] - x[1])[0];
    return best && best[1] * 2 > teams.length ? best[0] : null;
  };
  for (const m of event.matches) {
    if (m.compLevel === 'qm') continue;
    const won = matchWinner(m);
    if (!won) continue;
    const loser = sideAlliance(won === 'red' ? m.blue : m.red);
    if (!loser) continue;
    const bucket = m.compLevel === 'f' ? 'f' : doubleElim && m.compLevel === 'sf' ? 'bracket' : `${m.compLevel}${m.setNumber}`;
    const k = `${loser}|${bucket}`;
    losses[k] = (losses[k] ?? 0) + 1;
  }
  const out = new Set();
  for (const [k, n] of Object.entries(losses)) if (n >= 2) out.add(k.split('|')[0]);
  return out;
}

/**
 * Who is still playing in the playoffs. Alliances come from The Blue Alliance when posted,
 * otherwise FRC Nexus (`playoffAlliances`): every pick (captain, 1st, 2nd and — in 4-team
 * alliances — 3rd pick) plus a backup robot that came in. An alliance is out when TBA's status
 * says 'eliminated'; when there's no status (Nexus, or TBA without one) it's worked out from
 * TBA's match results (`eliminatedFromResults`). A team on no alliance that's in an upcoming
 * playoff match also counts as still playing (a substitute the list hasn't caught up with).
 *
 * Without alliance data nothing is known (`known: false`): the playoff match lineups alone
 * can't tell an unpicked team from a 3rd pick who hasn't played yet, so nobody is marked out.
 * Returns { known, source, alive: Set, eliminated: Set, allianceOf: { team: name } }.
 */
export function playoffStatus(event) {
  const alive = new Set();
  const eliminated = new Set();
  const allianceOf = {};
  const found = playoffAlliances(event);
  if (!found) return { known: false, source: null, alive, eliminated, allianceOf };
  for (const a of found.list) for (const t of a.teams) allianceOf[t] = a.name;
  const fromResults = eliminatedFromResults(event, allianceOf);
  for (const a of found.list) {
    const out = a.status ? a.status === 'eliminated' : fromResults.has(a.name);
    for (const t of a.teams) (out ? eliminated : alive).add(t);
  }
  for (const m of event.matches) {
    if (m.compLevel === 'qm' || m.played) continue;
    // Only teams on no alliance (a substitute): an unneeded tiebreaker left on the schedule
    // mustn't bring an eliminated alliance back.
    for (const t of [...m.red, ...m.blue]) if (!(t in allianceOf)) alive.add(t);
  }
  return { known: true, source: found.source, alive, eliminated, allianceOf };
}

export function phaseCaption(info) {
  const label = PHASE_LABELS[info.phase] ?? info.phase;
  return info.overridden ? `${label} (set manually)` : label;
}

// ---------- Readiness / color ----------

export function readinessCount(r) {
  if (!r) return 0;
  return READINESS_ITEMS.filter(([k]) => r[k]).length;
}

/** During practice, colors reflect readiness only. From qualifications on, an unresolved
 *  ticket turns the team yellow. In the playoffs a team that's eliminated or wasn't picked
 *  (`out`) is gray. A team marked ignored (didn't show up) is always black, overriding
 *  everything else. */
export function teamColor({ readiness, openTickets, phase, out = false }) {
  if (readiness?.ignored) return 'ignored';
  if (phase === 'playoffs' && out) return 'out';
  if ((phase === 'event' || phase === 'playoffs') && openTickets > 0) return 'watch';
  const c = readinessCount(readiness);
  if (c === 3) return 'ready';
  if (c === 0) return 'none';
  return 'partial';
}

// ---------- Matches ----------

export function matchLabel(m) {
  if (!m) return '';
  switch (m.compLevel) {
    case 'qm':
      return `Q${m.matchNumber}`;
    case 'ef':
      return `EF${m.setNumber}-${m.matchNumber}`;
    case 'qf':
      return `QF${m.setNumber}-${m.matchNumber}`;
    case 'sf':
      return m.matchNumber > 1 ? `SF${m.setNumber}-${m.matchNumber}` : `M${m.setNumber}`;
    case 'f':
      return `F${m.matchNumber}`;
    default:
      return m.key;
  }
}

export function teamMatches(event, team) {
  return event.matches.filter((m) => m.red.includes(team) || m.blue.includes(team));
}
export function nextMatch(event, team) {
  return teamMatches(event, team).find((m) => !m.played) ?? null;
}
export function lastPlayedMatch(event, team) {
  const played = teamMatches(event, team).filter((m) => m.played);
  return played[played.length - 1] ?? null;
}

/** Nexus uses labels such as "Qualification 24"; map them onto TBA match keys. */
function nexusLabelToKey(eventKey, label) {
  const q = /^Qualification (\d+)$/.exec(label);
  if (q) return `${eventKey}_qm${q[1]}`;
  const p = /^Playoff (\d+)$/.exec(label);
  if (p) return `${eventKey}_sf${p[1]}m1`;
  const f = /^Final (\d+)$/.exec(label);
  if (f) return `${eventKey}_f1m${f[1]}`;
  return null;
}

export function nexusTimesByMatchKey(event) {
  const out = {};
  for (const m of event.nexus?.live?.matches ?? []) {
    const k = nexusLabelToKey(event.key, m.label);
    if (k) out[k] = { status: m.status, ...m.times };
  }
  return out;
}

/** Best available estimate of when a team should head to queue, in ms. */
export function matchTimeMs(match, nexusTimes) {
  const nx = nexusTimes?.[match.key];
  if (nx?.estimatedQueueTime) return { ms: nx.estimatedQueueTime, kind: 'queue', status: nx.status };
  const t = match.predictedTime ?? match.time;
  return t ? { ms: t * 1000, kind: 'start', status: nx?.status } : null;
}

export function formatClock(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatDateTime(ms) {
  return new Date(ms).toLocaleString([], {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDateRange(start, end) {
  const opts = { month: 'short', day: 'numeric' };
  const s = new Date(`${start}T12:00:00`);
  const e = new Date(`${end}T12:00:00`);
  return `${s.toLocaleDateString([], opts)} – ${e.toLocaleDateString([], opts)}, ${e.getFullYear()}`;
}

// ---------- Tickets ----------

/** Groups tickets into chains using their links (connected components). */
export function ticketChains(tickets, allById) {
  const seen = new Set();
  const chains = [];
  for (const t of tickets) {
    if (seen.has(t.id)) continue;
    const chain = [];
    const stack = [t.id];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      const cur = allById[id];
      if (!cur) continue;
      seen.add(id);
      chain.push(cur);
      for (const l of cur.links ?? []) if (!seen.has(l)) stack.push(l);
    }
    chain.sort((a, b) => a.createdAt - b.createdAt);
    chains.push(chain);
  }
  return chains;
}

export function tagCounts(tickets) {
  const counts = {};
  for (const t of tickets) for (const tag of t.tags ?? []) counts[tag] = (counts[tag] ?? 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function sortTickets(tickets) {
  const rank = { unresolved: 0, declined: 1, resolved: 2 };
  return [...tickets].sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority] ||
      b.updatedAt - a.updatedAt,
  );
}

/** The season a ticket belongs to: event keys start with the year ("2026casd"), with the
 *  creation date as a fallback. History, linking and numbering are all scoped to one season. */
export function ticketYear(ticket) {
  return Number(String(ticket.eventKey ?? '').slice(0, 4)) || new Date(ticket.createdAt).getFullYear();
}

/** A short, human-friendly identifier like "1005-1" — the team number plus this team's
 *  Nth ticket of the season (assigned once at creation, stable across events). Falls back
 *  to "?" for any ticket created before this field existed. */
export function ticketNumber(ticket, displayNum = String(ticket.team)) {
  return `${displayNum}-${ticket.seq ?? '?'}`;
}

/** The next sequence number for a team's tickets this season, given every ticket on file. */
export function nextTicketSeq(allTickets, team, year) {
  return allTickets
    .filter((t) => t.team === team && ticketYear(t) === year)
    .reduce((max, t) => Math.max(max, t.seq ?? 0), 0) + 1;
}

const priorityLabel = Object.fromEntries(PRIORITIES);

/** Plain-text rendering of a ticket, for copying to the clipboard to paste elsewhere. */
export function ticketToText(ticket, labels) {
  const num = labels ? labels.num(ticket.team) : String(ticket.team);
  const lines = [
    `Ticket ${ticketNumber(ticket, num)} — ${ticket.title}`,
    `Team: ${num}${num !== String(ticket.team) ? ` (listed as ${ticket.team})` : ''}`,
    `Event: ${ticket.eventName || ticket.eventKey}`,
    `Status: ${TICKET_STATUS[ticket.status]?.label ?? ticket.status}    Priority: ${priorityLabel[ticket.priority] ?? ticket.priority}`,
    `Last match: ${ticket.lastMatch || 'N/A'}`,
    `Tags: ${ticket.tags?.length ? ticket.tags.join(', ') : 'None'}`,
    `Opened: ${formatDateTime(ticket.createdAt)}`,
  ];
  if (ticket.status === 'resolved' && ticket.resolvedAt) lines.push(`Resolved: ${formatDateTime(ticket.resolvedAt)}`);
  lines.push('', 'Description:', ticket.description?.trim() || '(none)');
  lines.push('', 'Resolution notes:', ticket.resolution?.trim() || '(none)');
  return lines.join('\n');
}

// ---------- Readiness rules ----------

/** A flashed radio is a prerequisite for passing inspection, so whenever inspection becomes
 *  checked (by hand or from Nexus) radio is checked too. Unchecking inspection leaves radio
 *  as it was, and radio can still be unchecked by hand afterwards. */
export function withReadinessRules(prev, next) {
  if (next.inspection && !prev?.inspection) return { ...next, radio: true };
  return next;
}

// ---------- Readiness from Nexus ----------

const PASSED = /pass|complete|inspected|approved|done/i;
const NOT_PASSED = /\bnot\b|fail|re-?inspect|pending|waiting|progress|incomplete/i;
const RADIO_DONE = /program|flash|complete|done|pass|yes|true|configured/i;
const RADIO_NOT = /\bnot\b|\bno\b|fail|pending|waiting|false|incomplete/i;

/** Nexus's inspection payload, keyed by team number. The exact shape isn't documented
 *  anywhere we could reach, so this accepts the likely ones: `{ "254": {status, ...} }`,
 *  `{ "254": "Passed" }`, an array of `{team|teamNumber, status, ...}`, statuses mapped to
 *  team lists (`{ "Passed": [254, 1678], "Not started": [...] }`), or any of those wrapped in
 *  `{teams: ...}` / `{inspections: ...}`. Exported for the Nexus data check panel. */
export function inspectionByTeam(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const inner = raw.teams ?? raw.inspections ?? raw.inspection ?? raw;
  const out = {};
  // Status → list of teams.
  if (!Array.isArray(inner) && Object.values(inner).length
      && Object.values(inner).every((v) => Array.isArray(v) && v.every((t) => /^(frc)?\d+$/i.test(String(t))))) {
    for (const [status, list] of Object.entries(inner)) {
      for (const t of list) out[Number(String(t).replace(/^frc/i, ''))] = { status };
    }
    return out;
  }
  const entries = Array.isArray(inner)
    ? inner.map((v) => [v?.team ?? v?.teamNumber ?? v?.number, v])
    : Object.entries(inner);
  for (const [k, v] of entries) {
    const n = Number(String(k ?? '').replace(/^frc/i, ''));
    if (n) out[n] = typeof v === 'string' ? { status: v } : v ?? {};
  }
  return out;
}

/** What Nexus says about a team's readiness: inspection status text, whether that counts
 *  as passed, and radio status if (and only if) the payload has a radio field — otherwise
 *  `radio` is undefined and nothing is inferred. */
export function nexusReadiness(event, team) {
  const rec = inspectionByTeam(event?.nexus?.inspection)[team];
  if (!rec) return { inspectionStatus: null, inspectionPassed: false, radio: undefined };
  const status = rec.status ?? rec.inspectionStatus ?? rec.state ?? rec.inspection?.status
    ?? (typeof rec.inspection === 'string' ? rec.inspection : null);
  const statusText = status == null ? '' : String(status);
  const inspectionPassed = rec.passed === true || rec.inspected === true
    || (!!statusText && PASSED.test(statusText) && !NOT_PASSED.test(statusText));
  let radio;
  for (const [key, val] of Object.entries(rec)) {
    if (!/radio/i.test(key)) continue;
    if (typeof val === 'boolean') radio = val;
    else if (val != null && typeof val !== 'object') {
      const s = String(val);
      radio = RADIO_DONE.test(s) && !RADIO_NOT.test(s);
    } else if (val && typeof val === 'object') {
      const s = String(val.status ?? val.state ?? '');
      radio = val.programmed === true || val.done === true || (!!s && RADIO_DONE.test(s) && !RADIO_NOT.test(s));
    }
    break;
  }
  return { inspectionStatus: statusText || null, inspectionPassed, radio };
}

// ---------- Auto-tagging ----------

// Keyword rules that suggest preset tags from free text (ticket title + description, or a
// pasted Nexus message). Case-insensitive except CAN, which is matched in capitals only so
// the word "can" doesn't tag everything. Follow-up is never auto-added.
const AUTO_TAG_RULES = [
  ['Radio', /\bradio\b|wi-?fi|wireless|vh-?109|\bbridge\b/i],
  ['Systemcore', /systemcore|roborio|\brio\b/i],
  ['CAN bus', /\bCAN\b|can ?bus|canivore/],
  ['Brownout / power', /brown ?-?out|\bpower\b|voltage|\bpdh\b|\bpdp\b|breaker/i],
  ['Battery', /batter(y|ies)/i],
  ['Wiring', /wiring|\bwires?\b|connector|crimp|ethernet|cable/i],
  ['Motor controller', /motor controller|spark ?(max|flex)?|talon|victor|kraken|falcon|\bneo\b/i],
  ['Code', /\bcode\b|software|programming|deploy|crash|\bjava\b|c\+\+|python|labview|kotlin/i],
  ['Driver Station', /driver ?station|\bds\b|joystick|gamepad/i],
  ['Field connection', /\bfield\b|\bfms\b|comms|communication|disconnect|connection|network/i],
  ['Firmware / imaging', /firmware|imag(e|ing)|re-?flash|update/i],
  ['Camera / vision', /camera|vision|limelight|photon/i],
  ['Pneumatics', /pneumatic|compressor|solenoid|air leak/i],
  ['Sensors', /sensor|encoder|gyro|pigeon|navx|limit switch/i],
  ['Mechanical', /mechanical|gearbox|\bgears?\b|\bchain\b|\bbelt\b|bearing|\bbolts?\b|\bshaft\b|intake|shooter|elevator|drivetrain|swerve module/i],
];


/** Preset tags whose keywords appear in the text. */
export function autoTags(text) {
  const s = String(text ?? '');
  return AUTO_TAG_RULES.filter(([, re]) => re.test(s)).map(([tag]) => tag);
}
