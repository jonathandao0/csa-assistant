# CLAUDE.md — CSA Assistant

Context for Claude Code sessions working on this repo. It records what the app is, the
decisions made with the owner while designing it, and what is still unverified.

## What this is

A personal, single-user **Control System Advisor (CSA) assistant** for FIRST Robotics
Competition (FRC) events. It is a **progressive web app** that installs on Android through
Chrome's "Install app" option. Its main job is logging and tracking the technical-help
tickets a CSA handles. Around that it adds:

- event, team and match data from The Blue Alliance (TBA);
- pit maps and live queue data from FRC Nexus;
- team readiness tracking;
- a Word report summarizing each event.

## Commands

```bash
npm install
npm run dev       # http://localhost:5173 (Nexus proxied at /nexus-api)
npm run build     # outputs dist/ with service worker
npm run preview   # http://localhost:4173, tests the PWA/offline build (also proxies Nexus)
```

Requires Node 18+. There is no test suite yet.

## Stack and why

The stack is **React 18 + Vite 5 + vite-plugin-pwa (generateSW) + idb + docx**, with fonts
from @fontsource. Plain JavaScript and JSX, no TypeScript.

- **Why not Python:** the owner asked for Python if possible. It was rejected because a PWA runs in the browser, where only JavaScript runs natively.
  - Pyodide/PyScript adds a runtime of about 10 MB and runs slowly on phones.
  - A Python server can't run on GitHub Pages.
  - The owner then said they had no preference.
- **Hosting:** local development for now, GitHub Pages later.
  - `.github/workflows/deploy.yml` is already set up.
  - `base: './'` and hash routing mean it works at a Pages sub-path with no server rewrites.
- **Routing:** a hand-rolled hash router in `src/lib/router.js`. There is no react-router.
- **State:** no state library.
  - `useLive(query, deps)` in `src/lib/db.js` re-runs async IndexedDB queries whenever the window event `csa-db` fires.
  - Every `db.put`, `db.del` or similar call dispatches that event.
- **Report bundle:** `src/lib/report.js`, which pulls in the large docx library, is loaded with dynamic `import()` so it doesn't bloat the main bundle.

## Owner decisions (from the clarifying Q&A)

| # | Topic | Decision |
|---|---|---|
| 1 | Users / sync | Single user, data only on the device (IndexedDB). Export an event summary as a **Word .docx report** showing number of issues, most common issues, and most difficult or recurring issue. A JSON backup and restore was also added. |
| 2 | Offline | Yes. Cache all event data when the event is added or refreshed, and work offline in the venue. |
| 3 | Hosting | Local development now, GitHub Pages later. |
| 4 | Nexus | The owner has a Nexus API key and uses the official API. |
| 5 | Pit map | Render from **Nexus map coordinates**. |
| 6 | Readiness | 3 items: radio flashed, inspection passed, connected to field / played a practice match. Originally all manual; the owner later asked for **radio and inspection to be checked off automatically from Nexus data** (see "Readiness from Nexus"). Field stays manual. |
| 7 | Colors | Red = 0 of 3, orange = 1–2 of 3, green = 3 of 3. **Day 1:** an unresolved ticket does NOT change the color. **Days 2 and 3:** an unresolved ticket turns the team **yellow**. |
| 8 | Event day | From TBA `start_date`. **Districts (event_type 1) = 2 days, everything else = 3 days.** |
| 9 | Days 2–3 priority | Teams with open tickets rank first, then order by next match. |
| 10 | Ticket fields | Timestamp, last match number, tags for common issues, priority (**Normal or High** only — the original low/medium/high/critical was collapsed; see data model). |
| 11 | Ticket ↔ team | Each ticket belongs to exactly **one** team. |
| 12 | History | Team history persists across events, shown as a short summary of prior-event issues on the team page. |
| 13 | Robot photo | Pulled from TBA media if available. Otherwise the user adds one from camera or gallery. |
| 14 | Language | Python if possible; it wasn't practical (see "Stack and why"). |

Additions made during the build that the owner hasn't explicitly confirmed. Keep them unless
the owner asks otherwise:

- a manual **day override** on the priorities tab;
- an optional **resolution notes** field on tickets;
- inline Nexus inspection/radio status and "played Qn" hints next to the team page's readiness checkboxes;
- the Teams tab's Radio / Insp. / Field marks are 1.5x-size buttons (`ReadinessMarks` with `onToggle`, `.marks.lg`) that toggle the item directly, sitting outside the row's open-team button;
- a "find team" highlight on the pit map;
- removing an event from the list keeps its tickets, so team history survives;
- **removing an event from the Home screen** as well as from the event page's Tickets tab;
- **ignoring a team** (didn't show up) — colors it black everywhere and drops it out of the priority list, toggled from the team page;
- a freeform **Notes** box per team per event, for things that aren't a ticket;
- **Flag for follow-up**: a normal-priority, pre-tagged (`Follow-up`) ticket draft for "something looked off, check on it later" — opens the ticket form pre-filled rather than saving anything until reviewed;
- a **Reference** tab with an offline, searchable CTRE/REV status-LED lookup;
- **Issues by match** chart on the team page: stacked blocks per ticket, one column per match in the team's schedule at this event (unplayed greyed), keyed by the ticket's `lastMatch`; tickets with no/unknown match go in a leading "Pre" column. Sits above the season-wide "Issues over time" dot chart;
- **anonymized report**: a second export button on the Tickets tab calls `buildEventReport(..., { anonymize: true })`. `teamLabeller()` in `report.js` maps every team number to a random Docker-style `adjective_surname` (`lib/dockerNames.js`, Docker's lists minus judgemental adjectives), fresh per export; nicknames are dropped, and team numbers (`1234`, `frc1234`) and nicknames inside ticket text are swapped in one regex pass;
- **Nexus Slack import** (`lib/nexusImport.js`): Tickets tab → "Import from a Nexus Slack message" → paste → preview → the ticket form at route id `import`, pre-filled via a one-slot draft (memory + sessionStorage). The owner gave two approximate formats (exact wording still unconfirmed; they'll send real copies later):
  `Team 9999 has requested help with the following:` + one issue per line (e.g. `Networking connection issues`, `Programming - java`), and
  `An FTA has requested a CSA to follow up with team 9999` + `FTA notes:` + note lines.
  `parseNexusMessage()` stays heuristic so small wording changes still work: strips Slack markup; `kind` is `fta` when the text mentions FTA and follow-up (title prefixed "FTA follow-up: ", `Follow-up` tag added); issues/notes are the lines under the first `...:` header (stopping at a blank line, another header or a `Key: value` field), else bullets, else text after "help with"; team from `Team N`/`frcN`/`#N`, else a roster number, else pit → team via Nexus pits; a match preceded by "next/queue/upcoming" isn't used as last match; tags via keyword rules (`network` → Field connection, `java`/`python`/… → Code). Update it when real messages arrive;
- a dev-only **Settings** button (`import.meta.env.DEV`) that seeds two fake linked events for UI testing without API keys;
- **light/dark mode** (`lib/theme.js`): Settings → Appearance (Match device / Light / Dark) plus a sun/moon toggle on Home. Stored in `localStorage` (`csa-theme`) so it applies before first paint; sets `data-theme` on `<html>`. Dark CSS applies under `@media (prefers-color-scheme: dark) :root:not([data-theme='light'])` and under `:root[data-theme='dark']` — any new dark-only rule needs both;
- the Word report is exported **only** from the button at the bottom of the event's Tickets tab (no top-bar icon);
- **ticket history is per season**: team-page History, Issues over time, the link picker, `nextTicketSeq()` numbering and the report's chains only consider tickets whose `ticketYear()` (first 4 chars of `eventKey`) matches the event's year. Team page has a "Clear history" button (this team's tickets at other events this season); Settings → Ticket history deletes a whole season or everything. All deletes go through `deleteTickets()` in `util.js`, which strips links on surviving tickets;
- robot photo viewer: your photo first, then TBA's; broken URLs are probed up front and dropped by URL (not index-shifting, which used to loop); prev/next buttons, swipe, arrow keys, dot indicator;
- **demo mode** (`lib/demoMode.js`, `DEMO_MODE = DEMO_BUILD && !isInstalledApp()`): the build flag is only true in the build the GitHub Pages workflow produces (`VITE_DEMO_MODE=true` set in `deploy.yml`'s build step, never in a plain `npm run build`). On Home, `ensureDemoSeeded()` runs the same `seedDevEvent()` fake dataset (teams **99101–99124**, chosen to be far above any real FRC number so nothing matches a real TBA team) once per browser if no events exist yet; `demoSeeded` stores a `DEMO_VERSION`, and bumping it reseeds returning visitors who only have demo events, so a public-demo visitor sees a populated example instead of an empty state; a `demoSeeded` setting flag stops it from running again or clobbering real data. Home also shows a banner explaining it's fake data with a "Reload demo data" button (always reseeds, ignoring that flag) and a note on installing it as an app (with an Install button when Chrome's `beforeinstallprompt` fired). When the demo build runs as an installed PWA (`display-mode: standalone` etc.) there's no banner and no seeding, and `removeDemoDataIfInstalled()` deletes the `2026demo`/`2026demo2` events plus their tickets/readiness once (the app shares storage with the browser tab).

## Project layout

```
src/
  main.jsx               entry; registers service worker; imports fonts
  App.jsx                route switch (see routes below)
  styles.css             all styling; design tokens as CSS variables
  lib/db.js              IndexedDB schema, db helpers, useLive hook, newId
  lib/api.js             tba() and nexus() fetch wrappers, defaultNexusBase()
  lib/sync.js            syncEvent(), fetchTeamMedia(), getEventIndex(), searchEvents()
  lib/logic.js           constants, event day, team color, match helpers, ticket chains, ticketToText()
  lib/report.js          buildEventReport() → docx Blob (lazy-loaded)
  lib/util.js            compressImage, backup export/import, toast, downloadBlob, copyText
  lib/router.js          useRoute, nav, replace, goBack
  lib/devSeed.js         seedDevEvent() — fake two-event dataset for the Settings dev-tools button
  lib/nexusImport.js     parseNexusMessage() + draft hand-off for the Slack import
  lib/dockerNames.js     random Docker-style names for the anonymized report
  lib/demoMode.js        DEMO_MODE flag, ensureDemoSeeded(), installed-app detection, install prompt
  lib/theme.js           light/dark preference: applyTheme(), useTheme()
  lib/ledCodes.js        static CTRE/REV status-LED reference data (Reference tab)
  components/ui.jsx      Icon, TopBar, TeamBox, ReadinessMarks, StatusPill, TicketRow, Legend, Modal, Toaster
  components/PitMap.jsx  SVG renderer for Nexus map JSON
  components/LedReference.jsx  searchable CTRE/REV LED blink-code lookup (Reference tab)
  pages/Home.jsx         monitored events + add by key / search
  pages/EventPage.jsx    5 tabs + useEventContext() + toggleReadiness() + setIgnored()
  pages/TeamPage.jsx     team info, thumbnail photo, readiness, matches, notes, issues-over-time, tickets, history
  pages/TicketPage.jsx   create/edit ticket, categorized tags, team/match typeaheads, two-way linking picker
  pages/Settings.jsx     API keys, Nexus base URL, backup/restore, erase, dev-mode seeding
public/                  favicon.svg, icons/ (192, 512, maskable 512)
```

### Routes (hash)

- `#/`: the home screen, listing monitored events.
- `#/settings`
- `#/event/:key` and `#/event/:key/tab/:tab`: the event page.
  - `:tab` is one of `map`, `today`, `teams`, `tickets`, `ref`.
- `#/event/:key/team/:number`
- `#/event/:key/ticket/:id`
  - `:id` can be `new`, `followup` or `import`, optionally followed by `/:team` to preset the team. `followup` pre-fills a normal-priority ticket tagged `Follow-up`; `import` pre-fills from a pasted Nexus Slack message. Both still require the user to review and save.

`TeamPage` and `TicketPage` are keyed by their route parameters in `App.jsx`, so that moving
between linked tickets remounts the page and resets the form.

## Data model (IndexedDB `csa-assistant`, version 2)

| Store | Key | Shape |
|---|---|---|
| `settings` | out-of-line key | `tbaKey`, `nexusKey`, `nexusBase`, `eventIndex:<year>` → `{fetchedAt, events[]}` |
| `events` | `key` | `{key, name, shortName, year, eventType, startDate, endDate, city, stateProv, country, teams[], matches[], nexus:{enabled, map, pits, live, inspection, error}, nexusEventKey, dayOverride, phaseOverride, addedAt, fetchedAt}` |
| `readiness` | `id = "<eventKey>:<team>"` | `{eventKey, team, radio, inspection, field, ignored, notes, nexusApplied:{radio?, inspection?}, updatedAt}` |
| `tickets` | `id` (uuid); indexes `eventKey`, `team` | `{eventKey, eventName, team:number, title, description, status, priority, tags[], lastMatch, resolution, links[], createdAt, updatedAt, resolvedAt}` |
| `media` | `id = "<team>:<year>"` | TBA `{photos[] (direct URLs), avatar (data URL), fetchedAt}`, cached for 12 hours |
| `photos` | `id = "<team>"` | photo taken by the user: `{dataUrl (JPEG, max side 1400px), year, updatedAt}` |

Details of the `events` store:

- Each entry in `teams[]` is `{number, nickname, name, schoolName, city, stateProv, country, rookieYear, website}`.
- Each entry in `matches[]` is normalized to `{key, compLevel, setNumber, matchNumber, red[], blue[], redScore, blueScore, time, predictedTime, actualTime, played}`.
- `matches[]` is sorted qm → ef → qf → sf → f.
- A match counts as `played` if `actual_time` is set or the red score is ≥ 0.

Details of the `tickets` store:

- `status` is one of `unresolved`, `resolved` or `declined`. The UI labels them "Unresolved / watch", "Resolved" and "Declined help".
- `priority` is `normal` or `high` (weights 1 and 3). DB version 2's upgrade maps old `low`/`medium` → `normal` and `high`/`critical` → `high`; `importBackup()` applies the same `normalizePriority()` to older backups.
- **Links are two-way.** `TicketPage.save()` updates the other side of every link it adds or removes. `remove()` also cleans up the other side. The "Link a ticket" picker only ever offers the *same team's* other tickets (across any event) — cross-team linking isn't offered, since a continuing-issue link only makes sense within one team.
- On the ticket page, "Linked tickets" is shown after the Save button (not before), and "Copy ticket as text" is a full-width button at the very bottom of the page (not a top-bar icon) — both are deliberately placed for visibility rather than tucked above the fold with the edit fields.
- `eventName` is stored on the ticket itself, so history still reads correctly after its event is removed.
- Tags are grouped into categories in `TAG_CATEGORIES` (Electrical, Software, Mechanical, Meta) purely for the picker UI; `PRESET_TAGS` is flattened from it. `Follow-up` is the Meta-category tag used by the "Flag for follow-up" flow.
- **`seq`** is a per-team incremental ticket number, assigned once at creation via `nextTicketSeq()` (max existing `seq` for that team, across all events, plus one) and never changed after. `ticketNumber(ticket)` formats it as `"<team>-<seq>"` (e.g. `1005-1`), shown in `TicketRow` and the ticket page's title. Older tickets without a `seq` display `"<team>-?"`.

Changing the schema requires bumping the version in `openDB` and adding an upgrade step.

## External APIs

### The Blue Alliance v3

- Base URL: `https://www.thebluealliance.com/api/v3`
- Header: `X-TBA-Auth-Key`
- TBA allows cross-origin browser requests.
- Endpoints used:
  - `/status` (checks that a key works)
  - `/events/{year}/simple` (search index, cached for 24 hours)
  - `/event/{key}`
  - `/event/{key}/teams`
  - `/event/{key}/matches/simple`
  - `/team/frc{n}/media/{year}`
    - The robot photo comes from media of type `imgur`, `cdphotothread` or `instagram-image` that has a `direct_url`. Items marked `preferred` are used first.
    - The team avatar comes from media of type `avatar`, using `details.base64Image`.
- There is no search endpoint, so event search filters the cached season list on the device.

### FRC Nexus v1

- Base URL: `https://frc.nexus/api/v1`
- Header: `Nexus-Api-Key`
- Documentation: https://frc.nexus/api/v1/docs
- A 404 response means "no data". `nexus()` returns `null` in that case rather than throwing.
- Endpoints used:
  - `/event/{key}` (live status: `nowQueuing`, `matches[]` with `label`, `status`, `times.estimatedQueueTime` and more)
  - `/event/{key}/pits` (team number → pit address)
  - `/event/{key}/map`
  - `/event/{key}/inspection`
  - `/events` (only used to test the key)
- **Map JSON:** `{size, pits, areas, labels, arrows, walls}`.
  - Each item has `position` (the **center**) and `size`.
  - An item may also have `angle` (degrees) and, for pits, `team`.
  - `PitMap.jsx` draws each rectangle at `x - w/2, y - h/2` and rotates it about its center.
  - If a pit item has no `team` (or the event's map data doesn't populate it), `PitMap.jsx` falls back to a reverse lookup from the `/pits` endpoint's team→address map, normalizing address casing/whitespace since the two endpoints aren't guaranteed to format them identically. This is verified correct against Nexus's official OpenAPI schema (`team` is a nullable string on each pit item; `/pits` is `{teamNumber: address}`). If every pit still shows only its address, `PitMap.jsx` shows an explicit notice — the most likely cause is Nexus not having pit-to-team assignments published yet for that event (the map layout and the assignments are separate steps on Nexus's side), not a client bug. Refresh the event after assignments are made.
- **Label mapping in `logic.js`:**
  - `Qualification N` → `{key}_qm{N}`
  - `Playoff N` → `{key}_sf{N}m1`
  - `Final N` → `{key}_f1m{N}`
  - Practice matches have no TBA equivalent.
- Nexus asks for attribution. Links to frc.nexus appear in the event page footer and in Settings.
- **Cross-origin handling:**
  - `defaultNexusBase()` returns `/nexus-api` on localhost, which goes through the Vite proxy, and the real URL everywhere else.
  - It is **unverified** whether Nexus allows direct browser requests.
  - If it doesn't, the user sets a proxy URL in Settings. The README includes a Cloudflare Worker for this.

## Refreshing event data

- Reloading the browser page never re-downloads by itself; the event page does it: opening (or reloading) an event whose `fetchedAt` is more than 5 minutes old re-syncs in the background (`AUTO_REFRESH_MS` in `EventPage.jsx`; skipped offline, for demo events, and with no API keys). The top-bar refresh icon always re-syncs.
- `syncEvent()` refreshes TBA and Nexus independently for an event already saved: a TBA failure keeps the saved TBA fields/teams/schedule but still saves new Nexus data (e.g. a newly published pit map), and vice versa. Only adding a brand-new event requires TBA. It returns the record plus `warnings` (not stored); the refresh toast lists them instead of claiming success.
- `dayOverride`, `phaseOverride` and `nexusEventKey` survive a refresh.
- **Nexus event code override** (`nexusEventKey`): Nexus can file an event under a different code than TBA — seen for real with an offseason event, TBA `2026cass` vs. Nexus `2026cael`. `syncEvent()` sends every Nexus request (map, pits, live, inspection) to `nexusEventKey || key`. Set from the "Nexus event code" box on the Pit map tab (on the N/A screen and under a loaded map) via `setNexusEventKey()`, which clears the Nexus data loaded under the old code and re-syncs; an empty value or the TBA key itself resets it to null. Everything else (routes, tickets, Nexus match-label → TBA match-key mapping) keeps using the TBA `key`.
- Nexus requests use `cache: 'no-store'` and TBA `cache: 'no-cache'`, so a browser HTTP-cache copy can never hide new data. The service worker doesn't cache either API.
- The Pit map tab's N/A screen shows when Nexus was last checked.

## Readiness from Nexus

- After every sync with a Nexus key, `applyNexusReadiness()` in `sync.js` checks off `inspection` for teams Nexus reports as passed and `radio` for teams Nexus reports as done. It only ever checks items, never unchecks them, and records each one in `readiness.nexusApplied` so it's applied **once per team per item**: if the user unchecks something Nexus marked, later refreshes leave it alone.
- `nexusReadiness(event, team)` in `logic.js` reads `event.nexus.inspection`. **Its shape is unverified** (no reachable docs), so it accepts `{ "254": {status, ...} }`, `{ "254": "Passed" }`, `{ "frc254": ... }`, an array of `{team|teamNumber, status}`, or those wrapped in `{teams|inspections: ...}`. Passed = status matching pass/complete/inspected/approved/done and not not/fail/reinspect/pending/waiting/progress, or `passed: true`.
- **Radio:** it's unconfirmed that Nexus reports radio status at all. Radio is only auto-checked if the team's inspection record has a field whose name contains "radio" (boolean, a status string like "Programmed", or `{status}`/`{programmed}`); with no such field nothing is inferred. If the owner sends a real `/inspection` payload, tighten both rules to it.

## Business rules (in `src/lib/logic.js`)

**Event day.** `eventDay()` works it out as follows:

1. `raw = today − start_date + 1`.
2. `len` is 2 for districts and 3 for everything else.
3. The day is `raw` clamped to the range 1 to `len`.
4. If `dayOverride` is set, it wins.
5. The phase is `before`, `during` or `after`, and `dayCaption()` builds the display text.

This is calendar-only and only feeds the "Day X of Y" caption in the event page's top bar —
it no longer decides which Priority list view shows (see **Competition phase** below).

**Competition phase.** `competitionPhase(event, now)` decides Practice vs. Event using the TBA
schedule, not the calendar day, so a rain delay or an early start doesn't fool it:

1. If any qualification match (`compLevel === 'qm'`) is marked `played`, the phase is `event`.
2. Otherwise, if the first qualification match's scheduled time has passed, the phase is `event`.
3. Otherwise (including when there's no schedule posted yet), the phase is `practice`.
4. `event.phaseOverride` (`'practice'` | `'event'` | `null`), set from the Priority list tab's
   Phase dropdown, wins over all of that. The dropdown's "Auto (...)" option still shows what
   auto-detection currently thinks, even while overridden.

**Team color.** `teamColor({readiness, openTickets, phase})`:

- A team marked `readiness.ignored` is always `ignored` (black), overriding everything else.
- Otherwise, once the phase is `event`, any unresolved ticket gives `watch` (yellow).
- Otherwise the color depends on how many readiness items are done:
  - 3 → `ready`
  - 0 → `none`
  - 1–2 → `partial`
- The fill and text colors live in CSS variables `--st-*`.

**Tabs.**

- If a Nexus map with pits exists, the tab order is Pit map, Priority list, Teams, Tickets, Reference.
- If not, it is Teams, Priority list, Tickets, Pit map, Reference. The Pit map tab then shows the N/A graphic along with the reason.
- The Priority list tab's title and heading are constant ("Priority list") regardless of phase or event type; only the content underneath changes between the practice-phase readiness view and the event-phase match-priority view. It has its own sort control (team number, priority, or unresolved-ticket count, each ascending/descending) that only re-sorts on an explicit re-sort action (button or pull-to-refresh gesture) — not automatically as readiness/tickets change, so rows don't jump while you're working through the list.
- Reference is static, offline content with the online documentation links (WPILib, CTRE Phoenix 6/5, REVLib, REV hardware, FRC radio) at the **bottom**. The LED tables start with the **VH-109 robot radio** (PWR/SYS patterns from Vivid-Hosting's LED page via search snippets — the page itself was unreachable, so 2.4G/6G/RIO rows are generic link-light descriptions worth checking), then CTRE and REV (`lib/ledCodes.js` + `components/LedReference.jsx`) — each device is a collapsible box (all **open** by default, "Collapse/Expand all" toggle; searching opens every match, and matches can still be collapsed — that search-time state resets with each new search and never touches the normal open/closed state) with zebra-striped rows; a searchable lookup of CTRE/REV status-LED blink codes, each with a small animated color swatch (`.led-dot` / `.led-blink` / `.led-alt` in `styles.css`) approximating solid/blinking/alternating patterns. It doesn't read the event at all, so it renders the same regardless of which event is open.
- The pit map's "find a team" box and the ticket form's Team field are both typeahead comboboxes (`.combo-wrap`/`.combo-list` in `styles.css`) that filter the event's roster as you type a team number, rather than a plain `<select>`.
- The ticket form's "Last match played" is a dropdown listing the team's whole schedule (not filtered to already-played matches — TBA can lag a few minutes behind a live match), plus "N/A" and an "Other / practice match…" option that reveals a free-text field.
- "Flag for follow-up" (Teams tab, match-priority rows, team page) never writes a ticket in the background — it navigates to the ticket form pre-filled with a "Possible issue — follow up" draft and the `Follow-up` tag (route id `followup` instead of `new`), so nothing is saved until the user reviews it and taps Create.

**Day 1 priorities.**

- Lists teams with fewer than 3 readiness items done, fewest done first, then by team number.
- The items can be checked off right in the list.
- A progress bar shows how many teams are ready.

**Day 2–3 priorities.**

- Teams are sorted by:
  1. whether they have an open ticket;
  2. the priority weight of their top open ticket;
  3. their next unplayed match in TBA order;
  4. team number.
- The list is split into "Open tickets" and "Up next on the field".
- Time estimates use Nexus `estimatedQueueTime` when available, otherwise TBA `predicted_time` or `time`.

**Last match on a new ticket.** Auto-filled from the team's most recent played TBA match. This stops once the user edits the field.

**Continuing issues.** `ticketChains()` finds groups of tickets connected by links. The team page shows every chain with more than one ticket, plus tickets from other events grouped by event with tag counts.

**Report.** `buildEventReport()` produces a US Letter .docx with these sections:

- summary counts;
- a tag frequency table;
- the most difficult or recurring issue: the chain with the highest `difficultyScore` = `3·size + Σpriority weight + 3·(events−1) + 2 if any ticket is unresolved`;
- teams with repeat tickets;
- tickets still unresolved;
- a full ticket log.

Tags come from the preset list `PRESET_TAGS`, plus any custom tags used before (these are offered again automatically).

## Design system

- **Audience:** a CSA on a phone, one-handed, in a loud and brightly lit arena. Tap targets are at least 44px.
- **Colors:**
  - Chrome: FIRST-style blue `#0B5CAD` for the top bar and accent.
  - Background: cool gray paper `#EDF0F3`.
  - Text: slate ink `#16212C`.
  - Dark mode via `prefers-color-scheme`.
- **Status colors:** ready `#2E9D46`, partial `#EE8A1A`, none `#D63B3B`, watch `#F5CC2E`.
- **Type:** Barlow for body text. Barlow Condensed 700 for team numbers, which appear everywhere as "pit sign" blocks. The `TeamBox` component deliberately echoes the pit map boxes.
- **Layout:** list rows inside `.sheet` containers. Avoid generic card grids.
- **Writing:** sentence case and plain verbs. Error messages say how to fix the problem.

## Verified vs. unverified

**Verified in the sandbox with mock data:**

- the build succeeds;
- every screen renders at 400px width;
- pit map rendering;
- priorities for both day modes;
- ticket create, edit and linking;
- the team history section;
- .docx report generation, rendered and checked visually.

**Not verified:**

- live TBA and Nexus calls (the sandbox blocked them);
- real Nexus map files with angled or complex layouts;
- whether Nexus allows direct browser requests once hosted;
- installing on a real Android device;
- saving a download from inside an installed PWA.

## Ideas / possible next steps (not requested yet)

- Pinch-zoom or pan gestures on the pit map (it currently uses +/−/Fit buttons).
- Sharing the report via the Web Share API (`navigator.share` with a file) as an alternative to downloading.
- An auto-refresh interval for live Nexus queue data during matches.
- Code-splitting or a smaller bundle; tests for `logic.js`.
