const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');
const lta = require('./lta');
const project = require('../public/project-config.json');
const supported = new Set(['NSL','EWL','CGL','NEL','CCL','DTL','TEL','BPL','SLRT','PLRT']);
const normalLine = line => line === 'CEL' ? 'CCL' : line;
function configured(env = process.env) { return !!(env.SUPABASE_SECRET_KEY && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT && env.CRON_SECRET); }
function authorised(header, secret) {
    if (!secret || typeof header !== 'string' || header.length > 1000) return false;
    const supplied = Buffer.from(header), expected = Buffer.from(`Bearer ${secret}`);
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}
function validSubscription(subscription) {
    try {
        const url = new URL(subscription.endpoint);
        const allowed = url.hostname === 'fcm.googleapis.com' || url.hostname === 'web.push.apple.com' || url.hostname.endsWith('.push.apple.com') || url.hostname === 'updates.push.services.mozilla.com' || url.hostname.endsWith('.notify.windows.com');
        if (!allowed || url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password || subscription.endpoint.length >= 2048 || !/^[A-Za-z0-9_-]{87}$/.test(subscription.keys?.p256dh || '') || !/^[A-Za-z0-9_-]{22}$/.test(subscription.keys?.auth || '')) return false;
        const key = Buffer.from(subscription.keys.p256dh, 'base64url');
        if (key.length !== 65 || key[0] !== 4 || Buffer.from(subscription.keys.auth, 'base64url').length !== 16) return false;
        crypto.ECDH.convertKey(key, 'prime256v1');
        return true;
    } catch { return false; }
}
function eventFor(alert, watched, now = new Date()) {
    if (Number(alert?.Status) !== 2) return null;
    const lines = new Set(watched.map(normalLine).filter(line => supported.has(line)));
    const segments = (alert.AffectedSegments || []).filter(segment => lines.has(normalLine(segment.Line)) || segment.Line === 'EWL' && lines.has('CGL'));
    if (!segments.length) return null; // Unattributed network alerts are shown in the app, never guessed as personalised.
    const affected = [...new Set(segments.map(s => normalLine(s.Line)))].sort();
    const summary = segments.map(s => `${normalLine(s.Line)}: ${String(s.Stations || 'check service advisories').slice(0, 200)}`).sort().join('; ');
    const day = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
    const eventHash = crypto.createHash('sha256').update(`${day}:${summary}`).digest('hex');
    return { eventHash, payload: { body: `Disruption reported on your ${affected.join(', ')} commute. ${summary}. Open RailPulse to check alternatives.`, tag: `railpulse-${eventHash.slice(0, 24)}` } };
}
let client;
function admin() {
    if (!configured()) return null;
    if (!client) client = createClient(project.url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    return client;
}
async function publicStatus() {
    const db = admin();
    if (!db) return { ready: false, publicKey: null, checkedAt: null };
    const { data, error } = await db.from('railpulse_notification_status').select('checked_at').eq('id', true).maybeSingle();
    const recent = !error && data && Date.now() - Date.parse(data.checked_at) < 15 * 60000;
    return { ready: !!recent, publicKey: recent ? process.env.VAPID_PUBLIC_KEY : null, checkedAt: data?.checked_at || null };
}
async function rows(db, table, select) {
    const collected = [];
    for (let offset = 0; offset <= 10000; offset += 500) {
        const { data, error } = await db.from(table).select(select).order(table === 'railpulse_preferences' ? 'user_id' : 'id').range(offset, offset + 499);
        if (error) throw new Error('Notification database unavailable');
        collected.push(...data); if (data.length < 500) return collected;
    }
    throw new Error('Notification batch exceeds supported size');
}
async function claim(db, subscriptionId, hash, at) {
    const record = { subscription_id: subscriptionId, event_hash: hash, claimed_at: at, state: 'pending' };
    const inserted = await db.from('railpulse_notification_deliveries').upsert(record, { onConflict: 'subscription_id,event_hash', ignoreDuplicates: true }).select('claimed_at');
    if (inserted.error) throw new Error('Notification claim unavailable');
    if (inserted.data.length) return true;
    const existing = await db.from('railpulse_notification_deliveries').select('state,claimed_at').eq('subscription_id', subscriptionId).eq('event_hash', hash).single();
    if (existing.error || existing.data.state === 'sent' || Date.parse(at) - Date.parse(existing.data.claimed_at) < 10 * 60000) return false;
    const lease = await db.from('railpulse_notification_deliveries').update({ claimed_at: at }).eq('subscription_id', subscriptionId).eq('event_hash', hash).eq('state', 'pending').eq('claimed_at', existing.data.claimed_at).select('claimed_at');
    if (lease.error) throw new Error('Notification lease unavailable');
    return lease.data.length === 1;
}
async function check() {
    const db = admin(); if (!db) throw new Error('Notification delivery is not configured');
    const feed = await lta.alerts(); if (feed.stale) throw new Error('Fresh service alerts unavailable');
    const [subscriptions, preferences, routes] = await Promise.all([rows(db, 'railpulse_push_subscriptions', 'id,user_id,endpoint,subscription'), rows(db, 'railpulse_preferences', 'user_id,watched_lines'), rows(db, 'railpulse_saved_routes', 'id,user_id,alert_lines')]);
    const watched = new Map(preferences.map(row => [row.user_id, row.watched_lines || []]));
    for (const route of routes) watched.set(route.user_id, [...(watched.get(route.user_id) || []), ...(route.alert_lines || [])]);
    webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    let sent = 0, failed = 0;
    for (let index = 0; index < subscriptions.length; index += 5) await Promise.all(subscriptions.slice(index, index + 5).map(async subscription => {
        if (!validSubscription(subscription.subscription) || subscription.endpoint !== subscription.subscription.endpoint) return;
        const event = eventFor(feed.data.value, watched.get(subscription.user_id) || []); if (!event) return;
        const at = new Date().toISOString(); if (!await claim(db, subscription.id, event.eventHash, at)) return;
        try {
            await webpush.sendNotification(subscription.subscription, JSON.stringify(event.payload), { TTL: 300, timeout: 8000 });
            const updated = await db.from('railpulse_notification_deliveries').update({ state: 'sent' }).eq('subscription_id', subscription.id).eq('event_hash', event.eventHash).eq('claimed_at', at);
            if (updated.error) throw new Error('Delivery receipt could not be stored');
            sent++;
        } catch (error) {
            failed++;
            if (error.statusCode === 404 || error.statusCode === 410) await db.from('railpulse_push_subscriptions').delete().eq('id', subscription.id);
            else await db.from('railpulse_notification_deliveries').delete().eq('subscription_id', subscription.id).eq('event_hash', event.eventHash).eq('claimed_at', at).eq('state', 'pending');
        }
    }));
    if (failed) throw new Error('Some device notifications could not be delivered');
    const status = await db.from('railpulse_notification_status').upsert({ id: true, checked_at: new Date().toISOString() });
    if (status.error) throw new Error('Notification status could not be stored');
    await db.from('railpulse_notification_deliveries').delete().lt('claimed_at', new Date(Date.now() - 7 * 86400000).toISOString());
    return { checked: true, sent };
}
module.exports = { configured, authorised, validSubscription, eventFor, claim, publicStatus, check };
