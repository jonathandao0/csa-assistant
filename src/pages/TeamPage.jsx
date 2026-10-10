import { useEffect, useRef, useState } from 'react';
import { Icon, Loading, Modal, TeamBox, TicketRow, TopBar } from '../components/ui.jsx';
import { db, useLive } from '../lib/db.js';
import {
  PRIORITIES,
  READINESS_ITEMS,
  TICKET_STATUS,
  formatClock,
  formatDateTime,
  lastPlayedMatch,
  matchLabel,
  matchTimeMs,
  nexusReadiness,
  nexusTimesByMatchKey,
  sortTickets,
  tagCounts,
  teamMatches,
  ticketChains,
  ticketYear,
} from '../lib/logic.js';
import { goBack, nav } from '../lib/router.js';
import { fetchTeamMedia } from '../lib/sync.js';
import { compressImage, deleteTickets, toast } from '../lib/util.js';
import { setIgnored, toggleReadiness, useEventContext } from './EventPage.jsx';

export default function TeamPage({ eventKey, number }) {
  const ctx = useEventContext(eventKey);
  const allTeamTickets = useLive(() => db.byIndex('tickets', 'team', number), [number]);
  const allTickets = useLive(() => db.all('tickets'), []);
  const events = useLive(() => db.all('events'), []);

  if (ctx.loading || !allTeamTickets || !allTickets || !events) return <Loading />;
  if (ctx.missing) return <TopBar title="Event not found" back={() => nav('/')} />;

  const { event, readiness, colorFor } = ctx;
  const team = event.teams.find((t) => t.number === number) ?? { number, nickname: `Team ${number}` };
  const r = readiness[number];
  // History only covers this season — last year's robot is a different robot.
  const seasonTickets = allTeamTickets.filter((t) => ticketYear(t) === event.year);
  const here = sortTickets(seasonTickets.filter((t) => t.eventKey === eventKey));
  const elsewhere = seasonTickets.filter((t) => t.eventKey !== eventKey);
  const pit = event.nexus?.pits?.[number];
  const nx = nexusReadiness(event, number);

  return (
    <>
      <TopBar title={`${number} · ${team.nickname ?? ''}`} subtitle={event.shortName}
        back={() => goBack(`/event/${eventKey}/tab/teams`)} />
      <main className="page">
        <section className="section team-head">
          <div className="team-head-info">
            <TeamBox number={number} color={colorFor(number)} large />
            <div style={{ minWidth: 0 }}>
              <h2>{team.nickname}</h2>
              <div className="muted small">
                {[team.city, team.stateProv, team.country].filter(Boolean).join(', ')}
              </div>
              {pit && <div className="small" style={{ marginTop: 2 }}><strong>Pit {pit}</strong></div>}
            </div>
          </div>
          <RobotThumb number={number} year={event.year} />
        </section>

        <section className="section">
          <div className="section-head">
            <h2>Readiness</h2>
            <button className="chip" aria-pressed={!!r?.ignored}
              onClick={() => setIgnored(eventKey, number, !r?.ignored, r)}>
              {r?.ignored ? 'Un-ignore team' : "Ignore (didn't show up)"}
            </button>
          </div>
          <div className="sheet">
            {READINESS_ITEMS.map(([k, label]) => (
              <label key={k} className="check-row">
                <input type="checkbox" checked={!!r?.[k]} onChange={() => toggleReadiness(eventKey, number, k, r)} />
                <span style={{ flex: 1 }}>{label}</span>
                {k === 'inspection' && nx.inspectionStatus && (
                  <span className="small muted">
                    Nexus: {nx.inspectionStatus}{nx.inspectionPassed ? '' : ' (not counted as passed)'}
                  </span>
                )}
                {k === 'radio' && nx.radio !== undefined && (
                  <span className="small muted">Nexus: {nx.radio ? 'done' : 'not yet'}</span>
                )}
                {k === 'field' && lastPlayedMatch(event, number) && (
                  <span className="small muted">Played {matchLabel(lastPlayedMatch(event, number))}</span>
                )}
              </label>
            ))}
          </div>
        </section>

        <MatchesSection event={event} number={number} />

        <NotesSection eventKey={eventKey} number={number} record={r} />

        <section className="section">
          <div className="section-head">
            <h2>Tickets at this event</h2>
            <span className="inline">
              <button className="btn" style={{ minHeight: 36 }}
                onClick={() => nav(`/event/${eventKey}/ticket/followup/${number}`)}>
                <Icon name="flag" size={18} /> Flag for follow-up
              </button>
              <button className="btn" style={{ minHeight: 36 }}
                onClick={() => nav(`/event/${eventKey}/ticket/new/${number}`)}>
                <Icon name="plus" size={18} /> New
              </button>
            </span>
          </div>
          {here.length ? (
            <ul className="row-list sheet">
              {here.slice(0, 6).map((t) => <TicketRow key={t.id} ticket={t} showTeam={false} />)}
            </ul>
          ) : (
            <p className="muted">No tickets for this team here yet.</p>
          )}
          {here.length > 6 && <p className="hint">Showing 6 of {here.length}. See the Tickets tab for all.</p>}
        </section>

        <IssuesByMatch event={event} number={number} tickets={here} />

        <IssuesOverTime teamTickets={seasonTickets} />

        <HistorySection number={number} year={event.year} teamTickets={seasonTickets} elsewhere={elsewhere}
          allTickets={allTickets.filter((t) => ticketYear(t) === event.year)} events={events} />

        <section className="section">
          <div className="section-head"><h2>Team details</h2></div>
          <div className="sheet sheet-pad">
            <dl className="dl">
              {team.schoolName && (<><dt>School</dt><dd>{team.schoolName}</dd></>)}
              {team.rookieYear && (<><dt>Rookie year</dt><dd>{team.rookieYear}</dd></>)}
              {team.website && (
                <><dt>Website</dt><dd><a href={team.website} target="_blank" rel="noreferrer">{team.website.replace(/^https?:\/\//, '')}</a></dd></>
              )}
              <dt>TBA</dt>
              <dd><a href={`https://www.thebluealliance.com/team/${number}/${event.year}`} target="_blank" rel="noreferrer">Team {number} on TBA</a></dd>
            </dl>
          </div>
        </section>
      </main>
    </>
  );
}

function MatchesSection({ event, number }) {
  const matches = teamMatches(event, number);
  if (!matches.length) return null;
  const nexusTimes = nexusTimesByMatchKey(event);
  const upcoming = matches.filter((m) => !m.played).slice(0, 4);
  const played = matches.filter((m) => m.played);
  return (
    <section className="section">
      <div className="section-head">
        <h2>Matches</h2>
        <span className="aside">{played.length} played · {matches.length - played.length} to go</span>
      </div>
      {upcoming.length ? (
        <ul className="row-list sheet">
          {upcoming.map((m) => {
            const alliance = m.red.includes(number) ? 'Red' : 'Blue';
            const time = matchTimeMs(m, nexusTimes);
            return (
              <li key={m.key} className="row" style={{ cursor: 'default' }}>
                <span className="num" style={{ fontSize: '1.2rem', minWidth: 48 }}>{matchLabel(m)}</span>
                <div className="row-main">
                  <div className="row-title">{alliance} alliance</div>
                  <div className="row-sub">
                    With {(alliance === 'Red' ? m.red : m.blue).filter((n) => n !== number).join(', ')}
                  </div>
                </div>
                {time && <span className="small muted">{time.kind === 'queue' ? 'Queue' : 'Start'} ~{formatClock(time.ms)}</span>}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">No more scheduled matches.</p>
      )}
    </section>
  );
}

/** Freeform notes for this team at this event that aren't tied to any one ticket.
 *  Stored on the readiness record (already keyed by event + team) and auto-saved shortly
 *  after typing stops so it doesn't write to the database on every keystroke. */
function NotesSection({ eventKey, number, record }) {
  const [value, setValue] = useState(record?.notes ?? '');
  const [saved, setSaved] = useState(true);
  const timer = useRef(null);
  const recordRef = useRef(record);

  useEffect(() => {
    recordRef.current = record;
  }, [record]);
  useEffect(() => {
    setValue(record?.notes ?? '');
    setSaved(true);
    // Only reset from the database when switching teams/events, not on every live update,
    // so it doesn't clobber text the user is mid-typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventKey, number]);
  useEffect(() => () => clearTimeout(timer.current), []);

  function onChange(e) {
    const v = e.target.value;
    setValue(v);
    setSaved(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const id = `${eventKey}:${number}`;
      const prev = recordRef.current ?? { id, eventKey, team: number, radio: false, inspection: false, field: false };
      db.put('readiness', { ...prev, notes: v, updatedAt: Date.now() }).then(() => setSaved(true));
    }, 600);
  }

  return (
    <section className="section">
      <div className="section-head">
        <h2>Notes</h2>
        <span className="small muted">{saved ? 'Saved' : 'Saving…'}</span>
      </div>
      <div className="sheet sheet-pad">
        <textarea className="input" rows={4} value={value} onChange={onChange}
          placeholder="Anything worth remembering about this team that isn't a ticket…" />
      </div>
    </section>
  );
}

/** Stacked bars of this team's tickets at this event, one column per match they've played
 *  (plus any later match a ticket names), bucketed by the ticket's "last match played". A
 *  column of issues right after a particular match is the thing to spot; tickets from before
 *  their first match, a practice match, or N/A go in a leading "Pre" column. */
function IssuesByMatch({ event, number, tickets }) {
  if (!tickets.length) return null;
  const schedule = teamMatches(event, number).map((m) => ({ label: matchLabel(m), played: m.played }));
  const labels = schedule.map((m) => m.label);
  const byLabel = {};
  const pre = [];
  for (const t of tickets) {
    if (t.lastMatch && labels.includes(t.lastMatch)) (byLabel[t.lastMatch] ??= []).push(t);
    else pre.push(t);
  }
  // The whole schedule, so the chart reads as a timeline of the event; matches not played
  // yet are greyed out.
  const cols = [
    ...(pre.length ? [{ label: 'Pre', list: pre, played: true }] : []),
    ...schedule.map((m) => ({ label: m.label, list: byLabel[m.label] ?? [], played: m.played })),
  ];
  const max = Math.max(1, ...cols.map((c) => c.list.length));
  const order = ['unresolved', 'declined', 'resolved'];

  const colW = 30;
  const barW = 18;
  const chartH = 76;
  const W = Math.max(cols.length * colW, colW);
  const H = chartH + 18;
  const unit = (chartH - 6) / max;

  return (
    <section className="section">
      <div className="section-head">
        <h2>Issues by match</h2>
        <span className="aside">{tickets.length} ticket{tickets.length === 1 ? '' : 's'} here</span>
      </div>
      <div className="sheet sheet-pad">
        <div style={{ overflowX: 'auto' }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W, height: 'auto', display: 'block' }}
            role="img" aria-label="Tickets for this team at this event, grouped by the match before each was logged">
            <line x1="0" y1={chartH} x2={W} y2={chartH} style={{ stroke: 'var(--line)', strokeWidth: 1 }} />
            {cols.map((c, i) => {
              const x = i * colW + (colW - barW) / 2;
              let y = chartH;
              const sorted = [...c.list].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
              return (
                <g key={c.label}>
                  {sorted.map((t) => {
                    y -= unit;
                    return (
                      <rect key={t.id} x={x} y={y + 1} width={barW} height={unit - 1} rx="2"
                        style={{ fill: STATUS_COLOR[t.status] ?? 'var(--muted)', cursor: 'pointer' }}
                        onClick={() => nav(`/event/${t.eventKey}/ticket/${t.id}`)}>
                        <title>{`${c.label}: ${t.title}`}</title>
                      </rect>
                    );
                  })}
                  {c.list.length > 0 && (
                    <text x={x + barW / 2} y={y - 2} textAnchor="middle" style={{ fontSize: 10, fontWeight: 600, fill: 'var(--muted)' }}>
                      {c.list.length}
                    </text>
                  )}
                  <text x={x + barW / 2} y={chartH + 11} textAnchor="middle"
                    style={{ fontSize: 9, fill: c.list.length ? 'var(--ink)' : 'var(--muted)', opacity: c.played ? 1 : 0.5 }}>
                    {c.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="legend" style={{ marginTop: 4, justifyContent: 'center' }}>
          <span><i style={{ background: 'var(--st-watch)' }} /> Unresolved</span>
          <span><i style={{ background: 'var(--st-ready)' }} /> Resolved</span>
          <span><i style={{ background: 'var(--muted)' }} /> Declined</span>
        </div>
        <p className="hint" style={{ margin: '6px 0 0' }}>
          Each block is one ticket, placed at the match it was logged after (its last match played). Greyed
          matches haven't been played yet. Tap a block to open it.
        </p>
      </div>
    </section>
  );
}

const PRIORITY_RANK = Object.fromEntries(PRIORITIES.map(([k], i) => [k, i]));
const STATUS_COLOR = { unresolved: 'var(--st-watch)', resolved: 'var(--st-ready)', declined: 'var(--muted)' };

/** One dot per ticket, in the order they happened (by match/time, not lumped into one bar
 *  per event) — height is priority, so a run of tall dots close together is a spike worth
 *  noticing, and a gap between events shows up as a gap rather than getting flattened away.
 *  Rendered at its natural (small) size rather than stretched to fill the container. */
function IssuesOverTime({ teamTickets }) {
  const sorted = [...teamTickets].sort((a, b) => a.createdAt - b.createdAt);
  if (!sorted.length) return null;

  const colW = 28;
  const chartH = 46;
  const topPad = 8;
  const W = Math.max(sorted.length * colW, colW);
  const H = chartH + 24;

  return (
    <section className="section">
      <div className="section-head"><h2>Issues over time</h2></div>
      <div className="sheet sheet-pad">
        <div style={{ overflowX: 'auto' }}>
          <svg viewBox={`0 0 ${W} ${H}`}
            style={{ width: W, height: 'auto', display: 'block' }}
            role="img" aria-label="Each ticket for this team, in the order it happened">
            <line x1="0" y1={chartH} x2={W} y2={chartH} style={{ stroke: 'var(--line)', strokeWidth: 1 }} />
            {sorted.map((t, i) => {
              const prev = sorted[i - 1];
              const x = i * colW + colW / 2;
              const rank = PRIORITY_RANK[t.priority] ?? 0;
              const y = chartH - topPad - (rank / (PRIORITIES.length - 1)) * (chartH - topPad * 2);
              const color = STATUS_COLOR[t.status] ?? 'var(--muted)';
              const eventChanged = prev && prev.eventKey !== t.eventKey;
              return (
                <g key={t.id}>
                  {eventChanged && (
                    <line x1={x - colW / 2} y1="0" x2={x - colW / 2} y2={chartH}
                      style={{ stroke: 'var(--line)', strokeDasharray: '3 3', strokeWidth: 1 }} />
                  )}
                  <g onClick={() => nav(`/event/${t.eventKey}/ticket/${t.id}`)} style={{ cursor: 'pointer' }}>
                    <title>{`${t.title} — ${t.eventName || t.eventKey}, ${formatDateTime(t.createdAt)}`}</title>
                    <line x1={x} y1={chartH} x2={x} y2={y} style={{ stroke: color, strokeWidth: 1.5, opacity: 0.55 }} />
                    <circle cx={x} cy={y} r="3.5" style={{ fill: color }} />
                  </g>
                  <text x={x} y={chartH + 10} textAnchor="middle" style={{ fontSize: 6, fill: 'var(--muted)' }}>
                    {t.lastMatch || new Date(t.createdAt).toLocaleDateString([], { month: 'numeric', day: 'numeric' })}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="legend" style={{ marginTop: 4, justifyContent: 'center' }}>
          <span><i style={{ background: 'var(--st-watch)' }} /> Unresolved</span>
          <span><i style={{ background: 'var(--st-ready)' }} /> Resolved</span>
          <span><i style={{ background: 'var(--muted)' }} /> Declined</span>
        </div>
        <p className="hint" style={{ margin: '6px 0 0' }}>
          Each dot is one ticket, in order by match/time — height is priority (normal or high). Tap a dot to open it.
        </p>
      </div>
    </section>
  );
}

/** Short summary of this team's issues from other events this season plus linked issue chains. */
function HistorySection({ number, year, teamTickets, elsewhere, allTickets, events }) {
  const byId = Object.fromEntries(allTickets.map((t) => [t.id, t]));
  const chains = ticketChains(teamTickets, byId).filter((c) => c.length > 1);
  const eventName = Object.fromEntries(events.map((e) => [e.key, e.shortName]));
  const grouped = {};
  for (const t of elsewhere) (grouped[t.eventKey] ??= []).push(t);
  const groups = Object.entries(grouped).sort((a, b) => b[1][0].createdAt - a[1][0].createdAt);

  if (!groups.length && !chains.length) {
    return (
      <section className="section">
        <div className="section-head"><h2>History</h2></div>
        <p className="muted">No issues logged for this team at other {year} events.</p>
      </section>
    );
  }

  async function clearHistory() {
    if (!elsewhere.length) return;
    if (!confirm(`Delete team ${number}'s ${elsewhere.length} ticket${elsewhere.length === 1 ? '' : 's'} from other ${year} events? Tickets at this event are kept. This cannot be undone.`)) return;
    await deleteTickets(elsewhere.map((t) => t.id));
    toast('History cleared');
  }

  return (
    <section className="section">
      <div className="section-head">
        <h2>History</h2>
        {elsewhere.length > 0 && (
          <button className="chip" onClick={clearHistory}>Clear history</button>
        )}
      </div>
      {chains.length > 0 && (
        <div className="sheet sheet-pad stack" style={{ marginBottom: 12 }}>
          <strong>Continuing issues</strong>
          {chains.map((c) => {
            const latest = c[c.length - 1];
            const evs = new Set(c.map((t) => t.eventKey)).size;
            return (
              <button key={c[0].id} className="btn" style={{ justifyContent: 'flex-start', textAlign: 'left', height: 'auto', padding: '8px 12px' }}
                onClick={() => nav(`/event/${latest.eventKey}/ticket/${latest.id}`)}>
                <span>
                  <strong>{c[0].title}</strong>
                  <span className="muted small" style={{ display: 'block', fontWeight: 400 }}>
                    {c.length} linked tickets{evs > 1 ? ` across ${evs} events` : ''} · latest {TICKET_STATUS[latest.status].short.toLowerCase()}
                    {tagCounts(c).length ? ` · ${tagCounts(c).slice(0, 3).map(([t]) => t).join(', ')}` : ''}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      {groups.map(([key, list]) => {
        const tags = tagCounts(list).slice(0, 4);
        const open = list.filter((t) => t.status === 'unresolved').length;
        return (
          <div key={key} style={{ marginBottom: 12 }}>
            <div className="small" style={{ marginBottom: 4 }}>
              <strong>{eventName[key] ?? list[0].eventName ?? key}</strong>
              <span className="muted">
                {' '}· {list.length} issue{list.length === 1 ? '' : 's'}
                {tags.length ? ` · ${tags.map(([t, n]) => (n > 1 ? `${t} ×${n}` : t)).join(', ')}` : ''}
                {open ? ` · ${open} left unresolved` : ''}
              </span>
            </div>
            <ul className="row-list sheet">
              {sortTickets(list).slice(0, 3).map((t) => <TicketRow key={t.id} ticket={t} showTeam={false} />)}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

/** Robot photo thumbnail plus a swipeable viewer. Your own photo (if any) comes first, then
 *  TBA's. A photo that fails to load is dropped from the set by URL rather than by shifting
 *  an index, so a broken link can't send the viewer round in circles. */
function RobotThumb({ number, year }) {
  const mine = useLive(() => db.get('photos', String(number)), [number]);
  const [tbaMedia, setTbaMedia] = useState(null);
  const [failed, setFailed] = useState(() => new Set());
  const [idx, setIdx] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const fileRef = useRef(null);
  const swipe = useRef(null);

  useEffect(() => {
    let alive = true;
    db.get('media', `${number}:${year}`).then((m) => alive && m && setTbaMedia(m));
    fetchTeamMedia(number, year).then((m) => alive && setTbaMedia(m)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [number, year]);

  // Probe every TBA photo up front so dead links drop out before you page to them and the
  // count on the thumbnail is right.
  useEffect(() => {
    let alive = true;
    for (const src of tbaMedia?.photos ?? []) {
      const img = new Image();
      img.onerror = () => alive && setFailed((f) => new Set(f).add(src));
      img.src = src;
    }
    return () => {
      alive = false;
    };
  }, [tbaMedia]);

  const photos = [
    ...(mine?.dataUrl ? [{ src: mine.dataUrl, mine: true }] : []),
    ...(tbaMedia?.photos ?? []).map((src) => ({ src, mine: false })),
  ].filter((p) => !failed.has(p.src));
  const count = photos.length;
  const cur = count ? Math.min(idx, count - 1) : 0;
  const photo = photos[cur];

  const markFailed = (src) => setFailed((f) => new Set(f).add(src));
  const step = (d) => count > 1 && setIdx((cur + d + count) % count);

  useEffect(() => {
    if (!expanded) return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function onTouchStart(e) {
    const t = e.touches[0];
    swipe.current = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e) {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await compressImage(file);
      await db.put('photos', { id: String(number), year, dataUrl, updatedAt: Date.now() });
      setIdx(0);
      toast('Robot photo saved');
    } catch (err) {
      toast(err.message);
    }
  }

  return (
    <>
      <button className="robot-thumb" onClick={() => setExpanded(true)} aria-label="View robot photos">
        {photos[0] ? (
          <img src={photos[0].src} alt={`Team ${number} robot`} onError={() => markFailed(photos[0].src)} />
        ) : (
          <span className="robot-thumb-empty">
            {tbaMedia?.avatar ? (
              <img src={tbaMedia.avatar} alt="" width="32" height="32" style={{ imageRendering: 'pixelated' }} />
            ) : (
              <Icon name="camera" size={26} />
            )}
          </span>
        )}
        {count > 1 && <span className="robot-thumb-count">{count}</span>}
      </button>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
      {expanded && (
        <Modal title={`Team ${number} robot photo`} onClose={() => setExpanded(false)}>
          {photo ? (
            <div className="photo-viewer" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
              <img key={photo.src} className="robot-photo" src={photo.src} alt={`Team ${number} robot`}
                draggable="false" onError={() => markFailed(photo.src)} />
              {count > 1 && (
                <>
                  <button className="photo-nav prev" aria-label="Previous photo" onClick={() => step(-1)}>
                    <Icon name="back" />
                  </button>
                  <button className="photo-nav next" aria-label="Next photo" onClick={() => step(1)}>
                    <Icon name="forward" />
                  </button>
                  <div className="photo-dots" aria-hidden="true">
                    {photos.map((p, i) => <i key={p.src} className={i === cur ? 'on' : ''} />)}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="photo-empty">
              <p style={{ margin: 0 }}>No robot photo on TBA for {year}. Take one in the pit.</p>
            </div>
          )}
          <div className="inline sheet-pad" style={{ justifyContent: 'space-between' }}>
            <span className="small muted">
              {photo ? (photo.mine ? 'Your photo' : 'Photo from TBA') : ''}
              {count > 1 ? ` · ${cur + 1} of ${count} · swipe for more` : ''}
            </span>
            <span className="inline">
              {mine && (
                <button className="btn danger" style={{ minHeight: 36 }}
                  onClick={() => db.del('photos', String(number)).then(() => setIdx(0))}>Remove mine</button>
              )}
              <button className="btn" style={{ minHeight: 36 }} onClick={() => fileRef.current?.click()}>
                <Icon name="camera" size={18} /> {mine ? 'Retake' : 'Add photo'}
              </button>
            </span>
          </div>
        </Modal>
      )}
    </>
  );
}
