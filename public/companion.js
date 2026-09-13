let mixedOrigin = null, mixedDestination = null, locationChoice = null, locationRows = [], locationVersion = 0, nearbyVersion = 0, nearbyRows = [];
let toastTimer, mapPicking = false, detailVersion = 0;
const walkLink = place => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${place.lat},${place.lon}`)}&travelmode=walking`;
function toast(message) { $('app-toast').textContent = message; $('app-toast').classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('app-toast').classList.add('hidden'), 5000); }
function openDialog(id) { if (!$(id).open) $(id).showModal(); $(id).querySelector('[data-close]')?.focus({ preventScroll: true }); }
document.addEventListener('click', event => { const button = event.target.closest('[data-close]'); if (button) $(button.dataset.close).close(); });
function localPoint(lat, lon, name = 'Current location') {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 1.13 || lat > 1.49 || lon < 103.59 || lon > 104.12) throw new Error('Choose a location in Singapore.');
    const rounded = { lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)) };
    return { ...rounded, id: `point:${rounded.lat},${rounded.lon}`, type: 'address', name, detail: `${rounded.lat.toFixed(5)}, ${rounded.lon.toFixed(5)}` };
}
function getLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('Location is unavailable in this browser. Search for a stop or choose a point on the map.'));
        navigator.geolocation.getCurrentPosition(position => {
            try { resolve({ ...localPoint(position.coords.latitude, position.coords.longitude), accuracy: position.coords.accuracy }); } catch (error) { reject(error); }
        }, error => reject(new Error(error.code === 1 ? 'Location permission is off. You can enable it in browser settings, search for a stop or use the map.' : 'Your location could not be found. Try outdoors, or choose a stop on the map.')), { enableHighAccuracy: true, maximumAge: 30000, timeout: 12000 });
    });
}
function invalidateMixed() {
    requestVersion++; activeJourney = null; lastJourney = null; journeyBusy = false;
    $('route-results').innerHTML = ''; $('route-results').classList.add('hidden'); $('plan-route-btn').disabled = false;
    $('planner-status').textContent = ''; panelPage = 'planner'; resetMapRoute(); syncShell();
}
function syncMixed() {
    for (const [id, value, placeholder] of [['mixed-origin', mixedOrigin, 'Station, bus stop or location'], ['mixed-destination', mixedDestination, 'Where are you heading?']]) {
        $(id).innerHTML = `<span>${escapeHtml(value?.name || placeholder)}${value ? `<small>${escapeHtml(value.detail || '')}</small>` : ''}</span><b aria-hidden="true">⌕</b>`;
    }
    if (mode === 'train') {
        $('origin-select').value = mixedOrigin?.type === 'station' ? mixedOrigin.sourceId : '';
        $('dest-select').value = mixedDestination?.type === 'station' ? mixedDestination.sourceId : '';
        syncStationPickers(); updateTimingEntry();
    }
}
window.clearMixedLocations = () => { mixedOrigin = null; mixedDestination = null; syncMixed(); };
window.mixedRequest = () => ({ mode: 'combined', origin: mixedOrigin?.id || '', destination: mixedDestination?.id || '' });
function setMixedLocation(which, place) { invalidateMixed(); if (which === 'origin') mixedOrigin = place; else mixedDestination = place; syncMixed(); setView('plan', false); }
function chooseLocation(title, onChoose) {
    locationChoice = onChoose; locationVersion++; locationRows = []; $('location-search').value = ''; $('location-results').innerHTML = '';
    $('location-title').textContent = title; $('location-status').textContent = 'Search for a station or bus stop, use your location, or pick a point on the map.';
    openDialog('location-dialog');
}
function finishLocation(place) {
    const callback = locationChoice; locationChoice = null; mapPicking = false; $('map-pick-banner').classList.add('hidden');
    $('location-dialog').close(); callback?.(place);
}
$('mixed-origin').addEventListener('click', () => chooseLocation('Where are you starting?', place => setMixedLocation('origin', place)));
$('mixed-destination').addEventListener('click', () => chooseLocation('Where are you going?', place => setMixedLocation('destination', place)));
$('swap-locations').addEventListener('click', () => { [mixedOrigin, mixedDestination] = [mixedDestination, mixedOrigin]; invalidateMixed(); syncMixed(); });
let searchTimer;
$('location-search').addEventListener('input', () => {
    clearTimeout(searchTimer); const version = ++locationVersion, query = $('location-search').value.trim();
    locationRows = []; $('location-results').innerHTML = '';
    if (query.length < 2) { $('location-status').textContent = 'Type at least two characters.'; return; }
    $('location-status').textContent = 'Searching LTA stations and stops…';
    searchTimer = setTimeout(async () => {
        try {
            const result = await api(`/api/locations?q=${encodeURIComponent(query)}`);
            if (version !== locationVersion || !$('location-dialog').open) return;
            locationRows = result.value;
            $('location-status').textContent = `${locationRows.length} results. Choose your stop or station.`;
            $('location-results').innerHTML = locationRows.map((row, index) => `<button type="button" class="location-result" data-location-index="${index}"><span class="result-icon" aria-hidden="true">${row.type === 'station' ? '▥' : '▰'}</span><span><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.type === 'station' ? 'Train · ' : 'Bus stop · ')}${escapeHtml(row.detail)}</small></span></button>`).join('');
        } catch (error) { if (version === locationVersion) $('location-status').textContent = error.message; }
    }, 250);
});
$('location-results').addEventListener('click', event => { const button = event.target.closest('[data-location-index]'); if (button && locationRows[Number(button.dataset.locationIndex)]) finishLocation(locationRows[Number(button.dataset.locationIndex)]); });
$('location-gps').addEventListener('click', async () => {
    const version = ++locationVersion; $('location-status').textContent = 'Finding your location…'; $('location-gps').disabled = true;
    try { const place = await getLocation(); if (version === locationVersion && $('location-dialog').open) finishLocation(place); }
    catch (error) { if (version === locationVersion) $('location-status').textContent = error.message; }
    finally { $('location-gps').disabled = false; }
});
$('coordinate-form').addEventListener('submit', event => { event.preventDefault(); try { finishLocation(localPoint(Number($('coordinate-lat').value), Number($('coordinate-lon').value), 'Map location')); } catch (error) { $('location-status').textContent = error.message; } });
$('location-map').addEventListener('click', () => {
    if (!map) { $('location-status').textContent = 'The map is unavailable. Use coordinates or search instead.'; return; }
    mapPicking = true; $('location-dialog').close(); if ($('save-dialog').open) $('save-dialog').close(); setView('map'); $('map-pick-banner').classList.remove('hidden');
});
$('map-pick-cancel').addEventListener('click', () => { mapPicking = false; $('map-pick-banner').classList.add('hidden'); openDialog('location-dialog'); });
map?.on('click', event => { if (!mapPicking) return; try { finishLocation(localPoint(event.latlng.lat, event.latlng.lng, 'Map location')); } catch (error) { toast(error.message); } });
$('location-dialog').addEventListener('close', () => { locationVersion++; });
document.addEventListener('click', event => { if (event.target.closest('[data-open-nearby]')) { openDialog('nearby-dialog'); if (!nearbyRows.length) $('nearby-status').textContent = 'Tap “Use my location” to find your nearest connections.'; } });
$('nearby-refresh').addEventListener('click', async () => {
    const version = ++nearbyVersion; $('nearby-refresh').disabled = true; $('nearby-status').textContent = 'Finding nearby stops and stations…'; $('nearby-results').innerHTML = '';
    try {
        const place = await getLocation(), result = await api(`/api/nearby?lat=${place.lat}&lon=${place.lon}`);
        if (version !== nearbyVersion || !$('nearby-dialog').open) return;
        nearbyRows = [...result.stations, ...result.stops];
        $('nearby-status').textContent = `${nearbyRows.length} connections found · location accuracy about ${Math.round(place.accuracy)} m. Distances are straight-line; check actual walking access.`;
        $('nearby-results').innerHTML = [['Stations', result.stations], ['Bus stops', result.stops]].map(([title, rows]) => `<section class="nearby-group"><h3>${title}</h3>${rows.length ? rows.map(row => `<article class="nearby-card"><div class="place-row"><h3>${escapeHtml(row.name)}</h3><strong>${row.distanceMeters < 1000 ? `${row.distanceMeters} m` : `${(row.distanceMeters / 1000).toFixed(1)} km`}</strong></div><p class="small muted">${escapeHtml(row.detail)}</p><div class="card-actions"><button type="button" data-nearby-from="${nearbyRows.indexOf(row)}">From here</button><button type="button" data-nearby-to="${nearbyRows.indexOf(row)}">To here</button>${row.type === 'bus_stop' ? `<button type="button" data-open-arrivals="${escapeHtml(row.sourceId)}">Arrivals</button>` : `<button type="button" data-exits="${escapeHtml(row.sourceId)}">Exits</button>`}</div></article>`).join('') : '<p class="small muted">None within 2.5 km.</p>'}</section>`).join('');
    } catch (error) { if (version === nearbyVersion) $('nearby-status').textContent = error.message; }
    finally { if (version === nearbyVersion) $('nearby-refresh').disabled = false; }
});
function useEndpoint(which, place) { if (mode !== 'train') switchMode('train'); $('nearby-dialog').close(); setMixedLocation(which, place); }
document.addEventListener('click', event => {
    const from = event.target.closest('[data-nearby-from]'), to = event.target.closest('[data-nearby-to]'), arrivals = event.target.closest('[data-open-arrivals]');
    if (from) useEndpoint('origin', nearbyRows[Number(from.dataset.nearbyFrom)]);
    if (to) useEndpoint('destination', nearbyRows[Number(to.dataset.nearbyTo)]);
    if (arrivals) { $('nearby-dialog').close(); $('detail-dialog').close(); $('trip-dialog').close(); setView('buses'); $('bus-stop-input').value = arrivals.dataset.openArrivals; searchBus(); }
    const exits = event.target.closest('[data-exits]'); if (exits) showExits(exits.dataset.exits);
    const pattern = event.target.closest('[data-pattern-id]'); if (pattern) showPattern(pattern.dataset.patternId, pattern.dataset.patternKind || 'train', pattern.dataset.patternName || 'This location');
});
function patternTag(pattern) { return `<span class="pattern-tag ${pattern?.level === 'busy' ? 'busy' : ''}">${escapeHtml(pattern?.label || 'Pattern unavailable')}${pattern?.status === 'stale' ? ' · old download' : ''}</span>`; }
function patternCard(pattern, name) {
    if (!pattern || pattern.status === 'unavailable') return '<section class="pattern-card"><h3>Usual busy times</h3><p class="small muted">Historical passenger data is unavailable for this location and day. No rush-hour assumption has been applied.</p></section>';
    const dayLabel = pattern.dayType === 'WEEKDAY' ? 'Weekday' : pattern.holiday ? 'Public holiday' : 'Weekend';
    return `<section class="pattern-card"><p class="eyebrow">THE USUAL PATTERN</p><h3>${escapeHtml(name)} ${patternTag(pattern)}</h3><p class="small muted">${dayLabel} · ${escapeHtml(pattern.month)} passenger data${!pattern.calendarKnown ? ' · holiday calendar not confirmed for this year' : ''}${pattern.status === 'stale' ? ' · using an older download' : ''}</p><div class="pattern-chart" role="img" aria-label="Hourly passenger activity. ${escapeHtml(pattern.peakHours.map(hour => `${String(hour).padStart(2, '0')}:00`).join(', '))} were the busier hours in this historical day profile.">${pattern.hours.map(row => `<div class="${row.relative === null ? 'unknown-hour' : ''} ${row.hour === pattern.hour ? 'selected-hour' : ''}" style="height:${Math.max(row.relative || 0, 2)}%" title="${String(row.hour).padStart(2, '0')}:00 · ${row.volume === null ? 'unavailable' : `${row.volume.toLocaleString()} monthly tap-ins + tap-outs`}"></div>`).join('')}</div><div class="pattern-hours"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div><p class="pattern-legend"><i aria-hidden="true"></i>Selected hour: ${String(pattern.hour).padStart(2, '0')}:00</p><p class="small"><strong>Historically busier:</strong> ${pattern.peakHours.map(hour => `${String(hour).padStart(2, '0')}:00`).join(', ')}.</p><p class="pattern-disclaimer">Historical activity can differ from today’s LTA crowd forecast. It does not measure how full a train or bus is, or predict road traffic.</p><details><summary class="small">Source & method</summary><p class="small muted">${escapeHtml(pattern.note)} Checked ${time(pattern.retrievedAt)}.</p><a href="https://datamall.lta.gov.sg/content/datamall/en/search_datasets.html" target="_blank" rel="noreferrer">LTA passenger volume data ↗</a></details></section>`;
}
async function showPattern(id, kind, name) {
    const version = ++detailVersion; $('detail-title').textContent = 'Usual busy times'; $('detail-content').textContent = 'Loading LTA passenger history…'; openDialog('detail-dialog');
    try { const result = await api(`/api/patterns?${new URLSearchParams({ kind, id })}`); if (version === detailVersion) $('detail-content').innerHTML = patternCard(result, name); }
    catch (error) { if (version === detailVersion) $('detail-content').textContent = error.message; }
}
async function showExits(station) {
    const version = ++detailVersion; $('detail-title').textContent = 'Station exits'; $('detail-content').textContent = 'Loading official station exits…'; openDialog('detail-dialog');
    try {
        const data = await api(`/api/station-exits?station=${encodeURIComponent(station)}`);
        if (version !== detailVersion) return;
        $('detail-title').textContent = `${data.station.name} exits`;
        $('detail-content').innerHTML = `<p>Choose an exit to open walking directions.</p><p class="small muted">These are official exit locations. This dataset does not identify step-free entrances. For wheelchair access, confirm the lift entrance with station staff before choosing an exit.</p>${data.stale ? '<p class="error">Exit data could not be refreshed; this is an older download.</p>' : ''}${data.exits.length ? data.exits.map(exit => `<article class="nearby-card"><h3>${escapeHtml(exit.label)}</h3><div class="card-actions"><a href="${walkLink(exit)}" target="_blank" rel="noreferrer">Walking directions ↗</a></div><p class="small muted">Opens Google Maps. Step-free path not verified.</p></article>`).join('') : '<p>No matching exits supplied for this station.</p>'}<p class="small muted">${escapeHtml(data.source)} · checked ${time(data.retrievedAt)}</p><a href="${escapeHtml(data.sourceUrl)}" target="_blank" rel="noreferrer">View source ↗</a>`;
    } catch (error) { if (version === detailVersion) $('detail-content').textContent = error.message; }
}
function legName(leg) { return leg.type === 'walk' ? 'Walk / roll' : leg.type === 'train' ? leg.line : `Bus ${leg.service}`; }
function legDetail(leg) {
    if (leg.type === 'walk') return `${leg.minutes} min · about ${leg.meters} m · estimated, check walking route`;
    if (leg.type === 'bus') return `${leg.rideMinutes} min estimated ride · ${leg.departureAt ? `board around ${time(leg.departureAt)}` : 'transfer bus wait not yet known'}${leg.wheelchair ? ' · wheelchair-equipped bus reported' : ''}`;
    return `${time(leg.departureAt)}–${time(leg.arrivalAt)} scheduled · towards ${leg.headsign} · platform ${leg.platform || 'not supplied'}`;
}
function renderCombined(data, fit) {
    const results = $('route-results'), openCards = new Set([...results.querySelectorAll('details[open][data-mixed-details]')].map(el => el.dataset.mixedDetails));
    results.classList.remove('hidden');
    const from = mixedOrigin?.id === data.origin.id ? mixedOrigin.name : data.origin.name, to = mixedDestination?.id === data.destination.id ? mixedDestination.name : data.destination.name;
    results.innerHTML = `<p class="eyebrow">YOUR WHOLE JOURNEY</p><h2>${escapeHtml(from)} → ${escapeHtml(to)}</h2><div class="card-actions"><button type="button" data-save-journey>♡ Save route</button>${mixedOrigin?.type === 'station' && mixedDestination?.type === 'station' ? '<button type="button" data-compare-times>Compare times ↗</button>' : ''}</div>${!data.alerts || data.alerts.meta?.stale ? '<p class="recommendation warning">Current rail disruptions could not be confirmed. Check operator announcements.</p>' : ''}${data.stale ? '<p class="recommendation warning">Some route data could not be refreshed. Check services before leaving.</p>' : ''}${data.wheelchair ? '<p class="recommendation warning">Bus legs require a current wheelchair-equipped arrival. Step-free street access and wheelchair-bay space are not confirmed.</p>' : ''}${data.options.length ? data.options.map((option, index) => `<article class="mixed-card"><div class="mixed-card-heading"><h3>${option.kind === 'combined' ? 'Bus + train' : option.kind === 'train' ? 'By train' : 'By bus'}</h3><div><strong>${option.minutes} min</strong><small>${option.unknownWait ? '+ transfer bus wait' : option.kind === 'train' && !option.walkMinutes ? 'scheduled journey' : 'estimated journey'}</small></div></div><p class="mixed-meta">${option.transfers} ${option.transfers === 1 ? 'transfer' : 'transfers'} · ${option.walkMinutes} min walking / rolling estimate</p><div class="journey-chain">${option.legs.map((leg, i) => `${i ? '<span aria-hidden="true">→</span>' : ''}<span class="chain-chip">${escapeHtml(leg.type === 'walk' ? `${leg.minutes}m walk` : legName(leg))}</span>`).join('')}</div>${option.stationCrowd ? `<div class="mixed-crowd"><span class="small muted">${option.stationCrowd.status === "live" ? "Now" : "Latest reading"} at ${escapeHtml(option.stationCrowd.station)}</span>${crowdPill(option.stationCrowd)}${patternTag(option.pattern)}<small class="muted">Usual pattern at your scheduled boarding hour; not train occupancy.</small></div>` : ""}${option.unknownWait ? '<p class="small warning">Add waiting time for the bus after your train. Its arrival is not yet confirmed; this total is a minimum.</p>' : ''}${option.accessibility?.liftStatus && option.accessibility.liftStatus !== 'no-reported-maintenance' ? '<p class="small warning">Lift access needs checking with station staff. The current feed reports maintenance, is old or is unavailable.</p>' : ''}<div class="card-actions"><button type="button" class="primary" data-start-combined="${index}">Start trip →</button><button type="button" data-map-combined="${index}">Map</button></div><details class="mixed-details" data-mixed-details="${index}" ${openCards.has(String(index)) ? 'open' : ''}><summary>See journey steps</summary><ol class="mixed-steps">${option.legs.map(leg => `<li><strong>${escapeHtml(legName(leg))}</strong><p>${escapeHtml(leg.from.name)} → ${escapeHtml(leg.to.name)}</p><small>${escapeHtml(legDetail(leg))}</small>${leg.type === 'bus' ? `${busCrowd(leg.load)}<button type="button" class="text-button" data-open-arrivals="${escapeHtml(leg.from.sourceId)}">Check boarding stop arrivals ↗</button>` : leg.type === 'train' ? `<button type="button" class="text-button" data-exits="${escapeHtml(leg.to.sourceId)}">${escapeHtml(leg.to.name)} exits ↗</button>` : `<a class="small" href="${walkLink(leg.to)}" target="_blank" rel="noreferrer">Open walking directions ↗</a>`}</li>`).join('')}</ol></details></article>`).join('') : '<div class="recommendation">No usable connection found with these settings. Try a nearby station, allow a longer walk or recheck bus arrivals. Missing arrival data is not treated as a confirmed connection.</div>'}<details class="data-notes"><summary>How these journeys are calculated</summary><p>${escapeHtml(data.note)}</p></details>`;
    if (data.options[0] && fit) showCombinedMap(data.options[0], false);
    document.dispatchEvent(new CustomEvent('journey-rendered', { detail: data }));
}
window.renderCombined = renderCombined;
function showCombinedMap(option, navigate = true) {
    if (!map) return;
    resetMapRoute(); const coordinates = [];
    for (const leg of option.legs) {
        const points = (leg.stops || [leg.from, leg.to]).map(stop => [stop.lat, stop.lon]); coordinates.push(...points);
        const color = leg.type === 'train' ? lineColors[leg.line] || '#426c56' : leg.type === 'bus' ? '#b65e28' : '#59665e';
        L.polyline(points, { color: '#fff', weight: 10, opacity: 1 }).addTo(trailLayer);
        L.polyline(points, { color, weight: 5, dashArray: leg.type === 'walk' ? '6 8' : undefined }).addTo(trailLayer);
    }
    const first = option.legs[0]?.from, last = option.legs.at(-1)?.to;
    const labels = [];
    if (first) labels.push(routePin([first.lat, first.lon], 'A', 'Start', first.name));
    if (last) labels.push(routePin([last.lat, last.lon], 'B', 'End', last.name));
    focusMapRoute('Your connected journey', labels, { kind: 'combined', points: coordinates }, false);
    $('network-status').textContent = 'Schematic connections · open walking directions for street paths';
    if (navigate) setView('map');
    if (coordinates.length) requestAnimationFrame(() => { map.invalidateSize(); fitMapRoute(); });
}
document.addEventListener('click', event => { const button = event.target.closest('[data-map-combined]'); if (button && lastJourney?.mode === 'combined') showCombinedMap(lastJourney.options[Number(button.dataset.mapCombined)]); });
document.addEventListener('journey-rendered', event => {
    if (event.detail.mode === 'combined') return;
    const results = $('route-results');
    const tools = document.createElement('div'); tools.className = 'card-actions'; tools.innerHTML = '<button type="button" data-save-journey>♡ Save route</button>';
    results.querySelector('h2')?.after(tools);
    if (event.detail.train) {
        const start = document.createElement('button'); start.className = 'primary'; start.type = 'button'; start.dataset.startTrain = ''; start.textContent = 'Start train trip →';
        results.querySelector('[data-show-train]')?.parentElement.append(start);
    }
    for (const button of results.querySelectorAll('[data-show-bus]')) {
        const start = document.createElement('button'); start.className = 'secondary'; start.type = 'button'; start.dataset.startBus = button.dataset.showBus; start.textContent = 'Start bus trip →'; button.parentElement.append(start);
    }
});
// Read-only enhancements to bus result cards, including saved services and patterns.
const busEnhancer = new MutationObserver(() => {
    const root = $('bus-results');
    for (const row of root.querySelectorAll('.bus-row:not([data-save-ready])')) {
        row.dataset.saveReady = 'true'; const number = row.querySelector('.bus-number')?.textContent;
        if (number && activeBusStop) { const button = document.createElement('button'); button.type = 'button'; button.className = 'icon-action'; button.dataset.saveBus = number; button.dataset.saveStop = activeBusStop; button.setAttribute('aria-label', `Save bus ${number} at stop ${activeBusStop}`); button.textContent = '♡'; row.querySelector('.bus-row-heading').append(button); }
    }
    if (activeBusStop && root.querySelector('[data-road-stop]') && !root.querySelector('[data-pattern-id]')) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary nearby-entry'; button.dataset.patternId = activeBusStop; button.dataset.patternKind = 'bus'; button.dataset.patternName = `Stop ${activeBusStop}`; button.textContent = 'Usual busy times at this stop ↗'; root.querySelector('[data-road-stop]').after(button);
    }
});
busEnhancer.observe($('bus-results'), { childList: true, subtree: true });
window.addEventListener('offline', () => toast('You’re offline. Live arrivals and fresh journey planning need a connection.'));
window.addEventListener('online', () => toast('Back online. Recheck your journey for the latest arrivals.'));
syncMixed();
