import { useEffect, useMemo, useRef, useState } from 'react';
import LedReference from '../components/LedReference.jsx';
import PitMap from '../components/PitMap.jsx';
import { Icon, Legend, Loading, Modal, ReadinessMarks, TeamBox, TicketRow, TopBar } from '../components/ui.jsx';
import { db, getSetting, useLive } from '../lib/db.js';
import { DEMO_EVENT_KEYS } from '../lib/devSeed.js';
import {
  PHASE_LABELS,
  PRIORITY_WEIGHT,
  READINESS_ITEMS,
  competitionPhase,
  formatClock,
  matchLabel,
  matchTimeMs,
  nexusTimesByMatchKey,
  nextMatch,
  phaseCaption,
  readinessCount,
  sortTickets,
  teamColor,
  ticketYear,
  withReadinessRules,
} from '../lib/logic.js';
import { parseNexusMessage, stashDraft } from '../lib/nexusImport.js';
import { nav } from '../lib/router.js';
import { applyNexusReadiness, setNexusEventKey, syncEvent } from '../lib/sync.js';
import { downloadBlob, toast } from '../lib/util.js';

/** Loads everything an event screen needs and derives per-team status. */
export function useEventContext(eventKey) {
  const event = useLive(() => db.get('events', eventKey), [eventKey]);
  const readinessList = useLive(async () => {
    const all = await db.all('readiness');
    return all.filter((r) => r.eventKey === eventKey);
  }, [eventKey]);
  const tickets = useLive(() => db.byIndex('tickets', 'eventKey', eventKey), [eventKey]);

  // Apply Nexus inspection status whenever an event's saved data loads, not only right after
  // a sync — so data already on the device (e.g. fetched before an app update) counts too.
  // Idempotent: each item is applied once per team (readiness.nexusApplied).
  const nexusInspection = event?.nexus?.inspection;
  useEffect(() => {
    if (event && nexusInspection) applyNexusReadiness(event).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventKey, nexusInspection]);

  return useMemo(() => {
    if (event === undefined || !readinessList || !tickets) return { loading: true };
    if (!event) return { missing: true };
    const readiness = Object.fromEntries(readinessList.map((r) => [r.team, r]));
    const openByTeam = {};
    for (const t of tickets) {
      if (t.status === 'unresolved') (openByTeam[t.team] ??= []).push(t);
    }
    const phaseInfo = competitionPhase(event);
    const colorFor = (team) =>
      teamColor({ readiness: readiness[team], openTickets: openByTeam[team]?.length ?? 0, phase: phaseInfo.phase });
    return { event, readiness, tickets, openByTeam, phaseInfo, colorFor };
  }, [event, readinessList, tickets]);
}

export async function toggleReadiness(eventKey, team, item, current) {
  const id = `${eventKey}:${team}`;
  const prev = current ?? { id, eventKey, team, radio: false, inspection: false, field: false };
  await db.put('readiness', withReadinessRules(prev, { ...prev, [item]: !prev[item], updatedAt: Date.now() }));
}

/** Marks a team as not present so it always shows black and drops out of the priority list. */
export async function setIgnored(eventKey, team, ignored, current) {
  const id = `${eventKey}:${team}`;
  const prev = current ?? { id, eventKey, team, radio: false, inspection: false, field: false };
  await db.put('readiness', { ...prev, ignored, updatedAt: Date.now() });
}

// Opening (or reloading) an event whose saved data is older than this re-downloads it in
// the background, so a pit map Nexus published since the last refresh shows up on its own.
const AUTO_REFRESH_MS = 5 * 60 * 1000;

/** Re-syncs an event and reports the outcome: a plain "refreshed" only when everything
 *  updated, otherwise what didn't (e.g. Nexus unreachable, so no new pit map). */
async function runSync(key, { quiet = false } = {}) {
  try {
    const { warnings } = await syncEvent(key);
    if (warnings.length) toast(warnings.join(' '));
    else if (!quiet) toast('Event data refreshed');
  } catch (e) {
    if (!quiet) toast(e.message);
  }
}

export default function EventPage({ eventKey, tab }) {
  const ctx = useEventContext(eventKey);
  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const autoSynced = useRef(null);

  const fetchedAt = ctx.event?.fetchedAt;
  useEffect(() => {
    if (fetchedAt === undefined || autoSynced.current === eventKey) return;
    autoSynced.current = eventKey;
    if (DEMO_EVENT_KEYS.includes(eventKey) || !navigator.onLine) return;
    if (Date.now() - fetchedAt < AUTO_REFRESH_MS) return;
    (async () => {
      if (!(await getSetting('tbaKey')) && !(await getSetting('nexusKey'))) return;
      setSyncing(true);
      await runSync(eventKey, { quiet: true });
      setSyncing(false);
    })();
  }, [eventKey, fetchedAt]);

  if (ctx.loading) return <Loading />;
  if (ctx.missing) {
    return (
      <>
        <TopBar title="Event not found" back={() => nav('/')} />
        <main className="page">
          <p>{eventKey} isn't in your list. It may have been removed.</p>
          <button className="btn primary" onClick={() => nav('/')}>Back to events</button>
        </main>
      </>
    );
  }

  const { event, phaseInfo } = ctx;
  const hasMap = !!event.nexus?.map?.pits && Object.keys(event.nexus.map.pits).length > 0;
  const tabs = hasMap
    ? [['map', 'Pit map'], ['today', 'Priority list'], ['teams', 'Teams'], ['tickets', 'Tickets'], ['ref', 'Reference']]
    : [['teams', 'Teams'], ['today', 'Priority list'], ['tickets', 'Tickets'], ['map', 'Pit map'], ['ref', 'Reference']];
  const active = tabs.some(([k]) => k === tab) ? tab : tabs[0][0];

  async function refresh() {
    setSyncing(true);
    await runSync(event.key);
    setSyncing(false);
  }

  async function exportReport(anonymize = false) {
    setExporting(anonymize ? 'anon' : 'full');
    try {
      const { buildEventReport } = await import('../lib/report.js');
      const all = (await db.all('tickets')).filter((t) => ticketYear(t) === event.year);
      const blob = await buildEventReport(event, ctx.tickets, all, { anonymize });
      downloadBlob(blob, `CSA report ${event.key}${anonymize ? ' (anonymized)' : ''}.docx`);
      toast(anonymize ? 'Anonymized report downloaded' : 'Report downloaded');
    } catch (e) {
      toast(`Report failed: ${e.message}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <TopBar
        title={event.shortName}
        subtitle={`${phaseCaption(phaseInfo)} · ${event.key}`}
        back={() => nav('/')}
        actions={
          <button className={`icon-btn${syncing ? ' spin' : ''}`} aria-label="Refresh event data"
            onClick={refresh} disabled={syncing}>
            <Icon name="refresh" />
          </button>
        }
      >
        <nav className="tabs" role="tablist">
          {tabs.map(([k, label]) => (
            <button key={k} className="tab" role="tab" aria-selected={k === active}
              onClick={() => nav(`/event/${event.key}/tab/${k}`)}>
              {label}
            </button>
          ))}
        </nav>
      </TopBar>
      <main className="page">
        {active === 'map' && <MapTab ctx={ctx} hasMap={hasMap} onRetry={refresh} syncing={syncing} />}
        {active === 'today' && <PrioritiesTab ctx={ctx} />}
        {active === 'teams' && <TeamsTab ctx={ctx} />}
        {active === 'tickets' && <TicketsTab ctx={ctx} onExport={exportReport} exporting={exporting} />}
        {active === 'ref' && <LedReference />}
        {active !== 'ref' && (
          <p className="hint" style={{ marginTop: 24 }}>
            Data from <a href="https://www.thebluealliance.com" target="_blank" rel="noreferrer">The Blue Alliance</a>
            {event.nexus?.enabled && (
              <> and <a href="https://frc.nexus" target="_blank" rel="noreferrer">FRC Nexus</a></>
            )}
            . Last refreshed {new Date(event.fetchedAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.
          </p>
        )}
        {active === 'tickets' && (
          <button className="btn danger" style={{ marginTop: 8 }} onClick={async () => {
            if (!confirm(`Remove ${event.shortName} from your list? Tickets stay saved for team history.`)) return;
            await db.del('events', event.key);
            nav('/');
          }}>
            Remove event from my list
          </button>
        )}
      </main>
    </>
  );
}

// ---------------- Pit map ----------------

function MapTab({ ctx, hasMap, onRetry, syncing }) {
  const { event, colorFor, phaseInfo } = ctx;
  const [find, setFind] = useState('');
  const [findOpen, setFindOpen] = useState(false);
  const highlight = Number(find) || null;
  const findSuggestions = find
    ? event.teams.filter((t) => String(t.number).startsWith(find)).slice(0, 8)
    : [];

  if (!hasMap) {
    const reason = !event.nexus?.enabled
      ? 'Add your Nexus API key in Settings to load pit maps.'
      : event.nexus?.error
        ? event.nexus.error
        : `FRC Nexus has no pit map under the event code ${event.nexusEventKey || event.key}. If the map shows on frc.nexus, Nexus may use a different code for this event — set it below.`;
    return (
      <div className="sheet">
        <div className="na-art">
          <svg width="220" height="130" viewBox="0 0 220 130" aria-hidden="true">
            {[0, 1, 2, 3].map((c) =>
              [0, 1].map((r) => (
                <rect key={`${c}${r}`} x={14 + c * 50} y={14 + r * 54} width="42" height="42" rx="4"
                  style={{ fill: 'none', stroke: 'var(--st-empty)', strokeWidth: 2, strokeDasharray: '5 4' }} />
              )),
            )}
            <text x="110" y="72" textAnchor="middle" dominantBaseline="central"
              style={{ fontFamily: 'var(--font-num)', fontWeight: 700, fontSize: 56, fill: 'var(--muted)' }}>
              N/A
            </text>
          </svg>
          <h2 style={{ margin: '8px 0 4px', fontSize: '1.1rem' }}>No pit map for this event</h2>
          <p className="muted" style={{ margin: '0 0 4px', maxWidth: 360 }}>{reason}</p>
          <p className="small muted" style={{ margin: '0 0 14px' }}>
            Last checked {new Date(event.fetchedAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.
          </p>
          <div className="inline" style={{ justifyContent: 'center' }}>
            <button className="btn" onClick={onRetry} disabled={syncing}>{syncing ? 'Checking…' : 'Check again'}</button>
            {!event.nexus?.enabled && <a className="btn primary" href="#/settings">Open Settings</a>}
          </div>
        </div>
        {event.nexus?.enabled && <NexusCodeField event={event} />}
      </div>
    );
  }

  return (
    <>
      <div className="inline" style={{ marginBottom: 10 }}>
        <div className="combo-wrap">
          <input className="input" inputMode="numeric" placeholder="Find a team on the map"
            value={find}
            onChange={(e) => { setFind(e.target.value.replace(/\D/g, '')); setFindOpen(true); }}
            onFocus={() => setFindOpen(true)}
            onBlur={() => setTimeout(() => setFindOpen(false), 120)}
            aria-label="Find team" />
          {findOpen && findSuggestions.length > 0 && (
            <ul className="combo-list" role="listbox">
              {findSuggestions.map((t) => (
                <li key={t.number}>
                  <button className="combo-option" onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setFind(String(t.number)); setFindOpen(false); }}>
                    <TeamBox number={t.number} color={colorFor(t.number)} />
                    <span className="row-title">{t.nickname}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {highlight && event.nexus?.pits?.[highlight] && (
          <span className="muted small">Pit {event.nexus.pits[highlight]}</span>
        )}
      </div>
      <PitMap map={event.nexus.map} colorFor={colorFor} highlight={highlight}
        teamAddresses={event.nexus?.pits} onSelect={(team) => nav(`/event/${event.key}/team/${team}`)} />
      <Legend phase={phaseInfo.phase} />
      <div className="sheet" style={{ marginTop: 16 }}>
        <NexusCodeField event={event} />
      </div>
    </>
  );
}

/** Override for when FRC Nexus files this event under a different code than TBA (common
 *  for offseason events). Used for every Nexus request: pit map, pits, queue, inspection. */
function NexusCodeField({ event }) {
  const [value, setValue] = useState(event.nexusEventKey ?? '');
  const [busy, setBusy] = useState(false);
  const current = event.nexusEventKey || event.key;

  async function save(code) {
    setBusy(true);
    try {
      const { warnings, nexus: nx } = await setNexusEventKey(event.key, code);
      setValue(code.trim().toLowerCase() === event.key ? '' : code.trim().toLowerCase());
      const hasMap = !!nx?.map?.pits && Object.keys(nx.map.pits).length > 0;
      toast(warnings.length ? warnings.join(' ') : hasMap ? 'Pit map loaded' : `Saved. Nexus has no pit map under ${(code.trim() || event.key).toLowerCase()} yet.`);
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="sheet-pad stack" style={{ borderTop: '1px solid var(--line)' }}
      onSubmit={(e) => { e.preventDefault(); save(value); }}>
      <label className="field" style={{ margin: 0 }}>
        <span>Nexus event code</span>
        <div className="inline">
          <input className="input" style={{ flex: 1 }} value={value} placeholder={event.key}
            onChange={(e) => setValue(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck="false"
            aria-label="Nexus event code" />
          <button className="btn primary" disabled={busy || value.trim().toLowerCase() === (event.nexusEventKey ?? '')}>
            {busy ? 'Loading…' : 'Use code'}
          </button>
        </div>
        <span className="hint" style={{ fontWeight: 400 }}>
          Using <strong>{current}</strong>{event.nexusEventKey ? ` instead of the TBA code ${event.key}` : ' (same as TBA)'}.
          Only change this if the event's page on frc.nexus shows a different code in its address.
        </span>
      </label>
      {event.nexusEventKey && (
        <div><button type="button" className="btn" style={{ minHeight: 36 }} disabled={busy} onClick={() => save('')}>
          Go back to {event.key}
        </button></div>
      )}
    </form>
  );
}

// ---------------- Priority list ----------------

function PhaseSwitch({ event, phaseInfo }) {
  async function set(v) {
    await db.put('events', { ...event, phaseOverride: v || null });
  }
  return (
    <label className="inline small muted">
      Phase
      <select className="input" style={{ width: 'auto', minHeight: 36, padding: '4px 8px' }}
        value={event.phaseOverride ?? ''} onChange={(e) => set(e.target.value)}>
        <option value="">Auto ({PHASE_LABELS[phaseInfo.auto]})</option>
        <option value="practice">{PHASE_LABELS.practice}</option>
        <option value="event">{PHASE_LABELS.event}</option>
      </select>
    </label>
  );
}

function PrioritiesTab({ ctx }) {
  const { event, phaseInfo } = ctx;
  const [sortBy, setSortBy] = useState('priority');
  const [sortDir, setSortDir] = useState(phaseInfo.phase === 'practice' ? 'asc' : 'desc');
  // Bumped only by an explicit re-sort (button or pull-down), never by editing a team's
  // readiness/tickets, so the list doesn't jump around while you're checking things off.
  const [resortToken, setResortToken] = useState(0);
  const resort = () => {
    setResortToken((n) => n + 1);
    toast('Priority list re-sorted');
  };
  return (
    <>
      <div className="section-head">
        <h2>Priority list</h2>
        <PhaseSwitch event={event} phaseInfo={phaseInfo} />
      </div>
      <SortBar sortBy={sortBy} setSortBy={setSortBy} sortDir={sortDir} setSortDir={setSortDir} onResort={resort} />
      <PullToResort onResort={resort}>
        {phaseInfo.phase === 'practice'
          ? <ReadinessPriorities ctx={ctx} sortBy={sortBy} sortDir={sortDir} resortToken={resortToken} />
          : <MatchPriorities ctx={ctx} sortBy={sortBy} sortDir={sortDir} resortToken={resortToken} />}
      </PullToResort>
    </>
  );
}

function SortBar({ sortBy, setSortBy, sortDir, setSortDir, onResort }) {
  return (
    <div className="inline" style={{ marginBottom: 12 }}>
      <label className="inline small muted" style={{ gap: 6 }}>
        Sort by
        <select className="input" style={{ width: 'auto', minHeight: 36, padding: '4px 8px' }}
          value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort priority list by">
          <option value="priority">Priority</option>
          <option value="unresolved">Unresolved count</option>
          <option value="team">Team number</option>
        </select>
      </label>
      <button className="btn" style={{ minHeight: 36 }}
        onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}>
        {sortDir === 'asc' ? '↑ Ascending' : '↓ Descending'}
      </button>
      <button className="btn" style={{ minHeight: 36 }} onClick={onResort} aria-label="Re-sort the priority list now">
        <Icon name="refresh" size={16} /> Re-sort
      </button>
    </div>
  );
}

/** Wraps the priority list so pulling down from the top re-sorts it, mirroring the button
 *  above — the list itself never reorders on its own while you're working through it. */
function PullToResort({ onResort, children }) {
  const [pull, setPull] = useState(0);
  const [ready, setReady] = useState(false);
  const startY = useRef(null);
  const THRESHOLD = 64;

  function onTouchStart(e) {
    startY.current = window.scrollY <= 0 ? e.touches[0].clientY : null;
  }
  function onTouchMove(e) {
    if (startY.current == null) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy > 0 && window.scrollY <= 0) {
      setPull(Math.min(dy, 110));
      setReady(dy > THRESHOLD);
    } else {
      setPull(0);
      setReady(false);
    }
  }
  function onTouchEnd() {
    if (ready) onResort();
    setPull(0);
    setReady(false);
    startY.current = null;
  }

  return (
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      {pull > 0 && (
        <div className="pull-indicator" style={{ height: pull }}>
          {ready ? 'Release to re-sort' : 'Pull down to re-sort'}
        </div>
      )}
      {children}
    </div>
  );
}

function ReadinessPriorities({ ctx, sortBy, sortDir, resortToken }) {
  const { event, readiness, openByTeam, colorFor } = ctx;
  const nexusTimes = useMemo(() => nexusTimesByMatchKey(event), [event]);

  // Snapshot of which teams are pending and in what order. Only recomputed when the sort
  // option changes or the user asks for a re-sort — not on every readiness edit — so rows
  // don't jump or vanish out from under a finger mid-tap.
  const pendingNumbers = useMemo(() => {
    const eligible = event.teams.filter((t) => !readiness[t.number]?.ignored);
    const list = eligible
      .map((t) => ({ t, c: readinessCount(readiness[t.number]), open: openByTeam[t.number]?.length ?? 0 }))
      .filter((x) => x.c < 3);
    if (sortBy === 'team') {
      list.sort((a, b) => a.t.number - b.t.number);
      if (sortDir === 'desc') list.reverse();
    } else if (sortBy === 'unresolved') {
      list.sort((a, b) => b.open - a.open || a.t.number - b.t.number);
      if (sortDir === 'asc') list.reverse();
    } else {
      list.sort((a, b) => a.c - b.c || a.t.number - b.t.number);
      if (sortDir === 'desc') list.reverse();
    }
    return list.map((x) => x.t.number);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.key, sortBy, sortDir, resortToken]);

  const eligibleTeams = event.teams.filter((t) => !readiness[t.number]?.ignored);
  const ready = eligibleTeams.length - eligibleTeams.filter((t) => readinessCount(readiness[t.number]) < 3).length;
  const pending = pendingNumbers.map((n) => event.teams.find((t) => t.number === n)).filter(Boolean);

  return (
    <>
      <div className="section">
        <div className="inline small" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <span><strong>{ready}</strong> of {eligibleTeams.length} teams ready</span>
          <span className="muted">Tap an item to mark it done</span>
        </div>
        <div className="progress"><div style={{ width: `${(ready / Math.max(1, eligibleTeams.length)) * 100}%` }} /></div>
      </div>
      {pending.length === 0 ? (
        <div className="notice">Every team has flashed its radio, passed inspection, and connected to the field.</div>
      ) : (
        <ul className="row-list sheet">
          {pending.map((t) => {
            const r = readiness[t.number];
            const next = nextMatch(event, t.number);
            const time = next ? matchTimeMs(next, nexusTimes) : null;
            const openTeamPage = () => nav(`/event/${event.key}/team/${t.number}`);
            return (
              <li key={t.number} className="row" style={{ cursor: 'pointer', flexWrap: 'wrap' }}
                role="button" tabIndex={0} aria-label={`Open team ${t.number}`}
                onClick={openTeamPage} onKeyDown={(e) => e.key === 'Enter' && openTeamPage()}>
                <TeamBox number={t.number} color={colorFor(t.number)} />
                <div className="row-main">
                  <div className="row-title">{t.nickname}</div>
                  <div className="row-sub">
                    {next
                      ? `Next: ${matchLabel(next)}${time ? ` · ~${formatClock(time.ms)}` : ''}`
                      : 'No more scheduled matches'}
                  </div>
                  <div className="inline" style={{ gap: 6, marginTop: 6 }}>
                    {READINESS_ITEMS.map(([k, , short]) => (
                      <button key={k} className={`mark${r?.[k] ? ' done' : ''}`}
                        aria-pressed={!!r?.[k]}
                        onClick={(e) => { e.stopPropagation(); toggleReadiness(event.key, t.number, k, r); }}>
                        {r?.[k] ? '✓ ' : ''}
                        {short}
                      </button>
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

// Whether the Priority list's "Open tickets" section is collapsed. A per-device convenience,
// so it's kept in localStorage (guarded: storage can be blocked) and survives tab switches.
const OPEN_COLLAPSED_KEY = 'csa-open-tickets-collapsed';
function readOpenCollapsed() {
  try {
    return localStorage.getItem(OPEN_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function MatchPriorities({ ctx, sortBy, sortDir, resortToken }) {
  const { event, openByTeam, readiness, colorFor } = ctx;
  const nexusTimes = useMemo(() => nexusTimesByMatchKey(event), [event]);
  const [openCollapsed, setOpenCollapsed] = useState(readOpenCollapsed);
  const toggleOpen = () => {
    const next = !openCollapsed;
    setOpenCollapsed(next);
    try {
      localStorage.setItem(OPEN_COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      // Storage blocked; the choice still holds until the page is left.
    }
  };
  const order = Object.fromEntries(event.matches.map((m, i) => [m.key, i]));
  const byTeam = sortBy === 'team';

  // Snapshot of team order AND which section (open tickets vs. up next) each team is in.
  // Recomputed only on an explicit re-sort, so resolving a ticket or a match finishing
  // doesn't move rows around while you're working the list.
  const rowSnapshot = useMemo(() => {
    const base = event.teams
      .filter((t) => !readiness[t.number]?.ignored)
      .map((t) => {
        const open = sortTickets(openByTeam[t.number] ?? []);
        const next = nextMatch(event, t.number);
        return {
          number: t.number,
          hasOpen: open.length > 0,
          openCount: open.length,
          topWeight: open.length ? PRIORITY_WEIGHT[open[0].priority] : 0,
          nextIndex: next ? order[next.key] : Infinity,
        };
      });
    if (byTeam) {
      base.sort((a, b) => a.number - b.number);
      if (sortDir === 'desc') base.reverse();
    } else if (sortBy === 'unresolved') {
      base.sort((a, b) => b.openCount - a.openCount || a.number - b.number);
      if (sortDir === 'asc') base.reverse();
    } else {
      base.sort(
        (a, b) =>
          (b.hasOpen ? 1 : 0) - (a.hasOpen ? 1 : 0) ||
          b.topWeight - a.topWeight ||
          a.nextIndex - b.nextIndex ||
          a.number - b.number,
      );
      if (sortDir === 'asc') base.reverse();
    }
    return base.map((x) => ({ number: x.number, hasOpen: x.hasOpen }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.key, sortBy, sortDir, resortToken]);

  const rows = rowSnapshot
    .map(({ number, hasOpen }) => {
      const t = event.teams.find((tt) => tt.number === number);
      if (!t) return null;
      const open = sortTickets(openByTeam[number] ?? []);
      const next = nextMatch(event, number);
      return { t, open, next, hasOpen };
    })
    .filter(Boolean);

  const withOpen = byTeam ? [] : rows.filter((r) => r.hasOpen);
  const rest = byTeam ? rows : rows.filter((r) => !r.hasOpen);
  const nowQueuing = event.nexus?.live?.nowQueuing;

  const Row = ({ r }) => {
    const time = r.next ? matchTimeMs(r.next, nexusTimes) : null;
    return (
      <li className="row" style={{ padding: 0 }}>
        <button className="row" style={{ flex: 1, minWidth: 0, border: 0 }}
          onClick={() => nav(`/event/${event.key}/team/${r.t.number}`)}>
          <TeamBox number={r.t.number} color={colorFor(r.t.number)} />
          <div className="row-main">
            <div className="row-title">{r.open[0]?.title ?? r.t.nickname}</div>
            <div className="row-sub">
              {r.open.length > 1 ? `+${r.open.length - 1} more open · ` : ''}
              {r.next
                ? `Next: ${matchLabel(r.next)}${time ? ` · ${time.kind === 'queue' ? 'queue' : 'start'} ~${formatClock(time.ms)}` : ''}${time?.status ? ` · ${time.status}` : ''}`
                : 'No more scheduled matches'}
            </div>
          </div>
          {r.open.length > 0 && <span className="count-badge">{r.open.length}</span>}
        </button>
        <button className="icon-btn" aria-label={`Flag team ${r.t.number} for follow-up`}
          onClick={() => nav(`/event/${event.key}/ticket/followup/${r.t.number}`)}>
          <Icon name="flag" size={18} />
        </button>
      </li>
    );
  };

  return (
    <>
      {nowQueuing && <div className="notice section">Now queuing: <strong>{nowQueuing}</strong></div>}
      {event.matches.length === 0 && (
        <div className="notice section">No match schedule on TBA yet. Refresh once the schedule is posted.</div>
      )}
      {withOpen.length > 0 && (
        <section className="section">
          <button className="section-head section-toggle" aria-expanded={!openCollapsed} onClick={toggleOpen}>
            <h2>Open tickets</h2>
            <span className="aside">
              {withOpen.length} team{withOpen.length === 1 ? '' : 's'}
              <span className="led-chevron"><Icon name="chevron" size={18} /></span>
            </span>
          </button>
          {!openCollapsed && (
            <ul className="row-list sheet">{withOpen.map((r) => <Row key={r.t.number} r={r} />)}</ul>
          )}
        </section>
      )}
      <section className="section">
        <div className="section-head">
          <h2>{byTeam ? 'Teams' : 'Up next on the field'}</h2>
        </div>
        <ul className="row-list sheet">{rest.map((r) => <Row key={r.t.number} r={r} />)}</ul>
      </section>
      <Legend phase="event" />
    </>
  );
}

// ---------------- Teams ----------------

function TeamsTab({ ctx }) {
  const { event, readiness, openByTeam, colorFor, phaseInfo } = ctx;
  const [q, setQ] = useState('');
  const pits = event.nexus?.pits ?? {};
  const list = event.teams.filter((t) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return String(t.number).startsWith(s) || t.nickname?.toLowerCase().includes(s);
  });

  if (!event.teams.length) {
    return <div className="notice">TBA hasn't published the team list for this event yet. Refresh closer to the event.</div>;
  }

  return (
    <>
      <input className="input" style={{ marginBottom: 12 }} placeholder="Filter by number or name"
        value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter teams" />
      <ul className="row-list sheet">
        {list.map((t) => (
          <li key={t.number} className="row team-row" style={{ padding: 0 }}>
            <div className="team-row-top">
              <button className="row" style={{ flex: 1, minWidth: 0, border: 0 }}
                onClick={() => nav(`/event/${event.key}/team/${t.number}`)}>
                <TeamBox number={t.number} color={colorFor(t.number)} />
                <div className="row-main">
                  <div className="row-title">{t.nickname}</div>
                  <div className="row-sub">
                    {pits[t.number] ? `Pit ${pits[t.number]} · ` : ''}
                    {[t.city, t.stateProv].filter(Boolean).join(', ')}
                  </div>
                </div>
                {openByTeam[t.number]?.length > 0 && (
                  <span className="count-badge" title="Unresolved tickets">{openByTeam[t.number].length}</span>
                )}
              </button>
              <button className="icon-btn" aria-label={`Flag team ${t.number} for follow-up`}
                onClick={() => nav(`/event/${event.key}/ticket/followup/${t.number}`)}>
                <Icon name="flag" size={18} />
              </button>
            </div>
            {/* Outside the row's button so each mark can be tapped on its own. */}
            <div className="team-row-marks">
              <ReadinessMarks readiness={readiness[t.number]}
                onToggle={(k) => toggleReadiness(event.key, t.number, k, readiness[t.number])} />
            </div>
          </li>
        ))}
      </ul>
      <Legend phase={phaseInfo.phase} />
    </>
  );
}

// ---------------- Tickets ----------------

const FILTERS = [
  ['all', 'All'],
  ['unresolved', 'Unresolved'],
  ['resolved', 'Resolved'],
  ['declined', 'Declined'],
];

function TicketsTab({ ctx, onExport, exporting }) {
  const { event, tickets } = ctx;
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const shown = sortTickets(tickets).filter((t) => {
    if (filter !== 'all' && t.status !== filter) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return (
      String(t.team).startsWith(s) ||
      t.title.toLowerCase().includes(s) ||
      t.tags?.some((tag) => tag.toLowerCase().includes(s))
    );
  });

  return (
    <>
      <button className="btn primary block" style={{ marginBottom: 14 }}
        onClick={() => nav(`/event/${event.key}/ticket/new`)}>
        <Icon name="plus" size={20} /> New ticket
      </button>
      <button className="btn block" style={{ marginTop: -6, marginBottom: 14 }} onClick={() => setImporting(true)}>
        <Icon name="paste" size={20} /> Import from a Nexus Slack message
      </button>
      {importing && <NexusImport event={event} onClose={() => setImporting(false)} />}
      <div className="inline" style={{ marginBottom: 10 }}>
        {FILTERS.map(([k, l]) => (
          <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {l} ({k === 'all' ? tickets.length : tickets.filter((t) => t.status === k).length})
          </button>
        ))}
      </div>
      <input className="input" style={{ marginBottom: 12 }} placeholder="Search team, title, or tag"
        value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tickets" />
      {shown.length ? (
        <ul className="row-list sheet">
          {shown.map((t) => <TicketRow key={t.id} ticket={t} />)}
        </ul>
      ) : (
        <p className="muted">
          {tickets.length ? 'No tickets match this filter.' : 'No tickets yet. Log the first one when a team asks for help.'}
        </p>
      )}
      <button className="btn block" style={{ marginTop: 18 }} onClick={() => onExport(false)} disabled={!!exporting}>
        <Icon name="report" size={20} /> {exporting === 'full' ? 'Building report…' : 'Export event report (.docx)'}
      </button>
      <button className="btn block" style={{ marginTop: 8 }} onClick={() => onExport(true)} disabled={!!exporting}>
        <Icon name="report" size={20} /> {exporting === 'anon' ? 'Building report…' : 'Export anonymized report'}
      </button>
      <p className="hint">
        The anonymized report swaps every team number and team name for a random placeholder like
        “focused_lovelace”, including inside ticket text. Names change with every export.
      </p>
    </>
  );
}

/** Paste a Nexus technical-help request from Slack; shows what was picked out of it, then
 *  opens the ticket form pre-filled so nothing is saved until it's reviewed. */
function NexusImport({ event, onClose }) {
  const [text, setText] = useState('');
  const parsed = text.trim() ? parseNexusMessage(text, event) : null;
  const onRoster = parsed?.team && event.teams.some((t) => t.number === parsed.team);

  async function pasteClipboard() {
    try {
      setText(await navigator.clipboard.readText());
    } catch {
      toast('Clipboard access was blocked. Long-press the box and paste instead.');
    }
  }

  function open() {
    stashDraft(parsed);
    onClose();
    nav(`/event/${event.key}/ticket/import`);
  }

  return (
    <Modal title="Import from Nexus" onClose={onClose}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          In Slack, long-press the Nexus message (a team's help request or an FTA follow-up), choose Copy text, and paste it here.
        </p>
        <textarea className="input" rows={6} autoFocus value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Paste the Nexus message…" aria-label="Nexus Slack message" />
        {navigator.clipboard?.readText && (
          <div><button className="btn" style={{ minHeight: 36 }} onClick={pasteClipboard}>Paste from clipboard</button></div>
        )}
        {parsed && (
          <div className="sheet sheet-pad">
            <dl className="dl">
              <dt>Type</dt><dd>{parsed.kind === 'fta' ? 'FTA follow-up request' : 'Team help request'}</dd>
              <dt>Team</dt>
              <dd>
                {parsed.team ?? <span className="error">Not found — pick it on the next screen</span>}
                {parsed.team && !onRoster && <span className="muted"> (not on this event's roster)</span>}
              </dd>
              {parsed.pit && (<><dt>Pit</dt><dd>{parsed.pit}</dd></>)}
              <dt>Title</dt><dd>{parsed.title}</dd>
              <dt>Tags</dt><dd>{parsed.tags.length ? parsed.tags.join(', ') : 'None matched'}</dd>
              <dt>Last match</dt>
              <dd>
                {parsed.lastMatch || (parsed.mentionedMatch
                  ? `Not set (${parsed.mentionedMatch} looks like their next match)`
                  : 'Not found — filled from TBA if possible')}
              </dd>
            </dl>
          </div>
        )}
        <button className="btn primary" disabled={!parsed} onClick={open}>Review as a new ticket</button>
      </div>
    </Modal>
  );
}
