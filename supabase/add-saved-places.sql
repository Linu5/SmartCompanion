-- ONLY for a project that already ran the older four-table RailPulse setup.
-- If starting fresh, run railpulse-setup.sql INSTEAD; it includes saved places.
-- Run this entire file once in SQL Editor. It preserves existing user data.

begin;

-- Require the existing setup. Do not replace its timestamp function or tables.
do $$
begin
    if pg_catalog.to_regprocedure('public.railpulse_touch_updated_at()') is null
        or pg_catalog.to_regclass('public.railpulse_profiles') is null
        or pg_catalog.to_regclass('public.railpulse_preferences') is null
        or pg_catalog.to_regclass('public.railpulse_saved_routes') is null
        or pg_catalog.to_regclass('public.railpulse_favourite_buses') is null then
        raise exception 'The original RailPulse setup is missing. Use railpulse-setup.sql for a fresh installation.';
    end if;
end;
$$;

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

alter table public.railpulse_saved_places enable row level security;
grant usage on schema public to authenticated;
revoke all on table public.railpulse_saved_places from public, anon, authenticated;
grant select, insert, update, delete on table public.railpulse_saved_places to authenticated;

create policy railpulse_select_own on public.railpulse_saved_places
    for select to authenticated using ((select auth.uid()) = user_id);
create policy railpulse_insert_own on public.railpulse_saved_places
    for insert to authenticated with check ((select auth.uid()) = user_id);
create policy railpulse_update_own on public.railpulse_saved_places
    for update to authenticated using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);
create policy railpulse_delete_own on public.railpulse_saved_places
    for delete to authenticated using ((select auth.uid()) = user_id);

create trigger railpulse_updated_at before update on public.railpulse_saved_places
    for each row execute function public.railpulse_touch_updated_at();

comment on table public.railpulse_saved_places is 'Private Home, Work and custom shortcuts. Address locations need geocoding and routing integration in the app.';

commit;

-- Then run verify-setup.sql to check all FIVE tables and their policies.
select tablename, rowsecurity as rls_enabled
from pg_catalog.pg_tables
where schemaname = 'public' and tablename = 'railpulse_saved_places';
