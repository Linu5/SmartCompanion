# RailPulse accounts and saved commutes

Start with [FRIEND-SETUP.md](FRIEND-SETUP.md). It contains the exact setup steps for the current connected project, email callbacks, and optional background notifications.

- Fresh project: run `railpulse-setup.sql` once, then `verify-setup.sql`.
- Existing five-table installation: run `migrations/20260913025956_companion_features.sql` instead of the initial setup.
- The older `add-saved-places.sql` is only for legacy four-table installations. Apply that first if necessary, then the companion upgrade.

The browser uses the public publishable key in `public/project-config.json`. Each saved item is read/written with the signed-in user's Supabase session. No account is needed for transport checks, nearby search, station patterns or foreground trip guidance.

Six user tables hold profiles, preferences, places, routes, favourite buses and push subscriptions. RLS and owner policies protect every CRUD operation; anonymous table access is denied. Two backend-only tables hold delivery claims and scheduler status. No client has access to those tables. Deleting an Auth user cascades their RailPulse records. Unrelated tables are untouched.

Connected route bookmarks keep `mode=train` with `station:`, `stop:` or `point:` endpoint IDs and a `journey` JSON object containing the request, endpoint labels/coordinates and user preferences. Only source data and preferences are saved: never an old ETA, crowd reading or entire API response. Opening a bookmark replans with fresh data. Bus-only route IDs preserve their five-digit codes. Places support a single Home and Work per user plus custom places; edit those unique shortcuts rather than inserting duplicates.

The `settings` JSON column stores selected walking pace/limit, crowd preference and transfer allowance. `watched_lines` and route `alert_lines` personalise train disruption alerts. Names and JSON fields never grant ownership: policies use `auth.uid()` and `user_id` only.

## Local validation

The isolated validation script requires PGlite in `.cache/supabase-sql-check`. Install it there if absent:

```powershell
npm install --prefix .cache/supabase-sql-check --save-exact @electric-sql/pglite@0.5.8
node supabase/validate-local.cjs
node supabase/validate-local.cjs --companion-upgrade
```

Fresh and upgrade schemas passed 154 checks each with synthetic users: ownership, all CRUD operations, anonymous denial, backend-only metadata, constraints, unique Home/Work, timestamps, cascades and preservation of unrelated data. This does not test hosted JWT validation, Auth emails or actual push delivery. The app shows configuration and service failures honestly rather than claiming a save or notification succeeded.
