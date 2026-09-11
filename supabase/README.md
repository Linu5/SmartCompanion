# Supabase setup for RailPulse

Send this folder to the friend who manages the Supabase project. The SQL prepares the database; login, saved places and bookmarking still need to be connected in the RailPulse app. No Supabase connection or dashboard account is needed just to share these files.

## Guest access and saved shortcuts

The checker stays available without an account. Login is required to save personal items across sessions/devices, not to check transport information.

| Feature | Guest | Signed in |
| --- | --- | --- |
| Plan train/bus journeys; check arrivals, crowds and service alerts | Yes | Yes |
| Choose wheelchair access and travel preferences for this journey | Yes | Yes |
| Save Home, Work and other places | No | Yes, private to that account |
| Bookmark routes and favourite buses | No | Yes, private to that account |
| Sync saved preferences across devices | No | Yes |

Planned app flow: open directly into the checker; show **Home**, **Work** and **Saved places** shortcuts near the journey inputs after sign-in. Tapping a shortcut chooses an origin or destination; editing it changes the saved location. Guests see **Sign in to save** when they tap Save and can return to the checker without signing in. Clear personal saved-item state when signing out or switching accounts. Existing guest controls must continue working even if Supabase is unavailable. Guest mode does not use Supabase anonymous sign-in.

These are integration requirements, not UI features already installed. The current app routes between stations or bus stops. Saving street addresses is supported by this schema, but address search/geocoding and connecting an address to usable transit access points still need app work; never pass a street address directly as a station ID.

## 1. Create the tables

1. Open the intended Supabase project. A dedicated RailPulse project is preferable if another app already uses your friend's project, because Auth users and Auth settings are shared across a project.
2. Open **SQL Editor → New query**.
3. Paste the entire contents of **railpulse-setup.sql**, then click **Run**.
4. Expect five rows with `rls_enabled = true`. The tables will initially be empty.

**Already ran the previous four-table setup?** Run **add-saved-places.sql** once instead of rerunning the full setup. It adds the fifth table and its privacy rules while retaining existing profiles, preferences, route bookmarks and bus favourites. If `railpulse_saved_places` already exists, do not run either setup again; run verification and inspect the existing schema. Do not run both installation scripts on a fresh project.

Run the initial setup once. It creates only prefixed RailPulse tables/function, policies, indexes and update triggers. It does not change other tables, create login accounts, change project-wide default privileges, or install a signup trigger. If any RailPulse table/function already exists, it fails inside a transaction instead of replacing existing data. If the editor reports an aborted transaction, run `ROLLBACK;` before another query, and inspect the original error. Do not delete existing tables to bypass it.

| Table | What it stores |
| --- | --- |
| `railpulse_profiles` | Optional display name, linked to the person's Supabase Auth user ID |
| `railpulse_preferences` | Journey mode, travel priority, wheelchair requirement, transfer allowance, light/dark theme |
| `railpulse_saved_places` | Individual Home, Work and custom locations, using an address/map position, station or bus stop |
| `railpulse_saved_routes` | A named bookmark with origin, destination and journey mode |
| `railpulse_favourite_buses` | A bus service at a chosen boarding stop, optional direction and label |

**Do not create a password table or manually insert signups into `auth.users`.** Supabase Auth manages accounts and passwords. The application should create profile/preferences rows after a successful authenticated sign-in, using inserts that ignore an existing row rather than overwriting saved preferences. Empty profile/preferences tables before that are expected.

All five tables use `user_id` ownership policies for reading, inserting, updating and deleting. Signed-out clients have no access to these personal tables; the public checker uses the existing transport API. Changing a row's owner to another user is rejected. Project administrators and privileged service keys can still access project data; these rules separate ordinary app users.

## 2. Check the setup

Run **verify-setup.sql** in SQL Editor. The first result should contain exactly five rows and all check columns should be `true`; the second should contain two `true` values. The last result lists the 20 policies: check that each uses `auth.uid() = user_id` in the relevant predicate.

In the Data API settings, confirm the Data API is enabled and **public** is exposed. The setup grants the required permissions only on the five RailPulse tables. Also review the project's **Security Advisor** for these tables.

SQL Editor normally runs as an administrator and can see all rows. Seeing all users there does not test the app's privacy rules. After app integration, verify with two separate signed-in test accounts that one cannot see or change the other's bookmarks.

## 3. Configure login

In **Authentication**:

1. Enable the **Email** provider and allow new user signups if the app will have open registration. Keep email confirmation enabled.
2. Under **URL Configuration**, use `http://localhost:3000` as the Site URL while developing a dedicated local RailPulse project. Add `http://localhost:3000/` and `http://localhost:3000/**` to the allowed redirect URLs. The application will need to handle confirmation and password-reset callbacks when login is implemented.
3. For an existing project used by another app, preserve that app's Site URL and redirect entries. Add RailPulse's allowed URLs; its signup/reset requests must specify their own allowed redirect explicitly.
4. For the public app, use its actual HTTPS URL and exact callback URLs. Do not use broad production redirect wildcards. Add phone/LAN test URLs explicitly if testing on a phone; `localhost` on a phone refers to the phone itself.
5. Configure **custom SMTP** so confirmation and password-reset emails can reach ordinary app users. Supabase's default sender is restricted to project-team addresses and has tight limits; it is unsuitable for signups from arbitrary friends. Keep SMTP credentials in Supabase's settings.

These settings are project-wide. This SQL does not change them. Google login can be configured later; it is not required for the initial email/password version.

## 4. Share the connection details

In the project's **Connect** dialog, copy:

```text
Project URL: https://YOUR_PROJECT_REF.supabase.co
Publishable API key: sb_publishable_...
```

Send those two values to the RailPulse developer. No database password, personal login, secret key or `service_role` key is needed for ordinary user login and saved-item access. The app must use the signed-in user's session with the publishable key so the ownership policies apply.

## App integration contract

These are database field mappings for the later app work, not frontend code already installed:

- **Users:** link to `auth.users.id`; `user_id` defaults to `auth.uid()` on inserts. Query through the user's session. Only `user_id` and the verified Auth identity decide ownership; display names and user metadata do not grant permissions.
- **Profiles/preferences:** one row per user. Create lazily after sign-in; retain an existing row. Use defaults when a row is missing. Default preferences are Train & bus, fastest, wheelchair access off, an eight-minute wheelchair transfer allowance, and light theme.
- **Saved places:** an individual location, separate from a complete saved journey. `category` is `home`, `work` or `other`; one Home and one Work are allowed per user, with multiple custom places such as School or Gym. `label` is the user's name for the place (1–80 characters). `location_type` is `address`, `station` or `bus_stop`. An address requires `address` text and both `latitude`/`longitude`, with `source_id = null`; source these from the selected search result/map pin. A station requires its `station.id` in `source_id`; a bus stop requires its five-digit code. Coordinates are optional for station/stop shortcuts but must be supplied together. Coordinate ranges validate shape, not the accuracy of a geocoder result or the safety/accessibility of a path.
- **Home/Work updates:** fetch the current user's places after sign-in, put Home and Work first, and edit existing rows by `id` rather than inserting another shortcut. Their uniqueness uses a partial index, so a plain client `.upsert(..., { onConflict: 'user_id,category' })` is not the integration contract. If another device creates the shortcut concurrently, handle the duplicate response by refetching and offering to edit the existing location. Selecting a saved place must still respect the current journey mode and wheelchair requirements; station-to-bus-stop or address-to-transit matching must be resolved, not assumed.
- **Modes:** `train` = Train & bus, `train-only` = Train only, `bus` = Bus only. Preferences: `fastest`, `walking`, `transfers`. Match the existing UI's mode restrictions when loading preferences (`walking` is unavailable for Train only; `transfers` is unavailable for Bus only).
- **Routes:** store `station.id` from `/api/network` for train modes, or five-digit `BusStopCode` strings for buses. Example train IDs: `EW24` (Jurong East) and `EW23` (Clementi). Use source IDs, not names or interchangeable display codes. One bookmark per user/mode/origin/destination; it can be renamed. Apply the user's current travel/accessibility preferences when reopening it.
- **Bus favourites:** store LTA's exact `ServiceNo` and a five-digit stop code as strings. Keep lowercase suffixes as provided. One favourite per user/service/stop. `direction` is `1`, `2`, or `null` for no direction filter; do not invent a direction from the arrival feed. A direction preference should be matched against current BusRoutes data when needed.
- **Fresh data:** revalidate stations, stops, services and availability through the existing API each time a bookmark is opened. These tables validate identifier shape, not whether LTA currently operates the service. Keep ETA, crowd and lift readings out of bookmarks and request current data instead.
- **Deletes:** removing a saved place does not remove route bookmarks, and removing a bookmark does not delete an Auth account. Deleting an Auth user through the appropriate administrator flow cascades to their five RailPulse tables. This SQL does not add a client-accessible account-deletion endpoint.
- **No extra services required:** Storage buckets, Realtime publications and Edge Functions are not needed for these saved-item tables.

## Local validation for developers

Both installation paths passed in an isolated PostgreSQL 18.3 engine (PGlite 0.5.8): **132 checks for a fresh setup, 136 for an upgrade**. The checks cover installing the exact SQL, all five tables' ownership rules for every CRUD operation, anonymous access, forged ownership, grants, timestamps, Home/Work uniqueness, location constraints, account-deletion cascades and safe failure on rerun. Upgrade validation also verifies existing saved data survives adding the fifth table. Existing unrelated tables are left intact.

This validation simulated Supabase Auth user IDs and session claims. It did not connect to a hosted project or test email delivery, Auth callbacks or the Data API. Run the read-only verification on the actual project after your friend applies the script, and test two real app accounts after integration.

To repeat the isolated validation from the repository root:

```sh
npm install --prefix .cache/supabase-sql-check --save-exact --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.5.8
node supabase/validate-local.cjs
node supabase/validate-local.cjs --upgrade
```

The temporary dependency and reports stay under ignored `.cache/`; the app's runtime dependencies are unchanged. Your friend needs the applicable installation SQL, verification SQL and this guide, not the local validation tool. The ZIP includes both installation options with instructions to choose one.

## Sources

- [Supabase Auth user data](https://supabase.com/docs/guides/auth/managing-user-data)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Data API permissions](https://supabase.com/docs/guides/api/securing-your-api)
- [Email/password login](https://supabase.com/docs/guides/auth/passwords)
- [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Custom SMTP requirements](https://supabase.com/docs/guides/auth/auth-smtp)
- [Project URL and publishable keys](https://supabase.com/docs/guides/getting-started/api-keys)
