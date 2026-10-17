import { createContext, createElement, useContext, useMemo } from 'react';
import { db, useLive } from './db.js';

// User-defined display labels for teams. Offseason events often list placeholder team
// numbers (e.g. 9971 for a B robot), so the user can give a team its own display number
// and/or nickname. The real TBA number stays the key for everything stored (tickets,
// readiness, Nexus/TBA lookups); only what's shown changes.
//
// A label is scoped to every event ('all') or to one event (its key); an event-only label
// wins over an all-events one. Records live in the synced `teamLabels` store:
//   { id: `${scope}:${team}`, scope, team, number, nickname }

const LabelsContext = createContext({ records: [], eventKey: null, remap: {} });

/** Wraps the app: loads labels once and knows which event is open (for event-only labels
 *  and that event's TBA demo-robot remaps). */
export function TeamLabelsProvider({ eventKey, children }) {
  const records = useLive(() => db.all('teamLabels'), []);
  const remap = useLive(async () => (eventKey ? (await db.get('events', eventKey))?.remapTeams ?? {} : {}), [eventKey]);
  const value = useMemo(() => ({ records: records ?? [], eventKey, remap: remap ?? {} }), [records, eventKey, remap]);
  return createElement(LabelsContext.Provider, { value }, children);
}

/** A lookup over label records for one event (or none). Also usable outside React, e.g. the
 *  report builder, by passing records read straight from the database. `remap` is the event's
 *  TBA demo-robot names ({ 9971: '971B' }), used as the display number when the user hasn't
 *  set one. */
export function makeLabeler(records, eventKey, remap = {}) {
  const byId = new Map((records ?? []).map((r) => [r.id, r]));
  const get = (n) => (eventKey && byId.get(`${eventKey}:${n}`)) || byId.get(`all:${n}`) || null;
  const shown = (n) => get(n)?.number || remap?.[n] || String(n);
  return {
    get,
    /** Display number: the user's custom one, else TBA's remap ("971B"), else the real number. */
    num: shown,
    /** Display nickname: the custom one if set, else `fallback` (usually TBA's). */
    nick: (n, fallback = '') => get(n)?.nickname || fallback,
    /** Whether the displayed number differs from the real one. */
    renumbered: (n) => shown(n) !== String(n),
  };
}

/** Labels for the event currently open (or `eventKey`, e.g. a ticket's own event). */
export function useTeamLabels(eventKey) {
  const { records, eventKey: current, remap } = useContext(LabelsContext);
  const key = eventKey === undefined ? current : eventKey;
  // TBA remaps belong to the open event, so only apply them to that event's labels.
  return useMemo(() => makeLabeler(records, key, key === current ? remap : {}), [records, key, current, remap]);
}

/** Saves (or, with both fields blank, removes) a team's label. An event-only label overrides
 *  the all-events one at that event and leaves it alone elsewhere; saving an all-events label
 *  from an event drops that event's own override so the new one shows there too. */
export async function saveTeamLabel({ team, eventKey, scope, number, nickname }) {
  const sc = scope === 'event' ? eventKey : 'all';
  const num = String(number ?? '').trim();
  const nick = String(nickname ?? '').trim();
  if (sc === 'all' && eventKey && (await db.get('teamLabels', `${eventKey}:${team}`))) {
    await db.del('teamLabels', `${eventKey}:${team}`);
  }
  if (!num && !nick) {
    if (await db.get('teamLabels', `${sc}:${team}`)) await db.del('teamLabels', `${sc}:${team}`);
    return;
  }
  await db.put('teamLabels', { id: `${sc}:${team}`, scope: sc, team, number: num, nickname: nick, updatedAt: Date.now() });
}

/** Removes the label in effect at this event: its event-only override if there is one
 *  (revealing any all-events label), otherwise the all-events label. */
export async function clearTeamLabel(team, eventKey) {
  const own = `${eventKey}:${team}`;
  if (await db.get('teamLabels', own)) return db.del('teamLabels', own);
  if (await db.get('teamLabels', `all:${team}`)) return db.del('teamLabels', `all:${team}`);
  return undefined;
}
