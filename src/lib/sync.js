import { db, getSetting, setSetting } from './db.js';
import { tba, nexus } from './api.js';

const LEVEL_ORDER = { qm: 1, ef: 2, qf: 3, sf: 4, f: 5 };

function normalizeMatch(m) {
  const red = m.alliances?.red ?? {};
  const blue = m.alliances?.blue ?? {};
  const num = (k) => Number(String(k).replace('frc', ''));
  const played = m.actual_time != null || (red.score ?? -1) >= 0;
  return {
    key: m.key,
    compLevel: m.comp_level,
    setNumber: m.set_number,
    matchNumber: m.match_number,
    red: (red.team_keys ?? []).map(num),
    blue: (blue.team_keys ?? []).map(num),
    redScore: red.score ?? -1,
    blueScore: blue.score ?? -1,
    time: m.time ?? null,
    predictedTime: m.predicted_time ?? null,
    actualTime: m.actual_time ?? null,
    played,
  };
}

export function sortMatches(matches) {
  return [...matches].sort(
    (a, b) =>
      (LEVEL_ORDER[a.compLevel] ?? 9) - (LEVEL_ORDER[b.compLevel] ?? 9) ||
      a.setNumber - b.setNumber ||
      a.matchNumber - b.matchNumber,
  );
}

async function settle(promise) {
  try {
    return { value: await promise };
  } catch (e) {
    return { error: e.message };
  }
}

/** Downloads (or refreshes) everything needed to work the event offline. */
export async function syncEvent(eventKey) {
  const key = eventKey.toLowerCase().trim();
  const [ev, teams, matches] = await Promise.all([
    tba(`/event/${key}`),
    tba(`/event/${key}/teams`),
    tba(`/event/${key}/matches/simple`).catch(() => []),
  ]);

  const hasNexusKey = !!(await getSetting('nexusKey'));
  const [map, pits, live, inspection] = hasNexusKey
    ? await Promise.all([
        settle(nexus(`/event/${key}/map`)),
        settle(nexus(`/event/${key}/pits`)),
        settle(nexus(`/event/${key}`)),
        settle(nexus(`/event/${key}/inspection`)),
      ])
    : [{}, {}, {}, {}];

  const existing = await db.get('events', key);
  const nexusError = [map, pits, live].find((r) => r.error)?.error ?? null;
  const record = {
    key,
    name: ev.name,
    shortName: ev.short_name || ev.name,
    year: ev.year,
    eventType: ev.event_type,
    eventTypeString: ev.event_type_string,
    startDate: ev.start_date,
    endDate: ev.end_date,
    city: ev.city,
    stateProv: ev.state_prov,
    country: ev.country,
    teams: teams
      .map((t) => ({
        number: t.team_number,
        nickname: t.nickname,
        name: t.name,
        schoolName: t.school_name,
        city: t.city,
        stateProv: t.state_prov,
        country: t.country,
        rookieYear: t.rookie_year,
        website: t.website,
      }))
      .sort((a, b) => a.number - b.number),
    matches: sortMatches(matches.map(normalizeMatch)),
    nexus: {
      enabled: hasNexusKey,
      map: map.value ?? existing?.nexus?.map ?? null,
      pits: pits.value ?? existing?.nexus?.pits ?? null,
      live: live.value ?? existing?.nexus?.live ?? null,
      inspection: inspection.value ?? existing?.nexus?.inspection ?? null,
      error: nexusError,
    },
    dayOverride: existing?.dayOverride ?? null,
    addedAt: existing?.addedAt ?? Date.now(),
    fetchedAt: Date.now(),
  };
  await db.put('events', record);

  // Warm robot photos in the background so they're available offline.
  prefetchMedia(record).catch(() => {});
  return record;
}

async function prefetchMedia(event) {
  const queue = event.teams.map((t) => t.number);
  const worker = async () => {
    while (queue.length) {
      const n = queue.shift();
      const media = await fetchTeamMedia(n, event.year).catch(() => null);
      const url = media?.photos?.[0];
      if (url) fetch(url, { mode: 'no-cors' }).catch(() => {});
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
}

const PHOTO_TYPES = new Set(['imgur', 'cdphotothread', 'instagram-image']);

/** Robot photos + avatar from TBA, cached in IndexedDB for 12 hours. */
export async function fetchTeamMedia(number, year, force = false) {
  const id = `${number}:${year}`;
  const cached = await db.get('media', id);
  if (cached && !force && Date.now() - cached.fetchedAt < 12 * 3600 * 1000) return cached;
  const list = await tba(`/team/frc${number}/media/${year}`);
  const photos = list
    .filter((m) => PHOTO_TYPES.has(m.type) && m.direct_url)
    .sort((a, b) => Number(!!b.preferred) - Number(!!a.preferred))
    .map((m) => m.direct_url);
  const avatarItem = list.find((m) => m.type === 'avatar' && m.details?.base64Image);
  const record = {
    id,
    photos,
    avatar: avatarItem ? `data:image/png;base64,${avatarItem.details.base64Image}` : null,
    fetchedAt: Date.now(),
  };
  await db.put('media', record);
  return record;
}

/** Season event list, cached so search still works with poor venue signal. */
export async function getEventIndex(year, force = false) {
  const settingKey = `eventIndex:${year}`;
  const cached = await getSetting(settingKey, null);
  if (cached && !force && Date.now() - cached.fetchedAt < 24 * 3600 * 1000) return cached.events;
  try {
    const events = (await tba(`/events/${year}/simple`)).map((e) => ({
      key: e.key,
      name: e.name,
      city: e.city,
      stateProv: e.state_prov,
      country: e.country,
      startDate: e.start_date,
      endDate: e.end_date,
      eventType: e.event_type,
    }));
    await setSetting(settingKey, { fetchedAt: Date.now(), events });
    return events;
  } catch (e) {
    if (cached) return cached.events;
    throw e;
  }
}

export function searchEvents(index, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return index
    .filter((e) => {
      const hay = `${e.key} ${e.name} ${e.city ?? ''} ${e.stateProv ?? ''} ${e.country ?? ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => (a.startDate < b.startDate ? -1 : 1))
    .slice(0, 40);
}
