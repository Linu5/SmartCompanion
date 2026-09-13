-- Upgrade ONLY an existing five-table RailPulse installation.
-- Fresh projects: run railpulse-setup.sql instead, not both files.
begin;
alter table public.railpulse_preferences add column settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object' and octet_length(settings::text) <= 4096), add column watched_lines text[] not null default '{}'::text[] check (watched_lines <@ array['NSL','EWL','CGL','NEL','CCL','DTL','TEL','BPL','SLRT','PLRT']::text[]);
alter table public.railpulse_saved_routes add column journey jsonb not null default '{}'::jsonb check (jsonb_typeof(journey) = 'object' and octet_length(journey::text) <= 8192), add column alert_lines text[] not null default '{}'::text[] check (alert_lines <@ array['NSL','EWL','CGL','NEL','CCL','DTL','TEL','BPL','SLRT','PLRT']::text[]);
create table public.railpulse_push_subscriptions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    endpoint text not null check (length(endpoint) between 10 and 2048 and endpoint like 'https://%'),
    subscription jsonb not null check (jsonb_typeof(subscription) = 'object' and octet_length(subscription::text) <= 8192),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique(user_id, endpoint)
);
create index railpulse_push_subscriptions_user on public.railpulse_push_subscriptions(user_id);
grant select on public.railpulse_saved_routes, public.railpulse_preferences to service_role;
grant select, delete on public.railpulse_push_subscriptions to service_role;

-- Delivery claims and scheduler status are backend-only. No client policies.
create table public.railpulse_notification_deliveries (
    subscription_id uuid not null references public.railpulse_push_subscriptions(id) on delete cascade,
    event_hash text not null check (length(event_hash) = 64),
    state text not null default 'pending' check (state in ('pending','sent')),
    claimed_at timestamptz not null default now(),
    primary key(subscription_id, event_hash)
);
create table public.railpulse_notification_status (
    id boolean primary key default true check (id),
    checked_at timestamptz not null default now()
);
alter table public.railpulse_notification_deliveries enable row level security;
alter table public.railpulse_notification_status enable row level security;
revoke all on public.railpulse_notification_deliveries, public.railpulse_notification_status from public, anon, authenticated;
grant all on public.railpulse_notification_deliveries, public.railpulse_notification_status to service_role;


do $$
declare
    table_name text;
begin
    foreach table_name in array array['railpulse_push_subscriptions'] loop
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


commit;
