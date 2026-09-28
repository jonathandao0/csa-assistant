import { openDB } from 'idb';
import { useEffect, useState } from 'react';

// Stores
//  settings   key/value (tbaKey, nexusKey, nexusBase, eventIndex:<year>)
//  events     { key, ...event data, teams[], matches[], nexus{} }
//  readiness  { id: `${eventKey}:${team}`, eventKey, team, radio, inspection, field }
//  tickets    { id, eventKey, eventName, team, title, ... links[] }
//  media      { id: `${team}:${year}`, photos[], avatar }  (from TBA)
//  photos     { id: `${team}`, dataUrl, year }            (taken by you)
const dbPromise = openDB('csa-assistant', 2, {
  async upgrade(db, oldVersion, newVersion, tx) {
    if (oldVersion < 1) createStores(db);
    // v2: ticket priorities collapsed from low/medium/high/critical to normal/high.
    if (oldVersion >= 1 && oldVersion < 2) {
      let cursor = await tx.objectStore('tickets').openCursor();
      while (cursor) {
        const t = cursor.value;
        const priority = t.priority === 'high' || t.priority === 'critical' ? 'high' : 'normal';
        if (priority !== t.priority) await cursor.update({ ...t, priority });
        cursor = await cursor.continue();
      }
    }
  },
});

function createStores(db) {
  db.createObjectStore('settings');
  db.createObjectStore('events', { keyPath: 'key' });
  db.createObjectStore('readiness', { keyPath: 'id' });
  const tickets = db.createObjectStore('tickets', { keyPath: 'id' });
  tickets.createIndex('eventKey', 'eventKey');
  tickets.createIndex('team', 'team');
  db.createObjectStore('media', { keyPath: 'id' });
  db.createObjectStore('photos', { keyPath: 'id' });
}

export const STORES = ['settings', 'events', 'readiness', 'tickets', 'media', 'photos'];

function notify() {
  window.dispatchEvent(new Event('csa-db'));
}

export const db = {
  async get(store, key) {
    return (await dbPromise).get(store, key);
  },
  async all(store) {
    return (await dbPromise).getAll(store);
  },
  async byIndex(store, index, value) {
    return (await dbPromise).getAllFromIndex(store, index, value);
  },
  async put(store, value, key) {
    const d = await dbPromise;
    const r = key === undefined ? await d.put(store, value) : await d.put(store, value, key);
    notify();
    return r;
  },
  async putMany(store, values) {
    const tx = (await dbPromise).transaction(store, 'readwrite');
    await Promise.all([...values.map((v) => tx.store.put(v)), tx.done]);
    notify();
  },
  async del(store, key) {
    await (await dbPromise).delete(store, key);
    notify();
  },
  async clear(store) {
    await (await dbPromise).clear(store);
    notify();
  },
  async entries(store) {
    const d = await dbPromise;
    const keys = await d.getAllKeys(store);
    const values = await d.getAll(store);
    return keys.map((k, i) => [k, values[i]]);
  },
};

export async function getSetting(key, fallback = '') {
  const v = await db.get('settings', key);
  return v ?? fallback;
}
export function setSetting(key, value) {
  return db.put('settings', value, key);
}

/** Runs an async query and re-runs it whenever the database changes. */
export function useLive(query, deps = []) {
  const [data, setData] = useState(undefined);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener('csa-db', bump);
    return () => window.removeEventListener('csa-db', bump);
  }, []);
  useEffect(() => {
    let alive = true;
    query().then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);
  return data;
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
