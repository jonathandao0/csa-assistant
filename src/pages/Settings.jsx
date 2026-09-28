import { useEffect, useRef, useState } from 'react';
import { TopBar } from '../components/ui.jsx';
import { defaultNexusBase, nexus, tba } from '../lib/api.js';
import { STORES, db, getSetting, setSetting, useLive } from '../lib/db.js';
import { seedDevEvent } from '../lib/devSeed.js';
import { goBack, nav } from '../lib/router.js';
import { downloadBlob, exportBackup, importBackup, toast } from '../lib/util.js';

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
