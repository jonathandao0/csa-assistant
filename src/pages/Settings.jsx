import { useEffect, useRef, useState } from 'react';
import { TopBar } from '../components/ui.jsx';
import { defaultNexusBase, nexus, tba } from '../lib/api.js';
import { STORES, db, getSetting, setSetting, useLive } from '../lib/db.js';
import { seedDevEvent } from '../lib/devSeed.js';
import { ticketYear } from '../lib/logic.js';
import { goBack, nav } from '../lib/router.js';
import { THEMES, useTheme } from '../lib/theme.js';
import { deleteTickets, downloadBlob, exportBackup, importBackup, toast } from '../lib/util.js';

function KeyField({ label, settingKey, hint, test }) {
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => {
    getSetting(settingKey).then(setValue);
  }, [settingKey]);

  async function save() {
    const v = value.trim();
    await setSetting(settingKey, v);
    if (!v) return setStatus('Key removed.');
    setStatus('Checking…');
    try {
      await test(v);
      setStatus('Saved. The key works.');
    } catch (e) {
      setStatus(`Saved, but the check failed: ${e.message}`);
    }
  }

  return (
    <div className="field">
      <span>{label}</span>
      <div className="inline">
        <input className="input" style={{ flex: 1 }} type={show ? 'text' : 'password'} value={value}
          onChange={(e) => setValue(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck="false" />
        <button className="btn" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
      </div>
      <span className="hint">{hint}</span>
      <div className="inline">
        <button className="btn primary" onClick={save}>Save key</button>
        {status && <span className="small">{status}</span>}
      </div>
    </div>
  );
}

/** Per-season ticket counts with a delete button for each, plus a delete-everything option.
 *  History on team pages is already scoped to one season; this is for actually freeing the
 *  space or starting clean. */
function TicketHistory() {
  const tickets = useLive(() => db.all('tickets'), []);
  if (!tickets) return null;
  const byYear = {};
  for (const t of tickets) (byYear[ticketYear(t)] ??= []).push(t);
  const years = Object.keys(byYear).sort((a, b) => b - a);

  async function clear(list, what) {
    if (!confirm(`Delete ${list.length} ticket${list.length === 1 ? '' : 's'} ${what}? This cannot be undone. Export a backup first if you might want them.`)) return;
    const n = await deleteTickets(list.map((t) => t.id));
    toast(`Deleted ${n} ticket${n === 1 ? '' : 's'}`);
  }

  return (
    <section className="section">
      <div className="section-head"><h2>Ticket history</h2></div>
      <div className="sheet sheet-pad stack">
        <p className="small muted" style={{ margin: 0 }}>
          Team history only shows tickets from the same season, so old seasons never pile up on a team page.
          Delete them here if you don't need them at all.
        </p>
        {years.length ? (
          <>
            <ul className="row-list">
              {years.map((y) => (
                <li key={y} className="row" style={{ cursor: 'default', padding: '6px 0' }}>
                  <div className="row-main">
                    <div className="row-title">{y} season</div>
                    <div className="row-sub">{byYear[y].length} ticket{byYear[y].length === 1 ? '' : 's'}</div>
                  </div>
                  <button className="btn danger" style={{ minHeight: 36 }} onClick={() => clear(byYear[y], `from ${y}`)}>
                    Delete {y}
                  </button>
                </li>
              ))}
            </ul>
            <div><button className="btn danger" onClick={() => clear(tickets, 'from every season')}>Delete all tickets</button></div>
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>No tickets saved.</p>
        )}
      </div>
    </section>
  );
}

function Appearance() {
  const { pref, setPref } = useTheme();
  return (
    <section className="section">
      <div className="section-head"><h2>Appearance</h2></div>
      <div className="sheet sheet-pad">
        <div className="inline" role="radiogroup" aria-label="Theme">
          {THEMES.map(([k, label]) => (
            <button key={k} className="chip" role="radio" aria-checked={pref === k} aria-pressed={pref === k}
              onClick={() => setPref(k)}>
              {label}
            </button>
          ))}
        </div>
        <p className="hint" style={{ margin: '8px 0 0' }}>
          Dark is easier on the eyes in a dim pit; light reads better under bright arena lights.
        </p>
      </div>
    </section>
  );
}

export default function Settings() {
  const nexusBase = useLive(() => getSetting('nexusBase'), []);
  const [base, setBase] = useState('');
  const fileRef = useRef(null);
  useEffect(() => {
    if (nexusBase !== undefined) setBase(nexusBase);
  }, [nexusBase]);

  async function doExport() {
    const blob = await exportBackup();
    downloadBlob(blob, `csa-backup-${new Date().toISOString().slice(0, 10)}.json`);
  }

  async function doImport(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      await importBackup(file);
      toast('Backup restored');
    } catch (err) {
      toast(err.message);
    }
  }

  async function eraseAll() {
    if (!confirm('Erase all events, tickets, readiness, and photos from this device? This cannot be undone.')) return;
    for (const s of STORES) if (s !== 'settings') await db.clear(s);
    toast('All event data erased');
    nav('/');
  }

  async function loadDemoData() {
    const event = await seedDevEvent();
    toast('Demo event loaded');
    nav(`/event/${event.key}`);
  }

  return (
    <>
      <TopBar title="Settings" back={() => goBack('/')} />
      <main className="page">
        <section className="section sheet sheet-pad stack" style={{ gap: 20 }}>
          <KeyField
            label="The Blue Alliance API key"
            settingKey="tbaKey"
            test={(k) => tba('/status', k)}
            hint={
              <>Create a read key under Read API Keys on your <a href="https://www.thebluealliance.com/account" target="_blank" rel="noreferrer">TBA account page</a>.</>
            }
          />
          <KeyField
            label="FRC Nexus API key"
            settingKey="nexusKey"
            test={async (k) => {
              if (!(await nexus('/events', k))) throw new Error('No response from Nexus');
            }}
            hint={
              <>Used for pit maps, pit numbers, inspection status, and queue times. Get one at <a href="https://frc.nexus/api" target="_blank" rel="noreferrer">frc.nexus/api</a>.</>
            }
          />
        </section>

        <Appearance />

        <section className="section">
          <div className="section-head"><h2>Nexus connection</h2></div>
          <div className="sheet sheet-pad stack">
            <label className="field">
              <span>Nexus API address</span>
              <input className="input" value={base} placeholder={defaultNexusBase()} onChange={(e) => setBase(e.target.value)}
                autoCapitalize="none" spellCheck="false" />
              <span className="hint">
                Leave blank to use the default ({defaultNexusBase()}). If Nexus requests are blocked once the app is hosted
                online, point this at a small proxy (see the README).
              </span>
            </label>
            <div><button className="btn" onClick={() => setSetting('nexusBase', base.trim()).then(() => toast('Saved'))}>Save address</button></div>
          </div>
        </section>

        <section className="section">
          <div className="section-head"><h2>Your data</h2></div>
          <div className="sheet sheet-pad stack">
            <p className="small muted" style={{ margin: 0 }}>
              Everything is stored only on this device. Export a backup before clearing browser data or switching phones.
              Backups don't include your API keys.
            </p>
            <div className="inline">
              <button className="btn" onClick={doExport}>Export backup</button>
              <button className="btn" onClick={() => fileRef.current?.click()}>Restore backup</button>
              <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={doImport} />
            </div>
            <div><button className="btn danger" onClick={eraseAll}>Erase all event data</button></div>
          </div>
        </section>

        <TicketHistory />

        {import.meta.env.DEV && (
          <section className="section">
            <div className="section-head"><h2>Developer</h2></div>
            <div className="sheet sheet-pad stack">
              <p className="small muted" style={{ margin: 0 }}>
                Loads a fake event with teams, matches, a pit map, readiness states, and sample tickets, with no
                API keys needed. Only shown in the dev build.
              </p>
              <div><button className="btn" onClick={loadDemoData}>Load demo event with fake data</button></div>
            </div>
          </section>
        )}

        <p className="hint">
          Event data from <a href="https://www.thebluealliance.com" target="_blank" rel="noreferrer">The Blue Alliance</a>. Pit maps
          and live queue data from <a href="https://frc.nexus" target="_blank" rel="noreferrer">FRC Nexus</a>.
        </p>
      </main>
    </>
  );
}
