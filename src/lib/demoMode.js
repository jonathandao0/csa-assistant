import { db, getSetting, setSetting } from './db.js';
import { seedDevEvent } from './devSeed.js';

// True only for the specific build made with VITE_DEMO_MODE=true — the GitHub Pages deploy
// workflow sets this; a real personal install (local dev or your own build/host) never does,
// so this never auto-injects fake events into someone's actual event list.
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

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
