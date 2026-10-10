import { useEffect, useRef, useState } from 'react';
import { TopBar } from '../components/ui.jsx';
import { defaultNexusBase, nexus, tba } from '../lib/api.js';
import { STORES, db, getSetting, setSetting, useLive } from '../lib/db.js';
import { seedDevEvent } from '../lib/devSeed.js';
import { syncWithSignIn, useSyncStatus } from '../lib/cloudSync.js';
import { BUILT_IN_CLIENT_ID, disconnect, preloadGoogleSignIn } from '../lib/drive.js';
import { formatDateTime, ticketYear } from '../lib/logic.js';
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

/** Google Drive sync: connect once per device, then data merges through one Drive file. */
function DriveSync() {
  const connected = useLive(() => getSetting('driveConnected', false), []);
  const lastSync = useLive(() => getSetting('driveLastSync', 0), []);
  const savedClientId = useLive(() => getSetting('googleClientId', ''), []);
  const [clientId, setClientId] = useState('');
  const [busy, setBusy] = useState(false);
  const status = useSyncStatus();
  useEffect(() => {
    if (savedClientId !== undefined) setClientId(savedClientId);
  }, [savedClientId]);
  const hasClientId = !!(BUILT_IN_CLIENT_ID || savedClientId);
  useEffect(() => {
    if (hasClientId) preloadGoogleSignIn();
  }, [hasClientId]);

  async function run(firstTime) {
    setBusy(true);
    try {
      await syncWithSignIn({ firstTime });
      toast(firstTime ? 'Connected to Google Drive and synced' : 'Synced with Google Drive');
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!confirm('Stop syncing this device with Google Drive? Data on this device and the file in Drive are both kept.')) return;
    await disconnect();
    toast('Disconnected from Google Drive');
  }

  const statusLine = status.state === 'syncing' ? 'Syncing…'
    : status.state === 'error' ? `Last sync failed: ${status.message}`
    : status.state === 'signin' ? 'Signed out of Google. Tap Sync now to sign in again.'
    : lastSync ? `Last synced ${formatDateTime(lastSync)}.` : 'Not synced yet.';

  return (
    <section className="section">
      <div className="section-head"><h2>Google Drive sync</h2></div>
      <div className="sheet sheet-pad stack">
        <p className="small muted" style={{ margin: 0 }}>
          Keep events, tickets, readiness, notes and your robot photos in step across your phone, tablet and
          computer. Each device merges with one file in your Google Drive (the newest change to each item wins,
          and deletions carry over). The app can only see files it created. API keys and settings stay on each device.
        </p>
        {!BUILT_IN_CLIENT_ID && (
          <label className="field" style={{ margin: 0 }}>
            <span>Google OAuth client ID</span>
            <div className="inline">
              <input className="input" style={{ flex: 1 }} value={clientId} onChange={(e) => setClientId(e.target.value)}
                placeholder="…apps.googleusercontent.com" autoCapitalize="none" spellCheck="false" />
              <button className="btn" disabled={clientId.trim() === (savedClientId ?? '')}
                onClick={() => setSetting('googleClientId', clientId.trim()).then(() => toast('Saved'))}>Save</button>
            </div>
            <span className="hint" style={{ fontWeight: 400 }}>
              One-time setup in Google Cloud, explained in the README. Use the same ID on every device.
            </span>
          </label>
        )}
        {connected ? (
          <>
            <p className="small" style={{ margin: 0 }}>{statusLine}</p>
            <div className="inline">
              <button className="btn primary" onClick={() => run(false)} disabled={busy || status.state === 'syncing'}>
                {busy || status.state === 'syncing' ? 'Syncing…' : 'Sync now'}
              </button>
              <button className="btn" onClick={stop} disabled={busy}>Disconnect</button>
            </div>
            <p className="hint" style={{ margin: 0 }}>Syncs on its own after changes and when you reopen the app, while you're signed in.</p>
          </>
        ) : (
          <div>
            <button className="btn primary" onClick={() => run(true)} disabled={busy || !hasClientId}>
              {busy ? 'Connecting…' : 'Connect Google Drive'}
            </button>
          </div>
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
    const synced = await getSetting('driveConnected', false);
    if (!confirm(synced
      ? 'Erase all events, tickets, readiness, and photos? Google Drive sync is on, so this erases them from your other synced devices too. This cannot be undone.'
      : 'Erase all events, tickets, readiness, and photos from this device? This cannot be undone.')) return;
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

        <DriveSync />

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
              Everything is stored on this device, and also in your Google Drive if sync is on. Export a backup
              before clearing browser data or switching phones. Backups don't include your API keys.
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
