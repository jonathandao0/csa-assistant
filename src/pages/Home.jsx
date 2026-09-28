import { useEffect, useState } from 'react';
import { Icon, TopBar } from '../components/ui.jsx';
import { db, getSetting, useLive } from '../lib/db.js';
import { DEMO_MODE, ensureDemoSeeded } from '../lib/demoMode.js';
import { seedDevEvent } from '../lib/devSeed.js';
import { dayCaption, eventDay, formatDateRange } from '../lib/logic.js';
import { nav } from '../lib/router.js';
import { getEventIndex, searchEvents, syncEvent } from '../lib/sync.js';
import { toast } from '../lib/util.js';

const KEY_PATTERN = /^\d{4}[a-z0-9]+$/i;

export default function Home() {
  const events = useLive(async () => (await db.all('events')).sort((a, b) => (a.startDate < b.startDate ? 1 : -1)));
  const hasKey = useLive(async () => !!(await getSetting('tbaKey')));
  const [query, setQuery] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [resettingDemo, setResettingDemo] = useState(false);

  useEffect(() => {
    if (DEMO_MODE) ensureDemoSeeded();
  }, []);

  async function resetDemo() {
    setResettingDemo(true);
    try {
      await seedDevEvent();
      toast('Demo data reloaded');
    } finally {
      setResettingDemo(false);
    }
  }

  const added = new Set((events ?? []).map((e) => e.key));

  async function add(key) {
    setBusy(key);
    setError('');
    try {
      const ev = await syncEvent(key);
      toast(`Added ${ev.shortName}`);
      nav(`/event/${ev.key}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function search(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setError('');
    if (KEY_PATTERN.test(q) && !q.includes(' ')) {
      return add(q.toLowerCase());
    }
    setBusy('search');
    try {
      const index = await getEventIndex(year);
      setResults(searchEvents(index, q));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const years = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() + 1 - i);

  return (
    <>
      <TopBar
        title="CSA Assistant"
        subtitle="Control System Advisor companion"
        actions={
          <button className="icon-btn" aria-label="Settings" onClick={() => nav('/settings')}>
            <Icon name="settings" />
          </button>
        }
      />
      <main className="page">
        {DEMO_MODE ? (
          <div className="notice section">
            This is a public demo preloaded with fake sample data — no real Blue Alliance or Nexus
            account needed. Explore freely; nothing here is a real event.
            <div style={{ marginTop: 8 }}>
              <button className="btn" style={{ minHeight: 36 }} onClick={resetDemo} disabled={resettingDemo}>
                {resettingDemo ? 'Reloading…' : 'Reload demo data'}
              </button>
            </div>
          </div>
        ) : hasKey === false && (
          <div className="notice section">
            Add your Blue Alliance API key to look up events.{' '}
            <a href="#/settings">Open Settings</a>
          </div>
        )}

        <section className="section">
          <div className="section-head">
            <h2>Events you're monitoring</h2>
          </div>
          {events?.length ? (
            <ul className="row-list sheet">
              {events.map((ev) => (
                <li key={ev.key} className="row" style={{ cursor: 'default' }}>
                  <button className="row" style={{ padding: 0, border: 0, flex: 1, minWidth: 0 }}
                    onClick={() => nav(`/event/${ev.key}`)}>
                    <div className="row-main">
                      <div className="row-title">{ev.name}</div>
                      <div className="row-sub">
                        {formatDateRange(ev.startDate, ev.endDate)} · {ev.key}
                      </div>
                    </div>
                    <span className="small muted" style={{ whiteSpace: 'nowrap' }}>
                      {dayCaption(eventDay(ev))}
                    </span>
                  </button>
                  <button className="icon-btn" aria-label={`Remove ${ev.shortName || ev.name} from your list`}
                    style={{ color: 'var(--muted)' }}
                    onClick={async () => {
                      if (!confirm(`Remove ${ev.shortName || ev.name} from your list? Tickets stay saved for team history.`)) return;
                      await db.del('events', ev.key);
                      toast('Event removed from your list');
                    }}>
                    <Icon name="trash" size={20} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No events yet. Add one below by event key or by searching.</p>
          )}
        </section>

        <section className="section">
          <div className="section-head">
            <h2>Add an event</h2>
          </div>
          <form className="stack" onSubmit={search}>
            <label className="field">
              <span>Event key or search</span>
              <input
                className="input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="2026casd, or “Ventura”, “Silicon Valley”"
                autoCapitalize="none"
                autoCorrect="off"
                enterKeyHint="search"
              />
            </label>
            <div className="inline">
              <select className="input" style={{ width: 'auto' }} value={year}
                onChange={(e) => setYear(Number(e.target.value))} aria-label="Season">
                {years.map((y) => (
                  <option key={y} value={y}>{y} season</option>
                ))}
              </select>
              <button className="btn primary" style={{ flex: 1 }} disabled={!!busy || !query.trim()}>
                {busy === 'search' ? 'Searching…' : KEY_PATTERN.test(query.trim()) ? 'Add event' : 'Search'}
              </button>
            </div>
            <p className="hint">Typing a full event key adds it directly. Anything else searches the season's events by name or city.</p>
          </form>
          {error && <p className="error">{error}</p>}
          {results && (
            <div style={{ marginTop: 12 }}>
              {results.length === 0 ? (
                <p className="muted">No {year} events match “{query}”. Try a city or a shorter name.</p>
              ) : (
                <ul className="row-list sheet">
                  {results.map((r) => (
                    <li key={r.key}>
                      <button className="row" disabled={!!busy}
                        onClick={() => (added.has(r.key) ? nav(`/event/${r.key}`) : add(r.key))}>
                        <div className="row-main">
                          <div className="row-title">{r.name}</div>
                          <div className="row-sub">
                            {formatDateRange(r.startDate, r.endDate)} · {[r.city, r.stateProv].filter(Boolean).join(', ')} · {r.key}
                          </div>
                        </div>
                        <span className="btn" style={{ minHeight: 36 }}>
                          {busy === r.key ? 'Adding…' : added.has(r.key) ? 'Open' : 'Add'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
