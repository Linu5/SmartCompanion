-- RailPulse: initial Supabase setup for saved places, routes, buses and preferences.
-- Paste this ENTIRE file into your Supabase project's SQL Editor and run once.
-- Supabase Auth already supplies auth.users, auth.uid(), anon and authenticated.
-- This creates only railpulse_* objects. It does not create login accounts.
-- If a RailPulse table/function already exists, the transaction fails rather
-- than replacing it. Do not drop existing tables to make this script rerun.

begin;

create table public.railpulse_profiles (
    user_id uuid primary key default auth.uid()
        references auth.users(id) on delete cascade,
    display_name text not null default ''
        check (char_length(display_name) <= 80),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.railpulse_preferences (
    user_id uuid primary key default auth.uid()
        references auth.users(id) on delete cascade,
    -- These values match the existing /api/journey interface.
    -- 'train' means Train & bus; 'train-only' means Train only.
    preferred_mode text not null default 'train'
        check (preferred_mode in ('train', 'train-only', 'bus')),
    preference text not null default 'fastest'
        check (preference in ('fastest', 'walking', 'transfers')),
    wheelchair_access boolean not null default false,
    -- Applied when wheelchair access is enabled; ordinary transfers use 4 min.
    transfer_minutes smallint not null default 8
        check (transfer_minutes between 4 and 30),
    theme text not null default 'light'
        check (theme in ('light', 'dark')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.railpulse_saved_routes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid()
        references auth.users(id) on delete cascade,
    name text not null
        check (char_length(btrim(name)) between 1 and 80 and char_length(name) <= 80),
    mode text not null default 'train'
        check (mode in ('train', 'train-only', 'bus')),
    -- For trains, store station.id from /api/network, not its display name.
    -- For buses, store the five-digit BusStopCode as TEXT (preserves 01012).
    origin_id text not null
        check (char_length(origin_id) between 1 and 64 and origin_id = btrim(origin_id)),
    destination_id text not null
        check (char_length(destination_id) between 1 and 64 and destination_id = btrim(destination_id)),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint railpulse_route_distinct_endpoints check (origin_id <> destination_id),
    constraint railpulse_route_bus_codes check (
        mode <> 'bus' or (origin_id ~ '^[0-9]{5}$' and destination_id ~ '^[0-9]{5}$')
    ),
    constraint railpulse_saved_route_unique unique (user_id, mode, origin_id, destination_id)
);

create table public.railpulse_favourite_buses (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid()
        references auth.users(id) on delete cascade,
    -- Preserve LTA's original spelling, e.g. 99 or 12e.
    service_no text not null
        check (service_no ~ '^[A-Za-z0-9]{1,12}$'),
    bus_stop_code text not null
        check (bus_stop_code ~ '^[0-9]{5}$'),
    -- NULL means no direction preference. Only save 1 or 2 when LTA supplies it.
    direction smallint check (direction in (1, 2)),
    label text check (char_length(btrim(label)) between 1 and 80 and char_length(label) <= 80),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint railpulse_favourite_bus_unique unique (user_id, service_no, bus_stop_code)
);

create index railpulse_saved_routes_recent on public.railpulse_saved_routes (user_id, created_at desc);
create index railpulse_favourite_buses_recent on public.railpulse_favourite_buses (user_id, created_at desc);

create table public.railpulse_saved_places (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid()
        references auth.users(id) on delete cascade,
    label text not null
        check (char_length(btrim(label)) between 1 and 80 and char_length(label) <= 80),
    category text not null default 'other'
        check (category in ('home', 'work', 'other')),
    location_type text not null
        check (location_type in ('address', 'station', 'bus_stop')),
    -- Source ID is station.id or the five-digit BusStopCode, never a place label.
    source_id text check (
        char_length(source_id) between 1 and 64 and source_id = btrim(source_id)
    ),
    address text check (char_length(btrim(address)) between 1 and 500 and char_length(address) <= 500),
    latitude double precision check (latitude between -90 and 90),
    longitude double precision check (longitude between -180 and 180),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint railpulse_place_coordinate_pair check (
        (latitude is null) = (longitude is null)
    ),
    constraint railpulse_place_location check (
        (location_type = 'address' and source_id is null
            and address is not null and latitude is not null and longitude is not null)
        or (location_type = 'station' and source_id is not null)
        or (location_type = 'bus_stop' and source_id is not null and source_id ~ '^[0-9]{5}$')
    )
);

-- One Home and one Work per user; any number of other named places.
create unique index railpulse_saved_places_shortcut
    on public.railpulse_saved_places (user_id, category)
    where category in ('home', 'work');
create index railpulse_saved_places_recent
    on public.railpulse_saved_places (user_id, created_at desc);

-- Runs with the calling user's permissions. No privileged signup trigger is
-- installed on auth.users, and no user metadata is used for authorization.
create function public.railpulse_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    new.created_at := old.created_at;
    new.updated_at := pg_catalog.now();
    return new;
end;
$$;

-- Schema usage allows reaching tables, not creating arbitrary objects.
grant usage on schema public to authenticated;

do $$
declare
    table_name text;
begin
    foreach table_name in array array[
        'railpulse_profiles',
        'railpulse_preferences',
        'railpulse_saved_routes',
        'railpulse_favourite_buses',
        'railpulse_saved_places'
    ] loop
        execute format('alter table public.%I enable row level security', table_name);

        -- Remove default broad grants, including TRUNCATE, which bypasses RLS.
        execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
        execute format('grant select, insert, update, delete on table public.%I to authenticated', table_name);

        execute format(
            'create policy railpulse_select_own on public.%I for select to authenticated using ((select auth.uid()) = user_id)', table_name
        );
        execute format(
            'create policy railpulse_insert_own on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', table_name
        );
        execute format(
            'create policy railpulse_update_own on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', table_name
        );
        execute format(
            'create policy railpulse_delete_own on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', table_name
        );
        execute format(
            'create trigger railpulse_updated_at before update on public.%I for each row execute function public.railpulse_touch_updated_at()', table_name
        );
    end loop;
end;
$$;

-- The function is only for the triggers above, not for client RPC calls.
revoke all on function public.railpulse_touch_updated_at() from public, anon, authenticated;

comment on table public.railpulse_profiles is 'Private optional display name; login credentials live in Supabase Auth.';
comment on table public.railpulse_preferences is 'One optional preferences row per user; create lazily after sign-in.';
comment on table public.railpulse_saved_routes is 'Route bookmarks. Replan against current LTA data when opened; do not store live ETA/crowd snapshots.';
comment on table public.railpulse_favourite_buses is 'Favourite service at a boarding stop, with optional direction preference.';
comment on table public.railpulse_saved_places is 'Private Home, Work and custom shortcuts. Address locations need geocoding and routing integration in the app.';

commit;

-- These five empty tables are ready for application integration.
select tablename, rowsecurity as rls_enabled
from pg_catalog.pg_tables
where schemaname = 'public'
  and tablename in ('railpulse_profiles', 'railpulse_preferences', 'railpulse_saved_routes', 'railpulse_favourite_buses', 'railpulse_saved_places')
order by tablename;
