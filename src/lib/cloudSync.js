import { SYNCED_STORES, db, getSetting, setSetting } from './db.js';
import { useEffect, useState } from 'react';
import { downloadSyncFile, driveConfigured, hasValidToken, signIn, uploadSyncFile } from './drive.js';

// Cross-device sync through one JSON file in the user's Google Drive.
//
// Each device merges its own data with the file, record by record: the copy with the newest
// `_mod` (stamped by db.put on every write) wins, and a tombstone newer than a record deletes
// it everywhere. The merged result is written back locally and uploaded, so any device that
// syncs ends up with the union of everyone's changes. The file is also a valid backup
// (same `app`/`stores` shape), so Settings → Restore backup can read it too.

const KEY_FIELD = { events: 'key', readiness: 'id', tickets: 'id', photos: 'id' };
const keyOf = (store, row) => row?.[KEY_FIELD[store]];
const modOf = (row) => row?._mod ?? row?.updatedAt ?? row?.fetchedAt ?? row?.addedAt ?? 0;

function maxMerge(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, v);
  return out;
}

/** Pure merge of two snapshots `{stores, tombstones, cleared}`. Exported for testing. */
export function mergeSnapshots(local, remote) {
  const tombstones = maxMerge(local.tombstones, remote?.tombstones);
  const cleared = maxMerge(local.cleared, remote?.cleared);
  const stores = {};
  for (const store of SYNCED_STORES) {
    const byKey = new Map();
    for (const row of [...(remote?.stores?.[store] ?? []), ...(local.stores?.[store] ?? [])]) {
      const k = keyOf(store, row);
      if (k == null) continue;
      const cur = byKey.get(k);
      // Ties keep the local copy (it's added last).
      if (!cur || modOf(row) >= modOf(cur)) byKey.set(k, row);
    }
    stores[store] = [...byKey.entries()]
      .filter(([k, row]) => {
        const deletedAt = tombstones[`${store}:${k}`] ?? 0;
        return modOf(row) > deletedAt && modOf(row) > (cleared[store] ?? 0);
      })
      .map(([, row]) => row);
  }
  return { stores, tombstones, cleared };
}

/** True when two snapshots hold the same records (by key and `_mod`) and deletion markers. */
function sameSnapshot(a, b) {
  if (!a || !b) return false;
  const sig = (snap) =>
    JSON.stringify([
      SYNCED_STORES.map((s) => (snap.stores?.[s] ?? []).map((r) => `${keyOf(s, r)}@${modOf(r)}`).sort()),
      Object.entries(snap.tombstones ?? {}).sort(),
      Object.entries(snap.cleared ?? {}).sort(),
    ]);
  return sig(a) === sig(b);
}

async function localSnapshot() {
  const stores = {};
  for (const s of SYNCED_STORES) stores[s] = await db.all(s);
  return {
    stores,
    tombstones: await getSetting('syncTombstones', {}),
    cleared: await getSetting('syncCleared', {}),
  };
}

/** Writes the merged result into IndexedDB, touching only rows that actually differ. */
async function applyLocally(local, merged) {
  for (const s of SYNCED_STORES) {
    const before = new Map(local.stores[s].map((r) => [keyOf(s, r), r]));
    const after = new Map(merged.stores[s].map((r) => [keyOf(s, r), r]));
    const puts = [...after.values()].filter((r) => {
      const prev = before.get(keyOf(s, r));
      return !prev || modOf(prev) !== modOf(r);
    });
    const deletes = [...before.keys()].filter((k) => !after.has(k));
    if (puts.length || deletes.length) await db.applyRaw(s, puts, deletes);
  }
  await setSetting('syncTombstones', merged.tombstones);
  await setSetting('syncCleared', merged.cleared);
}

// ---------- Status, shared with the UI ----------

let status = { state: 'idle', at: null, message: '' };
let applying = false;
let running = null;

function setStatus(next) {
  status = { ...status, ...next };
  window.dispatchEvent(new CustomEvent('csa-sync', { detail: status }));
}
export const getSyncStatus = () => status;

/** Live sync status for the UI: { state: idle|syncing|ok|error|signin, at, message }. */
export function useSyncStatus() {
  const [s, setS] = useState(status);
  useEffect(() => {
    const on = (e) => setS(e.detail);
    window.addEventListener('csa-sync', on);
    return () => window.removeEventListener('csa-sync', on);
  }, []);
  return s;
}

/** For a Sync button: signs in first if needed (this opens Google's popup, so call it
 *  straight from the tap), then syncs. */
export async function syncWithSignIn({ firstTime = false } = {}) {
  if (firstTime || !hasValidToken()) await signIn({ firstTime });
  return syncNow();
}

/** One full sync: download, merge, apply locally, upload. Concurrent calls share one run.
 *  Throws (after setting an error status) so a button can report it. */
export function syncNow() {
  running ??= (async () => {
    setStatus({ state: 'syncing', message: '' });
    try {
      const remote = await downloadSyncFile();
      if (remote && remote.app !== 'csa-assistant') throw new Error('The Drive file is not CSA Assistant data.');
      const local = await localSnapshot();
      const merged = mergeSnapshots(local, remote);
      const at = Date.now();
      // The sync's own writes (merged rows, markers, last-sync time) must not look like
      // local edits, or they'd schedule another sync forever.
      applying = true;
      try {
        if (!sameSnapshot(local, merged)) await applyLocally(local, merged);
        await setSetting('driveLastSync', at);
      } finally {
        applying = false;
      }
      if (!sameSnapshot(remote, merged)) {
        await uploadSyncFile({ app: 'csa-assistant', version: 1, kind: 'drive-sync', exportedAt: at, ...merged });
      }
      setStatus({ state: 'ok', at, message: '' });
    } catch (e) {
      setStatus({ state: e.needsSignIn ? 'signin' : 'error', message: e.message });
      throw e;
    } finally {
      running = null;
    }
  })();
  return running;
}

// ---------- Automatic sync ----------

const AFTER_CHANGE_MS = 15 * 1000;
const ON_RETURN_MS = 60 * 1000;

/** Syncs on start, ~15 s after local changes settle, and when the app comes back to the
 *  foreground — but only while connected with a live token, online, and never in response
 *  to the sync's own writes. A missing/expired token just shows "sign in" until the user
 *  taps Sync (the Google popup needs a tap). */
export function startAutoSync() {
  let timer = null;
  const quiet = () => {};
  const canRun = async () =>
    navigator.onLine && (await getSetting('driveConnected', false)) && (await driveConfigured()) && hasValidToken();

  const run = async () => {
    if (await canRun()) syncNow().catch(quiet);
    else if ((await getSetting('driveConnected', false)) && !hasValidToken()) setStatus({ state: 'signin', message: '' });
  };

  window.addEventListener('csa-db', () => {
    if (applying) return;
    clearTimeout(timer);
    timer = setTimeout(run, AFTER_CHANGE_MS);
  });
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    const last = await getSetting('driveLastSync', 0);
    if (Date.now() - last > ON_RETURN_MS) run();
  });
  window.addEventListener('online', run);
  run();
}
