import { useEffect, useMemo, useState } from 'react';
import { Icon, Loading, Modal, StatusPill, TopBar } from '../components/ui.jsx';
import { db, newId, useLive } from '../lib/db.js';
import {
  PRESET_TAGS,
  PRIORITIES,
  TAG_CATEGORIES,
  TICKET_STATUS,
  formatDateTime,
  lastPlayedMatch,
  matchLabel,
  nextTicketSeq,
  ticketYear,
  teamMatches,
  ticketNumber,
  ticketToText,
} from '../lib/logic.js';
import { goBack, nav } from '../lib/router.js';
import { clearDraft, readDraft } from '../lib/nexusImport.js';
import { copyText, toast } from '../lib/util.js';

const CUSTOM_MATCH = '__custom__';

const blank = (eventKey, team, followUp) => ({
  id: null,
  eventKey,
  team: team ? Number(team) : '',
  title: followUp ? 'Possible issue — follow up' : '',
  description: '',
  status: 'unresolved',
  priority: 'normal',
  tags: followUp ? ['Follow-up'] : [],
  lastMatch: '',
  resolution: '',
  links: [],
});

export default function TicketPage({ eventKey, id, presetTeam }) {
  const isFollowUp = id === 'followup';
  const isImport = id === 'import';
  const isNew = id === 'new' || isFollowUp || isImport;
  const event = useLive(() => db.get('events', eventKey), [eventKey]);
  const existing = useLive(() => (isNew ? Promise.resolve(null) : db.get('tickets', id)), [id]);
  const allTickets = useLive(() => db.all('tickets'), []);
  const [form, setForm] = useState(null);
  const [teamText, setTeamText] = useState('');
  const [teamOpen, setTeamOpen] = useState(false);
  const [matchTouched, setMatchTouched] = useState(false);
  const [picking, setPicking] = useState(false);
  const [customTag, setCustomTag] = useState('');
  const [error, setError] = useState('');

  // Initialise the form once the ticket (or a blank one) is available.
  useEffect(() => {
    if (form || existing === undefined || event === undefined) return;
    if (isNew) {
      const f = blank(eventKey, presetTeam, isFollowUp);
      const draft = isImport ? readDraft() : null;
      if (draft) {
        Object.assign(f, {
          team: draft.team ?? '',
          title: draft.title ?? '',
          description: draft.description ?? '',
          tags: draft.tags ?? [],
          lastMatch: draft.lastMatch ?? '',
        });
        if (draft.lastMatch) setMatchTouched(true);
      }
      if (f.team && event && !f.lastMatch) {
        const last = lastPlayedMatch(event, f.team);
        if (last) f.lastMatch = matchLabel(last);
      }
      setForm(f);
      setTeamText(f.team ? String(f.team) : '');
    } else if (existing) {
      setForm({ ...existing, links: existing.links ?? [], tags: existing.tags ?? [] });
      setTeamText(existing.team ? String(existing.team) : '');
      setMatchTouched(true);
    }
  }, [existing, event, form, isNew, isFollowUp, isImport, eventKey, presetTeam]);

  const byId = useMemo(() => Object.fromEntries((allTickets ?? []).map((t) => [t.id, t])), [allTickets]);
  const knownTags = useMemo(() => {
    const s = new Set(PRESET_TAGS);
    for (const t of allTickets ?? []) for (const tag of t.tags ?? []) s.add(tag);
    for (const tag of form?.tags ?? []) s.add(tag);
    return [...s];
  }, [allTickets, form?.tags]);
  // Groups tags by category so the picker isn't one long undifferentiated list; anything
  // used before that isn't a preset falls into "Other".
  const categorizedTags = useMemo(() => {
    const remaining = new Set(knownTags);
    const cats = TAG_CATEGORIES.map(([name, tags]) => {
      const list = tags.filter((t) => remaining.has(t));
      list.forEach((t) => remaining.delete(t));
      return [name, list];
    });
    if (remaining.size) cats.push(['Other', [...remaining]]);
    return cats.filter(([, list]) => list.length > 0);
  }, [knownTags]);

  // Not filtered to "played" matches: TBA can take a few minutes to post actual results
  // during a live event, so a CSA writing up a ticket right after a match may find it
  // still shows as unplayed. Listing the whole schedule avoids that lag hiding the match.
  const matchOptions = useMemo(() => {
    if (!event || !form?.team) return [];
    return teamMatches(event, form.team).map((m) => matchLabel(m));
  }, [event, form?.team]);
  const [forceCustomMatch, setForceCustomMatch] = useState(false);
  const matchIsKnown = !form || form.lastMatch === '' || matchOptions.includes(form.lastMatch);
  const showCustomMatch = forceCustomMatch || !matchIsKnown;

  function changeMatchSelect(v) {
    setMatchTouched(true);
    if (v === CUSTOM_MATCH) {
      setForceCustomMatch(true);
      if (matchIsKnown) set({ lastMatch: '' });
    } else {
      setForceCustomMatch(false);
      set({ lastMatch: v });
    }
  }

  if (!isNew && existing === null) {
    return (
      <>
        <TopBar title="Ticket not found" back={() => goBack(`/event/${eventKey}/tab/tickets`)} />
        <main className="page"><p>This ticket was deleted.</p></main>
      </>
    );
  }
  if (!form || !allTickets || event === undefined) return <Loading />;

  const teams = event?.teams ?? [];
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  function changeTeam(value) {
    const team = value ? Number(value) : '';
    const patch = { team };
    if (!matchTouched && event && team) {
      const last = lastPlayedMatch(event, team);
      patch.lastMatch = last ? matchLabel(last) : '';
      setForceCustomMatch(false);
    }
    set(patch);
  }

  function pickTeam(number) {
    setTeamText(String(number));
    setTeamOpen(false);
    changeTeam(String(number));
  }

  const teamInfo = teams.find((t) => t.number === form.team)
    ?? (form.team ? { number: form.team, nickname: "Not on this event's roster" } : null);
  const teamSuggestions = teamText ? teams.filter((t) => String(t.number).startsWith(teamText)).slice(0, 8) : [];

  function toggleTag(tag) {
    set({ tags: form.tags.includes(tag) ? form.tags.filter((t) => t !== tag) : [...form.tags, tag] });
  }

  function addCustomTag(e) {
    e.preventDefault();
    const tag = customTag.trim();
    if (tag && !form.tags.includes(tag)) set({ tags: [...form.tags, tag] });
    setCustomTag('');
  }

  async function save() {
    if (!form.team) return setError('Choose the team this ticket is for.');
    if (!form.title.trim()) return setError('Give the ticket a short title.');
    const now = Date.now();
    const prevLinks = existing?.links ?? [];
    const ticketId = form.id ?? newId();
    const ticket = {
      ...form,
      id: ticketId,
      seq: existing?.seq ?? form.seq ?? nextTicketSeq(allTickets, form.team, Number(eventKey.slice(0, 4))),
      title: form.title.trim(),
      eventName: existing?.eventName ?? event?.shortName ?? eventKey,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      resolvedAt:
        form.status === 'resolved' ? (existing?.status === 'resolved' ? existing.resolvedAt : now) : null,
    };
    // Keep links two-way.
    const added = form.links.filter((l) => !prevLinks.includes(l));
    const removed = prevLinks.filter((l) => !form.links.includes(l));
    const others = [];
    for (const l of added) {
      const o = byId[l];
      if (o && !o.links?.includes(ticketId)) others.push({ ...o, links: [...(o.links ?? []), ticketId] });
    }
    for (const l of removed) {
      const o = byId[l];
      if (o) others.push({ ...o, links: (o.links ?? []).filter((x) => x !== ticketId) });
    }
    await db.putMany('tickets', [ticket, ...others]);
    if (isImport) clearDraft();
    toast(isNew ? 'Ticket created' : 'Ticket saved');
    goBack(`/event/${eventKey}/tab/tickets`);
  }

  async function remove() {
    if (!confirm('Delete this ticket? Links to it will be removed too.')) return;
    const others = form.links
      .map((l) => byId[l])
      .filter(Boolean)
      .map((o) => ({ ...o, links: (o.links ?? []).filter((x) => x !== form.id) }));
    if (others.length) await db.putMany('tickets', others);
    await db.del('tickets', form.id);
    toast('Ticket deleted');
    goBack(`/event/${eventKey}/tab/tickets`);
  }

  async function copyTicket() {
    const snapshot = {
      ...form,
      eventName: form.eventName || event?.shortName || eventKey,
      createdAt: form.createdAt || Date.now(),
    };
    await copyText(ticketToText(snapshot));
    toast('Ticket copied to clipboard');
  }

  return (
    <>
      <TopBar
        title={isFollowUp ? 'Flag for follow-up' : isImport ? 'Imported from Nexus' : isNew ? 'New ticket' : `Ticket ${ticketNumber(form)}`}
        subtitle={isNew ? event?.shortName : `Opened ${formatDateTime(form.createdAt)} · ${form.eventName ?? eventKey}`}
        back={() => goBack(`/event/${eventKey}/tab/tickets`)}
        actions={
          !isNew && (
            <button className="icon-btn" aria-label="Delete ticket" onClick={remove}>
              <Icon name="trash" />
            </button>
          )
        }
      />
      <main className="page stack" style={{ gap: 18 }}>
        <div className="field">
          <span>Team</span>
          <div className="combo-wrap">
            <input className="input" inputMode="numeric" placeholder="Type a team number…"
              value={teamText}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '');
                setTeamText(v);
                setTeamOpen(true);
                changeTeam(v);
              }}
              onFocus={() => setTeamOpen(true)}
              onBlur={() => setTimeout(() => setTeamOpen(false), 120)} />
            {teamOpen && teamSuggestions.length > 0 && (
              <ul className="combo-list" role="listbox">
                {teamSuggestions.map((t) => (
                  <li key={t.number}>
                    <button className="combo-option" onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickTeam(t.number)}>
                      <span className="num" style={{ minWidth: 48 }}>{t.number}</span>
                      <span>{t.nickname}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {teamInfo && <span className="hint">{teamInfo.nickname}</span>}
        </div>

        <label className="field">
          <span>Title</span>
          <input className="input" value={form.title} onChange={(e) => set({ title: e.target.value })}
            placeholder="e.g. Radio drops after hard hits" maxLength={120} />
        </label>

        <label className="field">
          <span>Description</span>
          <textarea className="input" value={form.description} onChange={(e) => set({ description: e.target.value })}
            placeholder="What the team saw, what you checked, logs or LED states" />
        </label>

        <div className="field">
          <span>Status</span>
          <div className="segmented status">
            {Object.entries(TICKET_STATUS).map(([k, v]) => (
              <button key={k} data-v={k} aria-pressed={form.status === k} onClick={() => set({ status: k })}>
                {v.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>Priority</span>
          <div className="segmented">
            {PRIORITIES.map(([k, l]) => (
              <button key={k} aria-pressed={form.priority === k} onClick={() => set({ priority: k })}>{l}</button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>Tags</span>
          {categorizedTags.map(([cat, tags]) => (
            <div key={cat} style={{ marginBottom: 8 }}>
              <div className="small muted" style={{ marginBottom: 4 }}>{cat}</div>
              <div className="inline" style={{ gap: 6 }}>
                {tags.map((tag) => (
                  <button key={tag} className="chip" aria-pressed={form.tags.includes(tag)} onClick={() => toggleTag(tag)}>
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <form className="inline" onSubmit={addCustomTag}>
            <input className="input" style={{ flex: 1 }} value={customTag} onChange={(e) => setCustomTag(e.target.value)}
              placeholder="Add your own tag" />
            <button className="btn" disabled={!customTag.trim()}>Add tag</button>
          </form>
        </div>

        <label className="field">
          <span>Last match played</span>
          <select className="input" value={showCustomMatch ? CUSTOM_MATCH : form.lastMatch}
            onChange={(e) => changeMatchSelect(e.target.value)}>
            <option value="">N/A (not tied to a match)</option>
            {matchOptions.map((label) => (
              <option key={label} value={label}>{label}</option>
            ))}
            <option value={CUSTOM_MATCH}>Other / practice match…</option>
          </select>
          {showCustomMatch && (
            <input className="input" style={{ marginTop: 6 }} value={form.lastMatch}
              onChange={(e) => { setMatchTouched(true); set({ lastMatch: e.target.value }); }}
              placeholder="e.g. Practice 3" />
          )}
          <span className="hint">Lists this team's whole schedule. Choose “Other” for a practice match TBA doesn't know about.</span>
        </label>

        <div className="field">
          <div className="inline" style={{ justifyContent: 'space-between' }}>
            <label htmlFor="ticket-resolution" style={{ fontWeight: 600, fontSize: '0.9rem' }}>Resolution notes</label>
            <button type="button" className="btn" style={{ minHeight: 36 }} disabled={!form.resolution.trim()}
              onClick={async () => {
                await copyText(form.resolution);
                toast('Resolution notes copied');
              }}>
              <Icon name="copy" size={18} /> Copy
            </button>
          </div>
          <textarea id="ticket-resolution" className="input" style={{ minHeight: 72 }} value={form.resolution}
            onChange={(e) => set({ resolution: e.target.value })}
            placeholder="What fixed it, or what to try next time" />
        </div>

        {error && <p className="error">{error}</p>}
        <button className="btn primary block" onClick={save}>{isNew ? 'Create ticket' : 'Save changes'}</button>
        {!isNew && <p className="hint">Last updated {formatDateTime(form.updatedAt)}</p>}

        <div className="field">
          <span>Linked tickets</span>
          {form.links.length > 0 ? (
            <ul className="row-list sheet">
              {form.links.map((l) => {
                const t = byId[l];
                return (
                  <li key={l} className="row" style={{ cursor: 'default' }}>
                    <div className="row-main" onClick={() => t && nav(`/event/${t.eventKey}/ticket/${t.id}`)}
                      style={{ cursor: t ? 'pointer' : 'default' }}>
                      <div className="row-title">{t ? `${ticketNumber(t)} · ${t.title}` : 'Deleted ticket'}</div>
                      {t && <div className="row-sub">{t.eventName || t.eventKey} · {formatDateTime(t.createdAt)}</div>}
                    </div>
                    {t && <StatusPill status={t.status} />}
                    <button className="icon-btn" aria-label="Unlink" onClick={() => set({ links: form.links.filter((x) => x !== l) })}>
                      <Icon name="close" size={18} />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <span className="hint">Link earlier tickets for the same problem so the team's history shows a continuing issue.</span>
          )}
          <button className="btn" onClick={() => setPicking(true)} disabled={!form.team}>
            <Icon name="link" size={18} /> Link a ticket
          </button>
          {!form.team && <span className="hint">Choose a team above first.</span>}
        </div>

        <button className="btn block" onClick={copyTicket}>
          <Icon name="copy" size={20} /> Copy ticket as text
        </button>
      </main>

      {picking && (
        <LinkPicker
          tickets={allTickets.filter((t) => t.id !== form.id && !form.links.includes(t.id) && ticketYear(t) === Number(eventKey.slice(0, 4)))}
          team={form.team}
          onPick={(tid) => {
            set({ links: [...form.links, tid] });
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

/** Only ever offers this same team's other tickets from the same season — a "continuing issue" link only makes
 *  sense between tickets for the same team, so cross-team linking isn't offered at all. */
function LinkPicker({ tickets, team, onPick, onClose }) {
  const [q, setQ] = useState('');
  const list = tickets
    .filter((t) => t.team === team)
    .filter((t) => {
      if (!q) return true;
      const s = q.toLowerCase();
      return t.title.toLowerCase().includes(s) || t.tags?.some((x) => x.toLowerCase().includes(s));
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 60);

  return (
    <Modal title={`Link a ticket for team ${team}`} onClose={onClose}>
      <div className="stack">
        <input className="input" autoFocus placeholder="Search title or tag" value={q} onChange={(e) => setQ(e.target.value)} />
        {list.length ? (
          <ul className="row-list sheet">
            {list.map((t) => (
              <li key={t.id}>
                <button className="row" onClick={() => onPick(t.id)}>
                  <span className="num" style={{ fontSize: '1.05rem', minWidth: 56 }}>{ticketNumber(t)}</span>
                  <div className="row-main">
                    <div className="row-title">{t.title}</div>
                    <div className="row-sub">{t.eventName || t.eventKey} · {formatDateTime(t.createdAt)}</div>
                  </div>
                  <StatusPill status={t.status} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No other tickets for team {team} this season yet.</p>
        )}
      </div>
    </Modal>
  );
}
