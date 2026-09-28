# CSA Assistant

A Control System Advisor companion for FRC events. It is an installable, offline-capable
progressive web app (PWA) built with React + Vite. All data lives on your device (IndexedDB).

**Live app:** [jonathandao0.github.io/csa-assistant](https://jonathandao0.github.io/csa-assistant/)

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

## Deploy to GitHub Pages

Already live at [jonathandao0.github.io/csa-assistant](https://jonathandao0.github.io/csa-assistant/),
rebuilt automatically on every push to `main` by `.github/workflows/deploy.yml`. To set this up on a
fork or a new repo:

1. Push this folder to a GitHub repository (branch `main`).
2. In the repo: **Settings → Pages → Source: GitHub Actions**.
3. The included workflow builds and publishes on every push. The app uses relative paths and
   hash routing, so it works at `username.github.io/repo-name/`.

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
| Competition phase | Load-In/Practice or Quals/Playoffs, detected from the TBA match schedule (has a qualification match been played, or has the first one's scheduled time passed?) rather than the calendar day. Override on the Priority list tab. |
| Team colors | Red 0/3, orange 1–2/3, green 3/3 readiness items. Once Quals/Playoffs starts, an unresolved ticket turns the team yellow. |
| Priority list (Load-In/Practice) | Teams missing readiness items, fewest completed first. Tap an item to check it off. |
| Priority list (Quals/Playoffs) | Teams with unresolved tickets first (by priority or raw count), then everyone by next match. Uses Nexus queue estimates when available. Sort by priority, unresolved count, or team number; the list only re-sorts on request (button or pull-to-refresh), so it doesn't jump around while you're working through it. |
| Pit map | Drawn from Nexus map coordinates. With no map, the Teams tab becomes first and the map tab shows N/A. Find a team by number with a type-ahead dropdown. |
| Tickets | One team each: status, priority, categorized tags, last match (a dropdown of the team's schedule, auto-filled from TBA), resolution notes, two-way links. Each gets a short id like `1005-1` (team + that team's Nth ticket ever). |
| Follow-up flags | A quick "something looked off, check on it later" button opens a pre-filled draft ticket — nothing is saved until you review and create it. |
| Team history | Tickets from other events are summarized on the team page; linked tickets form "continuing issues"; a small chart shows tickets over time. |
| Reference tab | Offline, searchable CTRE/REV status-LED blink-code lookup with animated color swatches. |
| Report | Event page → document icon (or bottom of the Tickets tab) exports a Word summary. |
| Backup | Settings → Export/Restore backup (JSON, excludes API keys). |

## Project layout

```
src/
  lib/api.js        TBA + Nexus clients
  lib/sync.js       downloads event data, robot photos, event search
  lib/logic.js      competition phase, colors, match helpers, ticket chains
  lib/report.js     Word report (docx)
  lib/db.js         IndexedDB storage + live query hook
  lib/devSeed.js    fake two-event dataset for the Settings dev-tools button
  lib/ledCodes.js   CTRE/REV status-LED reference data
  pages/            Home, EventPage (5 tabs), TeamPage, TicketPage, Settings
  components/       shared UI, the pit map renderer, the LED reference lookup
```

Data from The Blue Alliance and FRC Nexus (frc.nexus).
