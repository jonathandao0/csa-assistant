# CSA Assistant

A Control System Advisor companion for FRC events. It is an installable, offline-capable
progressive web app (PWA) built with React + Vite. All data lives on your device (IndexedDB).

## Run it locally

Requires Node.js 18 or newer.

```bash
npm install
npm run dev          # http://localhost:5173
```

Then open **Settings** (gear icon) and paste in:

- **TBA read key**: thebluealliance.com/account → Read API Keys
- **Nexus API key**: frc.nexus/api

Add an event by typing its key (`2026casd`) or searching by name or city.

### Test the installable/offline version on your computer

```bash
npm run build
npm run preview      # http://localhost:4173
```

The service worker (offline support and the Install prompt) only runs in the built
version, and only on `localhost` or HTTPS. To install on your Android phone, host it on
GitHub Pages (below) and use Chrome's **Install app / Add to Home screen**.

## Deploy to GitHub Pages (later)

1. Push this folder to a GitHub repository (branch `main`).
2. In the repo: **Settings → Pages → Source: GitHub Actions**.
3. The included workflow (`.github/workflows/deploy.yml`) builds and publishes on every push.
   The app uses relative paths and hash routing, so it works at `username.github.io/repo-name/`.

### About Nexus and cross-origin requests

On `localhost`, the Vite dev/preview server proxies Nexus requests (`/nexus-api` →
`https://frc.nexus/api/v1`), so browser cross-origin rules never get in the way.
Once hosted on GitHub Pages the app calls Nexus directly. If Nexus doesn't allow browser
requests from your Pages domain, pit maps will show "N/A" with an error message. In that case
deploy this small Cloudflare Worker (free tier) and paste its URL into
**Settings → Nexus API address**:

```js
export default {
  async fetch(req) {
    const url = new URL(req.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Nexus-Api-Key',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const res = await fetch('https://frc.nexus/api/v1' + url.pathname, {
      headers: { 'Nexus-Api-Key': req.headers.get('Nexus-Api-Key') ?? '' },
    });
    return new Response(res.body, {
      status: res.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  },
};
```

## How it works

| Area | Behaviour |
|---|---|
| Event day | From TBA's start date. Districts = 2 days, everything else = 3. Override on the priorities tab. |
| Team colors | Red 0/3, orange 1–2/3, green 3/3 readiness items. From day 2 on, an unresolved ticket turns the team yellow. |
| Day 1 priorities | Teams missing readiness items, fewest completed first. Tap an item to check it off. |
| Day 2–3 priorities | Teams with unresolved tickets first (by priority), then everyone by next match. Uses Nexus queue estimates when available. |
| Pit map | Drawn from Nexus map coordinates. With no map, the Teams tab becomes first and the map tab shows N/A. |
| Tickets | One team each: status, priority, tags, last match (auto-filled from TBA), resolution notes, two-way links. |
| Team history | Tickets from other events are summarized on the team page; linked tickets form "continuing issues". |
| Report | Event page → document icon (or bottom of the Tickets tab) exports a Word summary. |
| Backup | Settings → Export/Restore backup (JSON, excludes API keys). |

## Project layout

```
src/
  lib/api.js        TBA + Nexus clients
  lib/sync.js       downloads event data, robot photos, event search
  lib/logic.js      event day, colors, match helpers, ticket chains
  lib/report.js     Word report (docx)
  lib/db.js         IndexedDB storage + live query hook
  pages/            Home, EventPage (4 tabs), TeamPage, TicketPage, Settings
  components/       shared UI and the pit map renderer
```

Data from The Blue Alliance and FRC Nexus (frc.nexus).
