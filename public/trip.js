let activeTrip = null, tripWatch = null, gpsCandidate = null;
const guidanceProgress = TripGuide.progress;
function trainStops(id) { const s = stationMap.get(id); return s ? { id: `station:${id}`, sourceId: id, type: 'station', name: s.name, lat: s.lat, lon: s.lon } : null; }
function startTrip(option) {
    if (!option?.legs?.length) return;
    if (Date.now() - Date.parse(lastJourney?.generatedAt) > 90000) { toast('This journey is over 90 seconds old. Refresh the journey before starting.'); return; }
    stopTracking();
    activeTrip = { legs: structuredClone(option.legs), index: 0, stopIndex: 0, riding: false, notified: new Set(), startedAt: Date.now() };
    $('active-trip-button').classList.remove('hidden'); $('trip-gps-status').textContent = 'GPS reminders work while this app is open. Underground GPS can be unreliable; follow signs and announcements.';
    renderTrip(); openDialog('trip-dialog');
}
function renderTrip() {
    if (!activeTrip) return;
    const leg = activeTrip.legs[activeTrip.index], stops = leg.stops || [], next = stops[Math.min(activeTrip.stopIndex + 1, stops.length - 1)];
    const atEnd = stops.length && activeTrip.stopIndex >= stops.length - 1;
    const nearEnd = stops.length > 1 && activeTrip.stopIndex === stops.length - 2;
    const progress = `<div class="trip-progress" aria-label="Step ${activeTrip.index + 1} of ${activeTrip.legs.length}">${activeTrip.legs.map((_, i) => `<i class="${i <= activeTrip.index ? 'done' : ''}"></i>`).join('')}</div>`;
    const instruction = leg.type === 'walk' ? `Go to ${leg.to.name}` : !activeTrip.riding ? `Board ${legName(leg)} at ${leg.from.name}` : atEnd ? `Get off at ${leg.to.name}` : nearEnd ? `Get off at the next stop` : `Stay on ${legName(leg)}`;
    $('trip-content').innerHTML = `${progress}<p class="small muted">Step ${activeTrip.index + 1} of ${activeTrip.legs.length} · trip started ${time(activeTrip.startedAt)}</p><section class="trip-step"><p class="eyebrow">${escapeHtml(legName(leg))}</p><h3>${escapeHtml(instruction)}</h3>${leg.type !== 'walk' && activeTrip.riding ? `<p class="next-stop">${atEnd ? 'Your stop: ' : 'Next stop: '}${escapeHtml(atEnd ? leg.to.name : next?.name || leg.to.name)}</p><p class="small muted">${Math.max(0, stops.length - 1 - activeTrip.stopIndex)} stops to ${escapeHtml(leg.to.name)}</p>` : `<p>${escapeHtml(leg.from.name)} → ${escapeHtml(leg.to.name)}</p>`}<p class="small muted">${escapeHtml(legDetail(leg))}</p>${leg.type === 'walk' ? `<p class="small">Follow a safe pedestrian route. This estimate does not verify step-free access.</p><a href="${walkLink(leg.to)}" target="_blank" rel="noreferrer">Open walking directions ↗</a>` : leg.type === 'bus' ? `<button type="button" class="text-button" data-open-arrivals="${escapeHtml(leg.from.sourceId)}">Check live arrivals ↗</button>` : `<button type="button" class="text-button" data-exits="${escapeHtml(leg.to.sourceId)}">Destination exits ↗</button>`}</section>${leg.type !== 'walk' && activeTrip.riding ? '<p class="small muted">Without reliable GPS, use “Next stop” as you pass each stop, or mark that you have arrived.</p><button id="trip-arrived" type="button" class="secondary">I’m at my alighting stop</button>' : ''}${activeTrip.legs[activeTrip.index + 1] ? `<p class="small"><strong>Then:</strong> ${escapeHtml(legName(activeTrip.legs[activeTrip.index + 1]))} → ${escapeHtml(activeTrip.legs[activeTrip.index + 1].to.name)}</p>` : '<p class="small">This is the final part of your journey.</p>'}`;
    $('trip-back').disabled = activeTrip.index === 0 && !activeTrip.riding && activeTrip.stopIndex === 0;
    $('trip-next').textContent = leg.type === 'walk' ? 'I’m here →' : !activeTrip.riding ? 'I’m on board →' : atEnd ? 'I’ve got off →' : 'Next stop →';
}
function nextLeg() {
    if (!activeTrip) return;
    activeTrip.index++; activeTrip.stopIndex = 0; activeTrip.riding = false; gpsCandidate = null;
    if (activeTrip.index >= activeTrip.legs.length) { endTrip(); toast('You’ve reached the end of your journey.'); return; }
    renderTrip();
}
function endTrip() { stopTracking(); activeTrip = null; $('trip-dialog').close(); $('active-trip-button').classList.add('hidden'); }
function stopTracking() { if (tripWatch !== null) navigator.geolocation?.clearWatch(tripWatch); tripWatch = null; gpsCandidate = null; $('trip-gps').textContent = '◎ Turn on stop reminders'; }
$('trip-end').addEventListener('click', endTrip);
$('active-trip-button').addEventListener('click', () => { if (activeTrip) { renderTrip(); openDialog('trip-dialog'); } });
$('trip-next').addEventListener('click', () => {
    if (!activeTrip) return; const leg = activeTrip.legs[activeTrip.index];
    if (leg.type === 'walk') return nextLeg();
    if (!activeTrip.riding) activeTrip.riding = true;
    else if (activeTrip.stopIndex < (leg.stops?.length || 1) - 1) activeTrip.stopIndex++;
    else return nextLeg();
    gpsCandidate = null; renderTrip();
});
$('trip-back').addEventListener('click', () => {
    if (!activeTrip) return;
    if (activeTrip.stopIndex > 0) activeTrip.stopIndex--;
    else if (activeTrip.riding) activeTrip.riding = false;
    else if (activeTrip.index > 0) activeTrip.index--;
    gpsCandidate = null; renderTrip();
});
$('trip-content').addEventListener('click', event => { if (event.target.closest('#trip-arrived')) nextLeg(); });
$('trip-gps').addEventListener('click', async () => {
    if (tripWatch !== null) { stopTracking(); $('trip-gps-status').textContent = 'GPS reminders paused. Use the journey buttons to follow your stops.'; return; }
    if (!navigator.geolocation || !activeTrip) { $('trip-gps-status').textContent = 'Location tracking is unavailable. Use the manual journey buttons.'; return; }
    const trip = activeTrip;
    // Notification permission is optional; in-app guidance still works without it.
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
    $('trip-gps-status').textContent = 'Finding your position. Keep the app open for GPS reminders.';
    tripWatch = navigator.geolocation.watchPosition(async position => {
        if (activeTrip !== trip || !activeTrip) return;
        if (document.hidden) { gpsCandidate = null; return; }
        const leg = activeTrip.legs[activeTrip.index];
        if (!activeTrip.riding || !leg.stops?.length) { $('trip-gps-status').textContent = 'Location is on. Tap “I’m on board” after boarding to start stop reminders.'; return; }
        const location = { lat: position.coords.latitude, lon: position.coords.longitude, accuracy: position.coords.accuracy };
        const index = guidanceProgress(leg.stops, activeTrip.stopIndex, location);
        $('trip-gps-status').textContent = location.accuracy > 80 ? 'GPS accuracy is low. Use the manual buttons and listen for stop announcements.' : `GPS reminders on · accuracy about ${Math.round(location.accuracy)} m. Keep this app open.`;
        if (index === null) { gpsCandidate = null; return; }
        if (gpsCandidate?.index !== index || gpsCandidate.leg !== activeTrip.index) { gpsCandidate = { index, leg: activeTrip.index, at: Date.now() }; return; }
        if (Date.now() - gpsCandidate.at < 3000) return;
        activeTrip.stopIndex = index; gpsCandidate = null; renderTrip();
        if (index >= leg.stops.length - 2) {
            const key = `${activeTrip.index}:${index}`;
            if (activeTrip.notified.has(key)) return;
            activeTrip.notified.add(key);
            const text = index === leg.stops.length - 1 ? `Near ${leg.to.name}. Check the stop before getting off.` : `Your next stop is ${leg.to.name}. Get ready to alight.`;
            toast(text); navigator.vibrate?.([150, 80, 150]);
            if ('Notification' in window && Notification.permission === 'granted') {
                const registration = await navigator.serviceWorker?.getRegistration();
                if (activeTrip === trip) await registration?.showNotification('RailPulse · stop reminder', { body: text, tag: 'railpulse-trip', icon: '/icon.svg', data: { url: '/?view=trip' } });
            }
        }
    }, error => { stopTracking(); $('trip-gps-status').textContent = error.code === 1 ? 'Location permission is off. Follow your stops with the manual buttons.' : 'Your position could not be found. Tap to retry, or use the manual buttons.'; }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 });
    $('trip-gps').textContent = 'Pause stop reminders';
});
document.addEventListener('visibilitychange', () => { if (activeTrip && document.hidden) { gpsCandidate = null; $('trip-gps-status').textContent = 'GPS progress may pause in the background. Recheck the current stop when you return.'; } });
document.addEventListener('click', event => {
    const button = event.target.closest('[data-start-combined], [data-start-train], [data-start-bus]'); if (!button || !lastJourney) return;
    if (button.hasAttribute('data-start-combined')) return startTrip(lastJourney.options[Number(button.dataset.startCombined)]);
    if (button.hasAttribute('data-start-train')) {
        const train = lastJourney.train;
        const base = new Date(Date.parse(lastJourney.generatedAt) + 8 * 3600000).toISOString().slice(0, 10), midnight = Date.parse(`${base}T00:00:00+08:00`);
        startTrip({ legs: train.legs.map(leg => ({ type: 'train', line: leg.line, headsign: leg.headsign, platform: leg.platform, from: trainStops(leg.fromStation), to: trainStops(leg.toStation), stops: leg.stations.map(trainStops).filter(Boolean), departureAt: new Date(midnight + leg.departure * 1000).toISOString(), arrivalAt: new Date(midnight + leg.arrival * 1000).toISOString() })) });
    }
    if (button.hasAttribute('data-start-bus')) {
        const bus = lastJourney.buses.options[Number(button.dataset.startBus)];
        if (!bus?.next) { toast('No usable arrival for this bus. Check arrivals again before starting.'); return; }
        startTrip({ legs: [{ type: 'bus', service: bus.service, from: bus.routeStops[0], to: bus.routeStops.at(-1), stops: bus.routeStops, rideMinutes: bus.rideMinutes, departureAt: bus.next.EstimatedArrival, wheelchair: bus.next.Feature === 'WAB' }] });
    }
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type !== 'OPEN_NOTIFICATION') return;
    if (event.data.view === 'trip' && activeTrip) openDialog('trip-dialog'); else setView('saved');
});
if (new URLSearchParams(location.search).get('view') === 'saved') setView('saved');
