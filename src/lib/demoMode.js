import { db, getSetting, setSetting } from './db.js';
import { seedDevEvent } from './devSeed.js';

const DEMO_EVENT_KEYS = ['2026demo', '2026demo2'];

/** True when running as an installed app (home-screen PWA) rather than in a browser tab. */
export function isInstalledApp() {
  try {
    return (
      window.matchMedia?.('(display-mode: standalone)').matches ||
      window.matchMedia?.('(display-mode: fullscreen)').matches ||
      window.matchMedia?.('(display-mode: minimal-ui)').matches ||
      navigator.standalone === true
    );
  } catch {
    return false;
  }
}

// True only for the GitHub Pages build (VITE_DEMO_MODE=true, set by the deploy workflow)
// AND only while it's open in a browser tab. A real personal install (local dev, your own
// build/host) never sets the flag, and once the demo site is installed to the home screen
// it behaves as the real app — no banner, no fake events.
export const DEMO_BUILD = import.meta.env.VITE_DEMO_MODE === 'true';
export const DEMO_MODE = DEMO_BUILD && !isInstalledApp();

/** Seeds the fake demo dataset once per browser, so a first-time visitor to the public demo
 *  sees a populated example instead of an empty "add your API key" screen. No-ops outside
 *  demo builds, after it's already run once, or if events already exist (e.g. someone added
 *  a real one) so it never clobbers real data. */
export async function ensureDemoSeeded() {
  if (!DEMO_MODE) return false;
  const already = await getSetting('demoSeeded', false);
  if (already) return false;
  const events = await db.all('events');
  if (events.length > 0) {
    await setSetting('demoSeeded', true);
    return false;
  }
  await seedDevEvent();
  await setSetting('demoSeeded', true);
  return true;
}

/** The installed app shares storage with the browser tab it was installed from, so the demo
 *  events seeded there would show up in the app too. On the first launch as an installed app
 *  from the demo build, remove the fake events and their tickets/readiness (once). */
export async function removeDemoDataIfInstalled() {
  if (!DEMO_BUILD || !isInstalledApp()) return false;
  if (await getSetting('demoRemovedForApp', false)) return false;
  const keys = new Set(DEMO_EVENT_KEYS);
  const [tickets, readiness] = await Promise.all([db.all('tickets'), db.all('readiness')]);
  for (const t of tickets) if (keys.has(t.eventKey)) await db.del('tickets', t.id);
  for (const r of readiness) if (keys.has(r.eventKey)) await db.del('readiness', r.id);
  for (const k of keys) await db.del('events', k);
  await setSetting('demoRemovedForApp', true);
  return true;
}

// Chrome fires `beforeinstallprompt` once, early, when the page is installable. Hold on to it
// so the demo banner can offer a one-tap Install button instead of only describing the menu.
let deferredInstall = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    window.dispatchEvent(new Event('csa-installable'));
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    window.dispatchEvent(new Event('csa-installable'));
  });
}

export function canPromptInstall() {
  return !!deferredInstall;
}

export async function promptInstall() {
  if (!deferredInstall) return false;
  const e = deferredInstall;
  deferredInstall = null;
  e.prompt();
  const { outcome } = await e.userChoice;
  window.dispatchEvent(new Event('csa-installable'));
  return outcome === 'accepted';
}
