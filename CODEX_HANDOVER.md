# RailPulse — project and Codex handover

Prepared on **13 September 2026**, Singapore time. This is a continuation guide for another device, not a new project specification. Recheck live services and repository state before relying on this snapshot.

## Start the next Codex session with this

> Read CODEX_HANDOVER.md and README.md, inspect the current branch and working tree, and continue RailPulse from its existing implementation. First establish the status of the intended Supabase project and finish the account/saved-commute setup where access permits. Keep the transport checker available without login. Preserve the real-data distinctions, mobile usability and accessibility requirements in the handover. Verify any changes before reporting them complete. Do not rebuild the app or assume an open Supabase browser tab is the project's database.

## What this project is about

**RailPulse / Smart Commuter Companion** helps people travel around Singapore using trains and buses. It is intended primarily for phones, with a polished laptop layout too.

The original challenge is to build a smart commuter companion that offers proactive decisions during planned and unplanned transport events, tailored to commuters' needs. The app should help people decide how to travel, when to leave, what alternatives exist during disruptions, and how to make the journey more comfortable and accessible.

The user's priorities are:

- Support **train only, train & bus, and bus only**.
- Use actual transport data; show unavailable information honestly.
- Make route results, maps, times and crowd levels easy to read on a phone.
- Include wheelchair-related requirements and useful journey preferences.
- Keep **Journey preferences permanently expanded**.
- Let anyone check transport without signing in.
- Require sign-in to save Home, Work, custom places, routes and favourite buses, with syncing across devices.
- Account for rush hours using real patterns, while keeping historical patterns separate from live readings and forecasts.
- Add nearby stops, connected bus → MRT → bus journeys, stop/transfer guidance and personal disruption alerts.

## Repository and deployment

| Item | Location / status |
| --- | --- |
| GitHub | https://github.com/Linu5/SmartCompanion |
| Production | https://smart-companion-nine.vercel.app/ |
| Current development branch | `main` at handover preparation |
| Latest application implementation commit | `bf2adc2` — Add saved commutes, connected journeys and rush-hour patterns |
| Existing release tags | `v1.0.0`, `v1.10` |
| Previous Windows checkout | `D:\Programing\SmartCompanion` |
| Deployment | GitHub push to `main` triggers Vercel |
| Actual Vercel project | `linusonng-3344 / smart-companion` |

Commit `bf2adc2` was pushed and Vercel reported a successful deployment. The production page and new APIs were checked afterward. This handover is a subsequent documentation change; use `git log` to determine the latest commit on the new device.

The user previously authorised pushing completed changes and checking deployment. Preserve existing tags; no new version tag was requested for the companion upgrade or this handover. A connected Vercel account in Codex previously exposed unrelated Hi-Lite projects, so do not assume the connector points to RailPulse.

## What is already implemented

### Public transport and interface

- Phone bottom navigation: Plan, Map, Buses, Saved, plus a conditional Trip tab during guidance. Laptop layout has the planner alongside the map.
- Light/dark themes, searchable station selection, larger touch controls, readable arrival/crowd cards and clearer route highlighting.
- Current LTA station/stop data; inactive/future stations are excluded from the operating train planner.
- Train timetable routing with service calendars, midnight handling, transfers, disruption checks and station crowd information.
- Direct bus routing and upcoming arrivals with crowd categories, vehicle type and monitored/scheduled indicators.
- Connected walking/bus/train journeys, including bus → train → bus.
- Location search by station/stop name or code, map pin selection, coordinates and optional device location. Arbitrary address geocoding is not implemented.
- Nearby stations and stops, plus official station exit coordinates and external walking-direction links.
- Always-open preferences: journey priority, walking distance, walking/rolling pace, train transfer allowance, wheelchair requirement and bus crowd preference.
- Six half-hour departure comparisons with scheduled journey details and matching LTA crowd forecasts when available.
- Historical hourly passenger-activity profiles, with weekday/weekend/holiday handling and quieter usual departure suggestions when supported by data.
- Current nearby road incident reports, separate from crowd comparisons.

### Accounts and saved commutes

The frontend and database SQL are implemented, but **hosted account/saving flows are not yet verified end to end**:

- Supabase email/password sign-up, sign-in, sign-out and password recovery.
- Home, Work and custom saved places; route bookmarks; favourite buses; synced preferences.
- Watched train lines and personal in-app service alerts.
- Per-user row level security (RLS) and account-deletion cascades.

Optional local preference remembering works without login. It stores settings only; it does not provide guest saving of Home/Work/routes/buses.

### Guidance and notifications

- Start a journey and follow boarding, stop progress, transfers and alighting steps.
- Manual next-stop controls plus opt-in foreground GPS reminders; two consistent accurate fixes are required before automatic progress.
- Installable web app manifest, service worker and offline fallback page.
- Background disruption notification backend with Web Push, personal watched-line matching, durable deduplication and an authenticated scheduler endpoint.
- Background subscription controls stay disabled until required server configuration exists and a scheduler has recently succeeded.

## The unfinished Supabase setup — highest-priority continuation

### Intended project

- **Project ID:** `kpzjvmsyzhmnhcbwgcty`
- **Project URL:** https://kpzjvmsyzhmnhcbwgcty.supabase.co
- The public publishable key is already in [`public/project-config.json`](public/project-config.json). It is deliberately browser-visible. Do not copy private credentials into this handover.

The user initially asked not to use Supabase yet, then provided their friend's project URL and corrected publishable key. That later instruction enabled this project's connection. The friend retains ownership.

The last read-only check on 13 September 2026 found:

- Auth settings accepted the supplied publishable key: HTTP 200, sign-ups enabled.
- The Data API lookup for `railpulse_saved_places` returned HTTP 404 / `PGRST205`, indicating the table was not available in the API schema.
- No hosted schema changes were made by Codex. Existing connected Supabase tools did not have access to this project.
- No real user accounts were created, confirmation/reset emails sent, or test push notifications delivered by Codex.

The user agreed their friend could run the SQL. They then asked about direct database access and hypothetically being signed in to Supabase. Dashboard invitations and separate PostgreSQL logins were explained, but **neither new access nor a completed schema installation has been confirmed**. Later ambient browser tabs showed other project IDs; those were not an explicit request to switch RailPulse to another database.

### Setup files to use

1. Read [`supabase/FRIEND-SETUP.md`](supabase/FRIEND-SETUP.md) for the complete workflow.
2. For a fresh RailPulse installation, run [`supabase/railpulse-setup.sql`](supabase/railpulse-setup.sql) **once** in the intended project.
3. If the previous five-table RailPulse schema already exists, use [`supabase/migrations/20260913025956_companion_features.sql`](supabase/migrations/20260913025956_companion_features.sql) instead. **Do not run both.** Inspect mismatched existing schemas and prepare a suitable migration; preserve existing data.
4. Run [`supabase/verify-setup.sql`](supabase/verify-setup.sql).
5. Configure Auth redirect URLs, email confirmation and SMTP as described in the guide. Preserve other apps' configuration if the friend's project is shared.
6. Verify hosted sign-in, saving, reload persistence, cross-device syncing, ownership isolation, sign-out and recovery with an appropriate test account when authorised.

Six user tables: `railpulse_profiles`, `railpulse_preferences`, `railpulse_saved_routes`, `railpulse_favourite_buses`, `railpulse_saved_places`, `railpulse_push_subscriptions`.

Two backend-only tables: `railpulse_notification_deliveries`, `railpulse_notification_status`.

Signing in to the Supabase website is different from signing in as a RailPulse user. A dashboard account needs access to the friend's organisation/project to manage its database. The public app key does not grant SQL administration privileges. A PostgreSQL connection needs separate database credentials; those were discussed but not supplied.

### Background notifications remain unconfigured

The backend needs `SUPABASE_SECRET_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and `CRON_SECRET`, plus an authenticated scheduler calling `POST /api/notifications/check` about every five minutes. See the setup guide's Supabase Cron/pg_net/Vault example.

`node scripts/create-push-config.cjs` can generate VAPID keys and a cron secret into ignored `.env.push`; it was **not run** in this session. Never replace deployed keys without considering existing subscriptions. At the last production check, `/api/notifications/config` returned `ready: false`; an unauthenticated scheduler request correctly returned 401.

## Data accuracy rules Codex must preserve

| Display | What it actually means |
| --- | --- |
| Train departure/arrival | Published LTA GTFS timetable, **not live next-train prediction** |
| Station crowd | LTA station observation or a matching-date forecast, **not carriage occupancy** |
| Bus crowd | LTA `SEA` = seats available, `SDA` = standing available, `LSD` = limited standing |
| Historical busy periods | LTA monthly tap-ins + tap-outs by location, hour and day type; **not measured occupancy or a traffic forecast** |
| Road conditions | Current nearby reported incidents; no incidents does not prove clear roads |
| Bus journey duration | Arrival information plus estimated ride/walk times; unknown later bus waits must stay explicit |
| Wheelchair results | Bus `WAB` flags and lift notices provide partial evidence; walking paths, accessible exits and bay availability are not verified |

Do not fabricate data, hard-code plausible crowd levels, reuse today's forecast for another date, treat missing values as low crowding, or relabel scheduled times as live. Historical rush-hour suggestions must not overwrite official LTA crowd readings. Only the 2026 Singapore holiday calendar has been verified so far.

Connected-route search is bounded, not an exhaustive guarantee of the fastest possible journey. Bus-only currently finds direct services; bus-to-bus transfer routing without rail is not implemented. Walking estimates use adjusted straight-line distance, not a verified pedestrian routing engine. See README for the exact assumptions and limits.

GPS guidance works while the app is open and can fail underground. Background service-disruption push is a separate feature. Do not promise closed-app GPS alighting reminders. The service worker caches only the offline page and icon, not personal data or live transport results.

## Architecture and useful files

This is **plain JavaScript/HTML/CSS + Express**, not Next.js or React. Node.js 22+ is required. Leaflet renders the OpenStreetMap basemap. Supabase JS is pinned to `2.116.0`; Web Push is pinned to `3.6.7`.

| Files | Responsibility |
| --- | --- |
| `server.js`, `api/index.js`, `vercel.json` | Express API, Vercel entry point and rewrites |
| `lib/lta.js`, `lib/rail.js`, `lib/bus.js` | DataMall access, caching, timetable routing and directional bus matching |
| `lib/accessibility.js`, `lib/preferences.js` | Wheelchair evidence, walking/transfer settings and crowd filters |
| `lib/combined.js`, `lib/locations.js` | Connected routing, nearby search and official exits |
| `lib/patterns.js`, `lib/travel-times.js` | Historical passenger profiles, departure comparisons and road reports |
| `lib/notifications.js` | Authenticated notification job, Web Push and delivery receipts |
| `public/index.html`, `public/style.css`, `public/app.js` | Main interface, map and original journey flows |
| `public/companion.js`, `public/companion.css` | New locations, connected cards, nearby UI and companion layouts |
| `public/account.js`, `public/project-config.json` | Account/saved features and public project configuration |
| `public/trip.js`, `public/guidance.js` | Journey guidance and progress calculations |
| `public/travel-times.js` | Departure comparison dialog and historical pattern presentation |
| `public/sw.js`, `public/manifest.webmanifest` | Offline/install support and push handling |
| `public/vendor/`, `scripts/vendor.cjs` | Browser Supabase SDK and reproducible vendoring via `npm run vendor` |
| `test/`, `supabase/validate-local.cjs` | Offline app tests and isolated SQL checks |

Browser scripts share some existing global state; preserve script loading order. Old station spreadsheets, GeoJSON and mock-data files remain for reference and are not the running planner's data sources.

## Start on another device

```sh
git clone https://github.com/Linu5/SmartCompanion.git
cd SmartCompanion
npm ci
```

Copy `.env.example` to `.env` and privately configure `LTA_DATAMALL_API_KEY`. The old device's ignored `.env`, `.env.push`, caches, installed dependencies and browser sessions are **not transferred by Git**. Obtain the transport key through a trusted private channel or the owner's existing configuration; do not print it in tool output or commit it.

```sh
npm start
# Or: npm run dev
```

Open http://localhost:3000/. Cold starts can take longer while real reference datasets download. Do not add fake results to disguise first-load latency.

## Verification record and commands

The previous session recorded **45 passing app tests**, and **154 passing PostgreSQL checks each** for fresh setup and the companion upgrade. These are completed checks from that session, not proof of a future hosted setup.

```sh
npm test
```

The SQL validator uses an isolated PGlite installation in an ignored cache directory. On a new device, install that dependency before running it:

```sh
npm install --prefix .cache/supabase-sql-check --no-save --package-lock=false @electric-sql/pglite@0.5.8
node supabase/validate-local.cjs
node supabase/validate-local.cjs --companion-upgrade
```

The upgrade test reads commit `462b266` from Git history, so a shallow checkout may need that history fetched. The validator creates synthetic Auth fixtures in memory; **never run those fixtures against the hosted project**. These tests do not validate real JWTs, email delivery or actual push delivery.

Completed browser checks included 320 px and 390 px phones, 1440 px laptop, light/dark layouts, searchable stations, nearby stops, station exits, manual trip guidance, the conditional Trip tab, signed-out Saved/account UI and future departure comparisons. No horizontal overflow or browser JS errors were found in those checks.

Production checks after `bf2adc2` included:

- A real connected route from stop `21161` to stop `64161`, returning bus → walk → train → train → walk → bus options.
- Historical bus-stop activity at `01012`, sourced from LTA August 2026 passenger volumes.
- Three official exits at Boon Keng (`NE9`).
- Public SDK/config served successfully; `/.env` returned 404; unauthenticated notification job returned 401.

## What Codex should do next

1. Inspect the checkout, current instructions/skills and any uncommitted user changes. Read this handover, README and the friend setup guide. Continue the existing app.
2. Recheck the intended Supabase project's schema/readiness and the actual available access. If access now exists, complete the remaining authorised setup there; otherwise give the owner the exact outstanding steps and continue useful independent work. Do not alter unrelated projects because they happen to be open or connected.
3. Finish and verify hosted account/saved-commute flows. Keep unrelated project data and settings intact. Do not claim saving works merely because a publishable key is accepted.
4. Enable and verify background disruption delivery when the required server configuration and scheduler are available. Do not imply notifications are active while setup is missing.
5. Fix issues uncovered by actual end-to-end testing, especially on phones. Keep the interfaces simple, legible and accessible, and preserve all three journey modes.
6. Run checks appropriate to the change, then publish completed changes under the user's continuing GitHub/deployment instructions and verify production. Preserve tags unless the user requests a new release.
7. Report what changed, what was tested, and what still depends on the owner. Give concise progress updates; avoid repeatedly asking for permission already provided. Ask only for genuinely missing access, project selection or other necessary input.

No private database password, backend Supabase key, VAPID private key or cron secret was provided or included in this file. New-device connectors may expose different accounts; verify their target rather than assuming they inherit the previous device's access.
