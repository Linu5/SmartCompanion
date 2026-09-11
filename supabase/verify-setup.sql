-- Read-only checks: paste into Supabase SQL Editor AFTER railpulse-setup.sql.
-- This does not create users, read saved routes, or modify data.
-- Expect exactly 5 rows, with every check column TRUE.

with expected(table_name) as (
    values ('railpulse_profiles'), ('railpulse_preferences'),
           ('railpulse_saved_routes'), ('railpulse_favourite_buses'), ('railpulse_saved_places')
)
select
    expected.table_name,
    coalesce(c.relrowsecurity, false) as rls_enabled,
    (select count(*) = 4 from pg_catalog.pg_policies p
     where p.schemaname = 'public' and p.tablename = expected.table_name
       and p.roles = array['authenticated']::name[]
       and p.policyname in ('railpulse_select_own', 'railpulse_insert_own', 'railpulse_update_own', 'railpulse_delete_own')) as four_owner_policies,
    coalesce(pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT')
         and pg_catalog.has_table_privilege('authenticated', c.oid, 'INSERT')
         and pg_catalog.has_table_privilege('authenticated', c.oid, 'UPDATE')
         and pg_catalog.has_table_privilege('authenticated', c.oid, 'DELETE'), false) as signed_in_crud,
    coalesce(not pg_catalog.has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), false) as signed_out_blocked,
    coalesce(not pg_catalog.has_table_privilege('authenticated', c.oid, 'TRUNCATE,REFERENCES,TRIGGER'), false) as elevated_client_access_blocked,
    exists (select 1 from pg_catalog.pg_constraint k
            where k.conrelid = c.oid and k.contype = 'f'
              and k.confrelid = 'auth.users'::regclass and k.confdeltype = 'c') as auth_user_cascade,
    exists (select 1 from pg_catalog.pg_trigger t
            where t.tgrelid = c.oid and t.tgname = 'railpulse_updated_at' and not t.tgisinternal) as timestamp_trigger
from expected
left join pg_catalog.pg_class c on c.oid = pg_catalog.to_regclass('public.' || expected.table_name)
order by expected.table_name;

-- Also expect TRUE in both columns below.
select
    not p.prosecdef as timestamp_function_is_not_privileged,
    not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
        and not pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') as client_rpc_blocked
from pg_catalog.pg_proc p
where p.oid = pg_catalog.to_regprocedure('public.railpulse_touch_updated_at()');

-- Inspect the actual ownership predicates. There should be 20 policy rows.
select tablename, policyname, cmd, roles, qual, with_check
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename in ('railpulse_profiles', 'railpulse_preferences', 'railpulse_saved_routes', 'railpulse_favourite_buses', 'railpulse_saved_places')
order by tablename, policyname;
