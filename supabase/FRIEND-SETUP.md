# RailPulse setup in your friend's project

The app uses `kpzjvmsyzhmnhcbwgcty`. Its public publishable key is already connected. Your friend keeps ownership; you do not need their password or your own Supabase project.

## 1. Create the tables

In that project's **SQL Editor**, paste the entire `supabase/railpulse-setup.sql` file and run it **once**. It creates six private user tables and two backend-only notification tables. All tables have row level security. It does not edit unrelated tables or create login users.

Then run `supabase/verify-setup.sql`. Expect six user-table rows with every check true, 24 owner policies, and two backend-table rows with RLS and client access blocked.

If you already installed the previous five-table RailPulse schema, use `supabase/migrations/20260913025956_companion_features.sql` **instead of** the initial setup. Do not run both. If neither version matches your existing schema, ask for an upgrade rather than dropping tables.

## 2. Configure email sign-in

In **Authentication → URL Configuration**, add these exact allowed redirect URLs:

```text
https://smart-companion-nine.vercel.app/
https://smart-companion-nine.vercel.app/?account=recovery
http://localhost:3000/
http://localhost:3000/?account=recovery
```

For a project dedicated to RailPulse, set Site URL to `https://smart-companion-nine.vercel.app/`. If this project serves another app, preserve that app's existing Site URL and redirects; RailPulse explicitly sends its own redirect URL.

Keep Email sign-in and email confirmation enabled. Configure **custom SMTP** for confirmation and password reset emails to reach ordinary users. Supabase's default mail service restricts recipients to project-team addresses. Do not disable confirmation to work around email delivery.

At this point, email/password sign-in, Home/Work/custom places, saved routes, favourite buses, synced preferences and in-app personal service alerts can work. Users can still check transport without logging in.

## 3. Optional: notifications while the app is closed

The service worker and notification backend are implemented, but closed-app delivery stays disabled until a server is configured and a scheduler has recently run successfully. GPS stop reminders are separate: they work only while the app is open.

Create Web Push keys on a trusted developer machine:

```powershell
node scripts/create-push-config.cjs
```

This writes an ignored `.env.push` file. Keep its private key and cron secret private. In **Vercel → RailPulse → Settings → Environment Variables**, add its four variables plus:

```text
SUPABASE_SECRET_KEY=<the project's backend secret key, or legacy service_role key>
```

Use the project's **backend** key here only. It is not the publishable key. Enter it directly in Vercel; do not send it in chat, put it in client code, or commit it. Redeploy after changing environment variables.

Run a scheduler every five minutes that sends an authenticated **POST** to:

```text
https://smart-companion-nine.vercel.app/api/notifications/check
Authorization: Bearer <CRON_SECRET from .env.push>
```

One option is Supabase Cron (`pg_cron`) with `pg_net`; both can be enabled in the Database extensions screen. Store the cron secret in Supabase Vault, and use the setup below in SQL Editor **only after replacing the placeholder with the actual secret privately**:

```sql
-- Run once; do not duplicate an existing job or Vault secret.
select vault.create_secret('REPLACE_PRIVATELY_WITH_CRON_SECRET', 'railpulse_cron_secret', 'RailPulse notification job');
select cron.schedule(
  'railpulse-commute-alerts',
  '*/5 * * * *',
  $$select net.http_post(
    url := 'https://smart-companion-nine.vercel.app/api/notifications/check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'railpulse_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );$$
);
```

Verify the job's HTTP result in `net._http_response` and the timestamp in `public.railpulse_notification_status`. The app only offers background subscriptions after a successful check in the last 15 minutes. Run an authenticated manual POST once if needed to validate the setup before waiting for the schedule.

Users then sign in, save a train route or select watched lines in **Saved**, and opt into notifications on each device. On iPhone/iPad, install RailPulse using **Share → Add to Home Screen**, open that installation, and enable notifications there. Delivery depends on browser permission, connectivity and the scheduler. Notifications are personalised by watched train line, not an exact prediction of whether the user's journey will be delayed. Identical segment alerts are deduplicated per subscription per Singapore day; expired subscriptions are removed. Push services can occasionally redeliver after a failed receipt, so notifications also use a stable replacement tag.

To stop the scheduler: `select cron.unschedule('railpulse-commute-alerts');`. Remove its Vault secret only when the job has stopped.

## Validation

Both a fresh setup and the previous five-table upgrade passed 154 local PostgreSQL checks, including two-user isolation, anonymous denial, backend-only delivery access, constraints and account-deletion cascades. These checks use isolated synthetic Auth fixtures. Hosted sign-in, confirmation/reset emails and actual push delivery still need verification after the owner performs this setup.

References: [Supabase password auth](https://supabase.com/docs/guides/auth/passwords), [email delivery](https://supabase.com/docs/guides/auth/auth-smtp), [Supabase Cron](https://supabase.com/docs/guides/cron), [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net), [Vault](https://supabase.com/docs/guides/database/vault), [iOS Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
