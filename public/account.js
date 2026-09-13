let accountClient = null, accountUser = null, accountVersion = 0, authMode = 'signin', saveContext = null, accountBusy = false;
let savedPlaces = [], savedRoutes = [], favouriteBuses = [], watchedLines = [], savePreferences = null, savedLoadVersion = 0;
const lineChoices = ['NSL', 'EWL', 'CGL', 'NEL', 'CCL', 'DTL', 'TEL', 'BPL', 'SLRT', 'PLRT'];
function accountError(error) {
    if (error?.code === 'PGRST205' || error?.code === '42703') return 'Saved items are still being set up. Please try again after the app owner finishes the database setup.';
    if (error?.code === '23505') return 'That item is already saved. Edit it in Saved instead.';
    if (/fetch|network/i.test(error?.message || '')) return 'Could not connect. Check your internet connection and try again.';
    return error?.message || 'That change could not be saved. Please try again.';
}
function requireAccount() {
    if (accountUser) return true;
    authMode = 'signin'; renderAuth(); openDialog('auth-dialog');
    $('auth-status').textContent = accountClient ? 'Sign in to save your favourites across devices.' : 'Sign-in is temporarily unavailable. You can still plan journeys.';
    return false;
}
function renderAuth() {
    const recovery = authMode === 'recovery';
    $('auth-title').textContent = recovery ? 'Choose a new password.' : authMode === 'signup' ? 'Make it your commute.' : 'Your commute, saved.';
    $('auth-email').disabled = recovery; $('auth-email').required = !recovery;
    $('auth-password').autocomplete = authMode === 'signin' ? 'current-password' : 'new-password';
    $('auth-submit').textContent = recovery ? 'Update password' : authMode === 'signup' ? 'Create account' : 'Sign in';
    $('auth-switch').textContent = authMode === 'signup' ? 'I already have an account' : 'Create an account';
    $('auth-switch').classList.toggle('hidden', recovery); $('auth-reset').classList.toggle('hidden', recovery);
    $('auth-status').textContent = ''; $('auth-password').value = '';
}
function renderSaved() {
    $('home-caption').textContent = savedPlaces.find(p => p.category === 'home')?.label || 'Add your place';
    $('work-caption').textContent = savedPlaces.find(p => p.category === 'work')?.label || 'Add your place';
    if (!accountUser) {
        $('account-summary').innerHTML = '<div class="account-card"><strong>Your everyday journeys, together.</strong><p class="small muted">Sign in to save Home, Work, routes and favourite buses across devices.</p><button type="button" class="primary" data-signin>Sign in / create account</button></div>';
        $('saved-content').innerHTML = '<p class="saved-empty">You can plan journeys and check live arrivals without signing in.</p><div class="install-card"><strong>Keep RailPulse close.</strong><p>Add this website to your home screen from your browser menu. On iPhone, use Share → Add to Home Screen.</p></div>';
        return;
    }
    $('account-summary').innerHTML = `<div class="account-card"><strong>You’re signed in</strong><p class="small muted">${escapeHtml(accountUser.email || '')}</p><button class="secondary" type="button" id="signout">Sign out</button></div>`;
    const remove = (kind, id, name) => `<button type="button" class="icon-action" data-delete-kind="${kind}" data-delete-id="${escapeHtml(id)}" aria-label="Remove ${escapeHtml(name)}">×</button>`;
    $('saved-content').innerHTML = `<div class="saved-heading"><h2>My places</h2><button type="button" class="text-button" data-add-place>Add place +</button></div>${savedPlaces.length ? savedPlaces.map(place => `<div class="saved-item"><button class="saved-use" type="button" data-use-place="${escapeHtml(place.id)}"><strong>${place.category === 'home' ? '⌂ ' : place.category === 'work' ? '▣ ' : '♡ '}${escapeHtml(place.label)}</strong><small>${escapeHtml(place.address || place.source_id || '')}</small></button><button type="button" class="icon-action" data-edit-place="${escapeHtml(place.id)}" aria-label="Edit ${escapeHtml(place.label)}">✎</button>${remove('places', place.id, place.label)}</div>`).join('') : '<p class="saved-empty">Add Home, Work or a place you visit often. Tap a saved place to set your destination.</p>'}<h2>Saved routes</h2>${savedRoutes.length ? savedRoutes.map(route => `<div class="saved-item"><button class="saved-use" type="button" data-use-route="${escapeHtml(route.id)}"><strong>${escapeHtml(route.name)}</strong><small>${escapeHtml(route.journey?.originName || route.origin_id)} → ${escapeHtml(route.journey?.destinationName || route.destination_id)}</small></button>${remove('routes', route.id, route.name)}</div>`).join('') : '<p class="saved-empty">Plan a journey, then tap “Save route”. Live arrivals are refreshed when you open it.</p>'}<h2>Favourite buses</h2>${favouriteBuses.length ? favouriteBuses.map(bus => `<div class="saved-item"><button class="saved-use" type="button" data-open-arrivals="${escapeHtml(bus.bus_stop_code)}"><strong>Bus ${escapeHtml(bus.service_no)}</strong><small>${escapeHtml(bus.label || `Stop ${bus.bus_stop_code}`)}</small></button>${remove('buses', bus.id, `bus ${bus.service_no}`)}</div>`).join('') : '<p class="saved-empty">Tap the heart beside a bus in the Buses tab to save it.</p>'}<section class="saved-notifications"><h2>My commute alerts</h2><p class="small muted">Choose the train lines you use. We’ll highlight relevant disruptions here, and send device notifications when delivery is enabled.</p><div class="watch-list">${lineChoices.map(line => `<label class="checkbox-label"><input type="checkbox" name="watch-line" value="${line}" ${watchedLines.includes(line) ? 'checked' : ''}>${line}</label>`).join('')}</div><button id="save-watch-lines" class="secondary" type="button">Save watched lines</button><div id="personal-alerts" role="status"></div><button id="push-enable" type="button" class="secondary nearby-entry">Enable device notifications</button><button id="push-disable" type="button" class="text-button">Turn off on this device</button><p id="push-status" class="small muted">Checking background notification availability…</p></section><h2>My preferences</h2><button id="save-cloud-preferences" class="secondary" type="button">Save current journey preferences</button><p class="small muted">Keep your walking, transfer and accessibility settings with your account.</p><div class="install-card"><strong>Use RailPulse like an app.</strong><p>Add it to your home screen. iPhone notifications require a Home Screen installation and permission.</p></div>`;
    checkPushStatus(); refreshPersonalAlerts();
}
async function loadSaved(version = accountVersion) {
    if (!accountClient || !accountUser) return;
    const loadVersion = ++savedLoadVersion;
    const userId = accountUser.id;
    $('saved-status').textContent = 'Loading your saved items…';
    const results = await Promise.all([
        accountClient.from('railpulse_saved_places').select('*').eq('user_id', userId).order('created_at'),
        accountClient.from('railpulse_saved_routes').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
        accountClient.from('railpulse_favourite_buses').select('*').eq('user_id', userId).order('created_at'),
        accountClient.from('railpulse_preferences').select('*').eq('user_id', userId).maybeSingle()
    ]);
    if (version !== accountVersion || loadVersion !== savedLoadVersion || accountUser?.id !== userId) return;
    const error = results.find(result => result.error)?.error;
    if (error) { savedPlaces = []; savedRoutes = []; favouriteBuses = []; watchedLines = []; renderSaved(); $('saved-status').textContent = accountError(error); return; }
    [savedPlaces, savedRoutes, favouriteBuses] = results.slice(0, 3).map(result => result.data || []);
    savePreferences = results[3].data; watchedLines = savePreferences?.watched_lines || [];
    renderSaved(); $('saved-status').textContent = 'Synced with your account.';
}
async function handleSession(session, event) {
    const version = ++accountVersion, oldId = accountUser?.id;
    accountUser = null; savedPlaces = []; savedRoutes = []; favouriteBuses = []; watchedLines = []; saveContext = null; renderSaved();
    if (event === 'SIGNED_OUT' || (oldId && oldId !== session?.user?.id)) { clearJourney(); $('save-dialog').close(); await unsubscribeBrowser(); }
    if (!session) { $('saved-status').textContent = ''; return; }
    const { data, error } = await accountClient.auth.getUser();
    if (version !== accountVersion) return;
    if (error || !data.user) { $('saved-status').textContent = 'Sign-in could not be verified. Connect to the internet and sign in again.'; return; }
    accountUser = data.user; renderSaved();
    if (event === 'PASSWORD_RECOVERY') { authMode = 'recovery'; renderAuth(); openDialog('auth-dialog'); }
    else if ($('auth-dialog').open && authMode !== 'recovery') $('auth-dialog').close();
    await loadSaved(version);
    if (version === accountVersion && savePreferences?.settings && Object.keys(savePreferences.settings).length) { invalidateMixed(); applyStoredSettings(savePreferences.settings); syncMixed(); }
}
async function initialiseAccount() {
    try {
        const config = await api('/project-config.json');
        if (!config.url || !config.publishableKey?.startsWith('sb_publishable_')) throw new Error();
        accountClient = window.supabase.createClient(config.url, config.publishableKey, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true, storageKey: 'railpulse-auth' } });
        // Supabase callbacks must not await another Supabase call while its auth lock is held.
        accountClient.auth.onAuthStateChange((event, session) => {
            if (['TOKEN_REFRESHED', 'SIGNED_IN', 'USER_UPDATED'].includes(event) && accountUser?.id === session?.user?.id) {
                if (event === 'SIGNED_IN') setTimeout(() => loadSaved().catch(() => {}), 0);
                return;
            }
            setTimeout(() => handleSession(session, event).catch(() => { $('saved-status').textContent = 'Saved items could not be loaded.'; }), 0);
        });
    } catch { $('saved-status').textContent = 'Sign-in is unavailable right now. The journey checker still works.'; }
    renderSaved();
}
$('auth-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!accountClient || accountBusy) return;
    accountBusy = true; $('auth-submit').disabled = true; $('auth-status').textContent = 'Connecting securely…';
    try {
        let result;
        const email = $('auth-email').value.trim(), password = $('auth-password').value;
        if (authMode === 'recovery') result = await accountClient.auth.updateUser({ password });
        else if (authMode === 'signup') result = await accountClient.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/` } });
        else result = await accountClient.auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
        if (authMode === 'signup' && !result.data.session) $('auth-status').textContent = 'Check your email for a confirmation link, then sign in. If it does not arrive, contact the app owner.';
        else if (authMode === 'recovery') { $('auth-dialog').close(); authMode = 'signin'; toast('Your password has been updated.'); }
        else { $('auth-status').textContent = 'Signed in. Loading your saved items…'; }
        $('auth-password').value = '';
    } catch (error) { $('auth-status').textContent = accountError(error); }
    finally { accountBusy = false; $('auth-submit').disabled = false; }
});
$('auth-switch').addEventListener('click', () => { if (accountBusy) return; authMode = authMode === 'signin' ? 'signup' : 'signin'; renderAuth(); });
$('auth-reset').addEventListener('click', async () => {
    if (!accountClient || accountBusy) return;
    if (!$('auth-email').reportValidity()) return;
    accountBusy = true; $('auth-reset').disabled = true;
    try { const { error } = await accountClient.auth.resetPasswordForEmail($('auth-email').value.trim(), { redirectTo: `${location.origin}/?account=recovery` }); if (error) throw error; $('auth-status').textContent = 'If an account exists for this email, you’ll receive a password reset link.'; }
    catch (error) { $('auth-status').textContent = accountError(error); }
    finally { accountBusy = false; $('auth-reset').disabled = false; }
});
function placeLocation(place) {
    return { id: place.location_type === 'address' ? `point:${place.latitude},${place.longitude}` : `${place.location_type === 'station' ? 'station' : 'stop'}:${place.source_id}`, type: place.location_type, sourceId: place.source_id, name: place.label, detail: place.address || place.source_id, lat: place.latitude, lon: place.longitude };
}
function editPlace(place = null, category = 'other') {
    if (!requireAccount()) return;
    saveContext = { type: 'place', id: place?.id, location: place ? placeLocation(place) : null };
    $('save-title').textContent = place ? 'Edit your place' : 'Save a place'; $('save-name').value = place?.label || (category === 'home' ? 'Home' : category === 'work' ? 'Work' : '');
    $('save-category').value = place?.category || category; $('save-place-fields').classList.remove('hidden'); $('save-location').textContent = place?.address || place?.label || 'Choose station, stop or map location'; $('save-description').textContent = 'Saved privately to your account.'; $('save-status').textContent = ''; openDialog('save-dialog');
}
$('save-location').addEventListener('click', () => chooseLocation('Where is this place?', place => { if (!saveContext) return; saveContext.location = place; $('save-location').textContent = `${place.name} · ${place.detail}`; openDialog('save-dialog'); }));
function beginRouteSave() {
    if (!lastJourney || !activeJourney || !requireAccount()) return;
    const originName = lastJourney.mode === 'combined' ? mixedOrigin?.name || lastJourney.origin.name : lastJourney.origin;
    const destinationName = lastJourney.mode === 'combined' ? mixedDestination?.name || lastJourney.destination.name : lastJourney.destination;
    const alertLines = [...new Set((lastJourney.mode === 'combined' ? lastJourney.options[0]?.legs || [] : lastJourney.train?.legs || []).map(leg => leg.line).filter(Boolean))];
    saveContext = { type: 'route', request: { ...activeJourney }, originName, destinationName, alertLines, originPlace: mixedOrigin, destinationPlace: mixedDestination };
    $('save-title').textContent = 'Save this route'; $('save-name').value = `${originName} → ${destinationName}`.slice(0, 80); $('save-place-fields').classList.add('hidden'); $('save-description').textContent = 'Saves your locations and preferences. Arrivals and journey options are checked again when you open the route.'; $('save-status').textContent = ''; openDialog('save-dialog');
}
$('save-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!saveContext || !requireAccount()) return;
    const version = accountVersion, context = saveContext; $('save-submit').disabled = true; $('save-status').textContent = 'Saving…';
    try {
        let result;
        if (context.type === 'place') {
            if (!context.location) throw new Error('Choose a location for this place.');
            const place = context.location, values = { user_id: accountUser.id, label: $('save-name').value.trim(), category: $('save-category').value, location_type: place.type, source_id: place.sourceId || null, address: `${place.name} · ${place.detail || ''}`.slice(0, 500), latitude: place.lat, longitude: place.lon };
            result = context.id ? await accountClient.from('railpulse_saved_places').update(values).eq('id', context.id).eq('user_id', accountUser.id).select('id').single() : await accountClient.from('railpulse_saved_places').insert(values).select('id').single();
        } else {
            result = await accountClient.from('railpulse_saved_routes').upsert({ user_id: accountUser.id, name: $('save-name').value.trim(), mode: context.request.mode === 'combined' ? 'train' : context.request.mode, origin_id: context.request.origin, destination_id: context.request.destination, journey: { request: context.request, originName: context.originName, destinationName: context.destinationName, originPlace: context.originPlace, destinationPlace: context.destinationPlace }, alert_lines: context.alertLines }, { onConflict: 'user_id,mode,origin_id,destination_id' }).select('id').single();
        }
        if (result.error) throw result.error;
        if (version !== accountVersion) return;
        $('save-dialog').close(); saveContext = null; await loadSaved(version); toast('Saved to your account.');
    } catch (error) { if (version === accountVersion) $('save-status').textContent = accountError(error); }
    finally { $('save-submit').disabled = false; }
});
async function useSavedRoute(route) {
    const request = { ...(route.journey?.request || { mode: route.mode, origin: route.origin_id, destination: route.destination_id }) };
    let places = [route.journey?.originPlace, route.journey?.destinationPlace];
    if (request.mode === 'train') {
        places = [request.origin, request.destination].map(id => {
            const station = stationMap.get(id);
            return station ? { ...station, id: `station:${station.id}`, sourceId: station.id, type: 'station', detail: station.codes.join(' / ') } : null;
        });
        if (!places.every(Boolean)) { toast('A saved station is no longer in the active timetable. Choose another station.'); return; }
        request.mode = 'combined'; request.origin = places[0].id; request.destination = places[1].id;
    }
    switchMode(request.mode === 'combined' ? 'train' : request.mode);
    if (request.mode === 'combined') {
        if (!places.every(Boolean)) { toast('This route needs its locations selected again.'); return; }
        mixedOrigin = places[0]; mixedDestination = places[1]; syncMixed();
    } else if (request.mode === 'bus') { $('bus-origin').value = request.origin; $('bus-destination').value = request.destination; }
    else { $('origin-select').value = request.origin; $('dest-select').value = request.destination; syncStationPickers(); }
    applyStoredSettings(request); updateTimingEntry(); setView('plan', false); planJourney();
}
function currentSettings() { return { preference: $('preference').value, wheelchair: $('wheelchair-access').checked, transferMinutes: $('transfer-minutes').value, maxWalk: $('max-walk').value, walkPace: $('walk-pace').value, busCrowding: $('bus-crowd-preference').value }; }
function applyStoredSettings(settings) {
    for (const [key, id] of [['preference','preference'],['transferMinutes','transfer-minutes'],['maxWalk','max-walk'],['walkPace','walk-pace'],['busCrowding','bus-crowd-preference']]) {
        const field = $(id), value = String(settings[key] ?? '');
        if (field.tagName === 'SELECT' ? [...field.options].some(option => option.value === value && !option.disabled) : /^\d+$/.test(value) && Number(value) >= 4 && Number(value) <= 30) field.value = value;
    }
    if ('wheelchair' in settings) $('wheelchair-access').checked = settings.wheelchair === true || settings.wheelchair === 'true';
    updateAccessControls();
}
document.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.hasAttribute('data-signin')) requireAccount();
    if (button.dataset.shortcut) {
        const place = savedPlaces.find(row => row.category === button.dataset.shortcut);
        if (place) useEndpoint('destination', placeLocation(place)); else editPlace(null, button.dataset.shortcut);
    }
    if (button.hasAttribute('data-add-place')) editPlace();
    if (button.dataset.editPlace) editPlace(savedPlaces.find(place => place.id === button.dataset.editPlace));
    if (button.dataset.usePlace) useEndpoint('destination', placeLocation(savedPlaces.find(place => place.id === button.dataset.usePlace)));
    if (button.dataset.useRoute) useSavedRoute(savedRoutes.find(route => route.id === button.dataset.useRoute));
    if (button.hasAttribute('data-save-journey')) beginRouteSave();
    const version = accountVersion;
    try {
        if (button.dataset.saveBus && requireAccount()) {
            button.disabled = true;
            const { error } = await accountClient.from('railpulse_favourite_buses').upsert({ user_id: accountUser.id, service_no: button.dataset.saveBus, bus_stop_code: button.dataset.saveStop }, { onConflict: 'user_id,service_no,bus_stop_code' });
            if (error) throw error; if (version !== accountVersion) return; await loadSaved(); toast('Bus saved to your account.');
        }
        if (button.dataset.deleteKind && accountUser) {
            const table = ({ places: 'railpulse_saved_places', routes: 'railpulse_saved_routes', buses: 'railpulse_favourite_buses' })[button.dataset.deleteKind];
            if (!table) return; button.disabled = true;
            const { error } = await accountClient.from(table).delete().eq('id', button.dataset.deleteId).eq('user_id', accountUser.id); if (error) throw error;
            if (version !== accountVersion) return; await loadSaved(); toast('Removed from your saved items.');
        }
        if (button.id === 'save-watch-lines' && accountUser) {
            button.disabled = true; const lines = [...document.querySelectorAll('[name="watch-line"]:checked')].map(field => field.value);
            const { error } = await accountClient.from('railpulse_preferences').upsert({ user_id: accountUser.id, watched_lines: lines }); if (error) throw error;
            if (version !== accountVersion) return; watchedLines = lines; toast('Your watched lines have been saved.'); refreshPersonalAlerts();
        }
        if (button.id === 'save-cloud-preferences' && accountUser) {
            button.disabled = true; const settings = currentSettings();
            const { error } = await accountClient.from('railpulse_preferences').upsert({ user_id: accountUser.id, settings, preferred_mode: mode, preference: settings.preference, wheelchair_access: settings.wheelchair, transfer_minutes: Number(settings.transferMinutes), theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light' }); if (error) throw error;
            if (version === accountVersion) toast('Journey preferences saved to your account.');
        }
        if (button.id === 'signout' && accountClient) {
            button.disabled = true; await disablePush(); const { error } = await accountClient.auth.signOut(); if (error) throw error; toast('Signed out. Your cloud saves stay in your account.');
        }
        if (button.id === 'push-enable') { button.disabled = true; await enablePush(); }
        if (button.id === 'push-disable') { button.disabled = true; await disablePush(); if ($('push-status')) $('push-status').textContent = 'Notifications are off on this device.'; }
    } catch (error) { if (version === accountVersion) { toast(accountError(error)); if (button.id.startsWith('push') && $('push-status')) $('push-status').textContent = accountError(error); } }
    finally { button.disabled = false; }
});
async function refreshPersonalAlerts() {
    if (!accountUser || !$('personal-alerts')) return;
    const version = accountVersion, lines = [...new Set([...watchedLines, ...savedRoutes.flatMap(route => route.alert_lines || [])])];
    if (!lines.length) { $('personal-alerts').innerHTML = '<p class="small muted">Choose lines above or save a train route to personalise alerts.</p>'; return; }
    try {
        const response = await api('/api/alerts'); if (version !== accountVersion || !$('personal-alerts')) return;
        const affected = (response.value?.AffectedSegments || []).filter(segment => lines.includes(segment.Line) || (segment.Line === 'CEL' && lines.includes('CCL')));
        const unknown = response.meta?.stale || ![1, 2].includes(Number(response.value?.Status)) || Number(response.value?.Status) === 2 && !(response.value?.AffectedSegments || []).length;
        $('personal-alerts').innerHTML = `<p class="small">Watching ${lines.map(escapeHtml).join(', ')} · checked ${time(response.meta?.updatedAt)}</p>${unknown ? '<p class="small warning">Current disruption details could not be confirmed. Check the service advisories.</p>' : affected.length ? `<div class="recommendation warning"><strong>Disruption on your commute</strong>${affected.map(segment => `<p>${escapeHtml(segment.Line)} · ${escapeHtml(segment.Stations || 'Check service advisories')}</p>`).join('')}</div>` : '<p class="small muted">No current disruption reported on your watched lines.</p>'}`;
    } catch { if (version === accountVersion && $('personal-alerts')) $('personal-alerts').textContent = 'Personal alerts could not be refreshed. Check operator announcements.'; }
}
async function checkPushStatus() {
    try {
        const config = await api('/api/notifications/config'); if (!$('push-status')) return;
        $('push-enable').disabled = !config.ready;
        $('push-status').textContent = config.ready ? 'Background delivery is available. Permission is only requested when you enable notifications.' : 'Background notifications are not active yet. Your watched-line alerts work here while the app is open.';
    } catch { if ($('push-status')) $('push-status').textContent = 'Background notification availability could not be checked.'; }
}
async function unsubscribeBrowser() {
    if (!('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration(); const subscription = await registration?.pushManager?.getSubscription();
    if (subscription) await subscription.unsubscribe();
}
async function disablePush() {
    if (!('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration(); const subscription = await registration?.pushManager?.getSubscription();
    if (subscription && accountUser) { const { error } = await accountClient.from('railpulse_push_subscriptions').delete().eq('user_id', accountUser.id).eq('endpoint', subscription.endpoint); if (error) throw error; }
    await unsubscribeBrowser();
}
async function enablePush() {
    if (!requireAccount()) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('This browser does not support device notifications here. On iPhone, add RailPulse to the Home Screen and open it there.');
    if (!watchedLines.length && !savedRoutes.some(route => route.alert_lines?.length)) throw new Error('Save a train route or choose watched lines first.');
    // Keep the permission request in the user's click gesture, required on Safari.
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notification permission is off. You can change it in your browser or phone settings.');
    const config = await api('/api/notifications/config'); if (!config.ready) throw new Error('Background delivery is not active yet. Please try again after setup.');
    const version = accountVersion, userId = accountUser.id;
    const registration = await navigator.serviceWorker.ready;
    const bytes = Uint8Array.from(atob(config.publicKey.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
    try {
        if (version !== accountVersion || accountUser?.id !== userId) throw new Error('Sign in again to enable notifications.');
        const { error } = await accountClient.from('railpulse_push_subscriptions').upsert({ user_id: userId, endpoint: subscription.endpoint, subscription: subscription.toJSON() }, { onConflict: 'user_id,endpoint' }); if (error) throw error;
        if (version === accountVersion && $('push-status')) $('push-status').textContent = 'Device notifications enabled for your watched lines and saved train routes.';
    } catch (error) { await subscription.unsubscribe(); throw error; }
}
setInterval(() => { if (!document.hidden) refreshPersonalAlerts(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && accountUser) loadSaved().catch(() => {}); });
initialiseAccount();
