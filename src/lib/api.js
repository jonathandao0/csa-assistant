import { getSetting } from './db.js';

const TBA_BASE = 'https://www.thebluealliance.com/api/v3';

export function defaultNexusBase() {
  // On localhost the Vite dev/preview server proxies Nexus to avoid cross-origin blocks.
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  return local ? '/nexus-api' : 'https://frc.nexus/api/v1';
}

export async function tba(path, keyOverride) {
  const key = keyOverride ?? (await getSetting('tbaKey'));
  if (!key) throw new Error('Add your TBA API key in Settings first.');
  let res;
  try {
    res = await fetch(TBA_BASE + path, { headers: { 'X-TBA-Auth-Key': key } });
  } catch {
    throw new Error('Could not reach The Blue Alliance. Check your connection.');
  }
  if (res.status === 401) throw new Error('TBA rejected the API key. Check it in Settings.');
  if (res.status === 404) throw new Error(`TBA has no data at ${path}.`);
  if (!res.ok) throw new Error(`TBA request failed (${res.status}).`);
  return res.json();
}

/** Returns parsed JSON, or null when Nexus has no data (404) for this event. */
export async function nexus(path, keyOverride) {
  const key = keyOverride ?? (await getSetting('nexusKey'));
  if (!key) return null;
  const base = (await getSetting('nexusBase')) || defaultNexusBase();
  let res;
  try {
    res = await fetch(base.replace(/\/$/, '') + path, { headers: { 'Nexus-Api-Key': key } });
  } catch {
    throw new Error('Could not reach FRC Nexus. If this keeps happening, set a proxy URL in Settings.');
  }
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) throw new Error('Nexus rejected the API key. Check it in Settings.');
  if (!res.ok) throw new Error(`Nexus request failed (${res.status}).`);
  return res.json();
}
