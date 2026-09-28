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

/** Whether the event is still in "practice" (no qualification matches played, and the
 *  first one hasn't started yet by schedule) or has moved into "event" (quals underway or
 *  done). Driven by the TBA schedule rather than the calendar day, so a rain delay or an
 *  early start doesn't fool it. `event.phaseOverride` ('practice' | 'event') wins if set. */
export function competitionPhase(event, now = new Date()) {
  const quals = event.matches.filter((m) => m.compLevel === 'qm');
  const first = quals[0];
  let auto;
  if (quals.some((m) => m.played)) {
    auto = 'event';
  } else if (first) {
    const startMs = (first.time ?? first.predictedTime ?? 0) * 1000;
    auto = startMs && now.getTime() >= startMs ? 'event' : 'practice';
  } else {
    auto = 'practice';
  }
  const phase = event.phaseOverride ?? auto;
  return { phase, auto, overridden: !!event.phaseOverride };
}

/** Display names for the two phases — the internal values ('practice' / 'event') stay as
 *  they are so existing `phaseOverride` data keeps working; only the on-screen wording changed. */
export const PHASE_LABELS = { practice: 'Load-In/Practice', event: 'Quals/Playoffs' };

export function phaseCaption(info) {
  const label = PHASE_LABELS[info.phase] ?? info.phase;
  return info.overridden ? `${label} (set manually)` : label;
}

// ---------- Readiness / color ----------

export function readinessCount(r) {
  if (!r) return 0;
  return READINESS_ITEMS.filter(([k]) => r[k]).length;
}

/** During practice, colors reflect readiness only. Once the event phase starts, an
 *  unresolved ticket turns the team yellow. A team marked ignored (didn't show up) is
 *  always black, overriding everything else. */
export function teamColor({ readiness, openTickets, phase }) {
  if (readiness?.ignored) return 'ignored';
  if (phase === 'event' && openTickets > 0) return 'watch';
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
export function ticketNumber(ticket) {
  return `${ticket.team}-${ticket.seq ?? '?'}`;
}

/** The next sequence number for a team's tickets this season, given every ticket on file. */
export function nextTicketSeq(allTickets, team, year) {
  return allTickets
    .filter((t) => t.team === team && ticketYear(t) === year)
    .reduce((max, t) => Math.max(max, t.seq ?? 0), 0) + 1;
}

const priorityLabel = Object.fromEntries(PRIORITIES);

/** Plain-text rendering of a ticket, for copying to the clipboard to paste elsewhere. */
export function ticketToText(ticket) {
  const lines = [
    `Ticket ${ticketNumber(ticket)} — ${ticket.title}`,
    `Team: ${ticket.team}`,
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
