const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const time = value => value ? new Date(value).toLocaleTimeString('en-SG', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', hour12: false }) : 'unavailable';
const scheduleTime = seconds => `${seconds >= 86400 ? 'Tomorrow ' : ''}${String(Math.floor((seconds % 86400) / 3600)).padStart(2, '0')}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}`;
const stopCode = value => value.trim().match(/^\d{5}(?=\D|$)/)?.[0] || '';
let mode = 'train', activeJourney = null, requestVersion = 0, journeyBusy = false, busVersion = 0, activeBusStop = null;
let stationMap = new Map(), lastJourney = null, networkMeta = null;
let map, markerLayer, trailLayer, mapRoute = null, networkLegend = '';
let currentView = 'plan', panelPage = 'planner';
const phoneLayout = window.matchMedia('(max-width: 800px)');
const lineColors = { NSL: '#ed675c', EWL: '#57be88', CGL: '#57be88', NEL: '#b28dd8', CCL: '#efb540', DTL: '#559fee', TEL: '#b99978', BPL: '#9bbbaa', SLRT: '#9bbbaa', PLRT: '#9bbbaa' };

function setTheme(theme) {
    const dark = theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    $('theme-label').textContent = dark ? 'Light' : 'Dark';
    $('theme-toggle').setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} theme`);
    $('theme-toggle').setAttribute('aria-pressed', String(dark));
    document.querySelector('meta[name="theme-color"]').content = dark ? '#121a17' : '#f5f6f2';
    try { localStorage.setItem('railpulse-theme', dark ? 'dark' : 'light'); } catch { /* Theme still works when storage is unavailable. */ }
}
function syncShell() {
    document.body.dataset.view = currentView;
    document.body.dataset.panel = panelPage;
    $('panel-heading').textContent = currentView === 'buses' ? 'AT THE BUS STOP' : panelPage === 'results' ? 'YOUR JOURNEY OPTIONS' : 'YOUR JOURNEY';
    $('edit-journey').classList.toggle('hidden', currentView !== 'plan' || panelPage !== 'results');
    $('map-open-label').textContent = lastJourney ? 'View my journey' : 'Plan a journey';
    for (const view of ['plan', 'map', 'buses']) {
        $(`view-${view}`).classList.toggle('selected', currentView === view);
        $(`view-${view}`).setAttribute('aria-pressed', String(currentView === view));
    }
}
function setView(view, results = false) {
    currentView = view;
    if (view === 'plan') panelPage = results && lastJourney ? 'results' : 'planner';
    // The standalone bus tab is independent of the train-only journey filter.
    if (view === 'buses') panelPage = 'planner';
    syncShell();
    $('panel-scroll').scrollTop = 0;
    if (!document.activeElement.getClientRects().length) $(`view-${view}`).focus({ preventScroll: true });
    requestAnimationFrame(() => { map?.invalidateSize(); fitMapRoute(); });
}
function setSheetExpanded(expanded) {
    document.body.dataset.sheet = expanded ? 'expanded' : 'peek';
    $('sheet-expand').setAttribute('aria-expanded', String(expanded));
    $('sheet-expand').setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} panel`);
    $('sheet-expand-label').textContent = expanded ? 'Collapse' : 'Expand';
    requestAnimationFrame(fitMapRoute);
}

async function api(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load transport data.');
    return data;
}

function initialiseMap() {
    if (!window.L) { $('network-status').textContent = 'Map unavailable. Journey search still works.'; return; }
    map = L.map('map', { zoomControl: false, zoomSnap: .25, zoomDelta: .5 }).setView([1.3521, 103.8198], 12);
    map.createPane('network-lines').style.zIndex = 330;
    map.createPane('network-stations').style.zIndex = 340;
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    trailLayer = L.layerGroup().addTo(map);
    new ResizeObserver(() => { map.invalidateSize(); fitMapRoute(); }).observe($('map'));
}

async function loadNetwork() {
    try {
        const data = await api('/api/network');
        networkMeta = data.meta;
        stationMap = new Map(data.stations.map(s => [s.id, s]));
        for (const id of ['origin-select', 'dest-select']) {
            $(id).innerHTML = '<option value="">Choose a station…</option>' + data.stations.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} (${escapeHtml(s.codes.join(' / '))})</option>`).join('');
            $(id).disabled = false;
        }
        if (map) {
            const seen = new Set();
            for (const edge of data.segments) {
                const a = stationMap.get(edge.from), b = stationMap.get(edge.to);
                const key = [edge.from, edge.to].sort().join(':') + edge.line;
                if (!a || !b || seen.has(key)) continue;
                seen.add(key);
                L.polyline([[a.lat, a.lon], [b.lat, b.lon]], { pane: 'network-lines', color: edge.color, weight: 3, opacity: .9 }).addTo(map);
            }
            for (const station of data.stations) {
                L.circleMarker([station.lat, station.lon], { pane: 'network-stations', radius: 3, color: '#334155', weight: 1, fillColor: '#fff', fillOpacity: 1 }).bindPopup(`<strong>${escapeHtml(station.name)}</strong><br>${escapeHtml(station.codes.join(' / '))}`).addTo(markerLayer);
            }
        }
        const lines = [...new Set(data.stations.flatMap(s => s.lines))];
        networkLegend = lines.map(line => `<span><i style="background:${lineColors[line] || '#999'}"></i>${escapeHtml(line)}</span>`).join('');
        if (!mapRoute) $('map-legend').innerHTML = networkLegend;
        $('network-status').textContent = `${data.stations.length} stations · LTA timetable${data.meta.stale ? ' · cached, refresh unavailable' : ''} · schematic links`;
        $('planner-status').textContent = '';
        fitMapRoute();
    } catch (error) {
        $('planner-status').textContent = error.message;
        $('network-status').textContent = 'Train timetable unavailable. Bus search is still available.';
    }
}

async function checkAlerts() {
    try {
        const data = await api('/api/alerts');
        renderAlerts({ ...data.value, meta: data.meta });
    } catch {
        $('alert-title').textContent = 'Service status unavailable — check station announcements';
        $('alert-updated').textContent = '';
        $('alert-content').textContent = 'The live alert feed could not be refreshed.';
    }
}
function renderAlerts(alert) {
    if (!alert) return;
    const messages = alert.Message || [];
    const severe = Number(alert.Status) === 2;
    $('service-notices').classList.toggle('severe', severe);
    $('alert-title').textContent = severe ? 'Train disruption reported — check your journey' : messages.length ? `${messages.length} service advisories` : 'No train disruption reported by LTA';
    $('alert-updated').textContent = `${alert.meta?.stale ? 'Cached · refresh unavailable · ' : ''}Checked ${time(alert.meta?.updatedAt)}`;
    $('alert-content').innerHTML = messages.length ? messages.map(m => `<p>${escapeHtml(m.Content)}</p>`).join('') : '<p>No service notices in the latest response.</p>';
}

function switchMode(next) {
    clearJourney();
    mode = next;
    updateAccessControls();
    document.querySelector('#preference option[value="transfers"]').disabled = mode === 'bus';
    document.querySelector('#preference option[value="walking"]').disabled = mode === 'train-only';
    if ((mode === 'bus' && $('preference').value === 'transfers') || (mode === 'train-only' && $('preference').value === 'walking')) $('preference').value = 'fastest';
    $('train-fields').classList.toggle('hidden', mode === 'bus');
    $('bus-fields').classList.toggle('hidden', mode !== 'bus');
    if (mode === 'train-only') {
        busVersion++; activeBusStop = null;
        $('bus-results').innerHTML = '<p class="muted small">Search a stop to check the latest bus arrivals.</p>';
    }
    for (const value of ['train-only', 'train', 'bus']) {
        $(`${value}-mode`).classList.toggle('selected', value === mode);
        $(`${value}-mode`).setAttribute('aria-pressed', String(value === mode));
    }
    updateAccessControls();
}

function updateAccessControls() {
    const enabled = $('wheelchair-access').checked && mode !== 'bus';
    $('transfer-settings').classList.toggle('hidden', !enabled);
    $('transfer-minutes').disabled = !enabled;
    $('bus-wheelchair-access').checked = $('wheelchair-access').checked;
    $('preference-summary').textContent = ({ fastest: 'Fastest', walking: 'Less walking', transfers: 'Fewer transfers' })[$('preference').value];
}

function clearJourney() {
    requestVersion++;
    activeJourney = null; lastJourney = null; journeyBusy = false;
    $('origin-select').value = ''; $('dest-select').value = '';
    $('bus-origin').value = ''; $('bus-destination').value = '';
    $('route-results').classList.add('hidden'); $('route-results').innerHTML = '';
    $('planner-status').textContent = '';
    $('plan-route-btn').disabled = false;
    resetMapRoute();
    panelPage = 'planner';
    setView('plan');
}

async function planJourney(event, refreshing = false) {
    event?.preventDefault();
    if (refreshing && (!activeJourney || journeyBusy)) return;
    const request = refreshing ? activeJourney : {
        mode, origin: mode !== 'bus' ? $('origin-select').value : stopCode($('bus-origin').value),
        destination: mode !== 'bus' ? $('dest-select').value : stopCode($('bus-destination').value), preference: $('preference').value,
        wheelchair: $('wheelchair-access').checked, transferMinutes: $('wheelchair-access').checked && mode !== 'bus' ? $('transfer-minutes').value : 4
    };
    if (!request.origin || !request.destination || request.origin === request.destination) {
        $('planner-status').textContent = 'Choose two different stations or select two bus stops from the suggestions.';
        return;
    }
    const version = ++requestVersion;
    journeyBusy = true;
    $('plan-route-btn').disabled = true;
    $('planner-status').textContent = refreshing ? 'Updating your journey…' : request.mode === 'train-only' ? 'Checking LTA train timetables, alerts and crowd levels…' : 'Checking LTA routes, timetables and arrivals…';
    try {
        const data = await api(`/api/journey?${new URLSearchParams(request)}`);
        if (version !== requestVersion) return;
        activeJourney = request; lastJourney = data;
        if (!refreshing && currentView === 'plan') {
            setSheetExpanded(false);
            setView('plan', true);
        } else syncShell();
        renderJourney(data, !refreshing);
        $('planner-status').textContent = `Checked ${time(data.generatedAt)} · your journey refreshes every 30 seconds`;
    } catch (error) {
        if (version !== requestVersion) return;
        $('planner-status').textContent = error.message;
        if (refreshing) {
            $('route-results').innerHTML = '<div class="recommendation warning">Journey refresh failed. Previous recommendations have been removed until current data is available.</div>';
        } else { $('route-results').classList.add('hidden'); activeJourney = null; }
        lastJourney = null;
        resetMapRoute();
        panelPage = 'planner';
        syncShell();
    } finally {
        if (version === requestVersion) { journeyBusy = false; $('plan-route-btn').disabled = false; }
    }
}

function trainCard(train, data) {
    const name = id => escapeHtml(stationMap.get(id)?.name || id);
    const crowdRows = (data.crowd || []).flatMap(feed => (feed.value || []).map(row => ({ ...row, meta: feed.meta })));
    const levels = { l: ['Low', 'green'], m: ['Moderate', 'amber'], h: ['High', 'red'] };
    const crowds = train.stationIds.map(id => {
        const station = stationMap.get(id);
        const rows = crowdRows.filter(row => station?.codes.includes(row.Station));
        const row = rows.sort((a, b) => ({ h: 3, m: 2, l: 1 }[b.CrowdLevel] || 0) - ({ h: 3, m: 2, l: 1 }[a.CrowdLevel] || 0))[0];
        if (!row || !levels[row.CrowdLevel]) return `<div>${name(id)}: <span class="muted">unavailable</span></div>`;
        const old = row.meta?.stale || Date.now() - Date.parse(row.EndTime) > 600000;
        return `<div>${name(id)}: <span class="badge ${old ? 'amber' : levels[row.CrowdLevel][1]}">${levels[row.CrowdLevel][0]}${old ? ' · old reading' : ''}</span> <small>${time(row.StartTime)}–${time(row.EndTime)}</small></div>`;
    }).join('');
    return `<article class="journey-card">
        <div class="card-top"><div><h3>${data.affected ? 'Alternative train route' : 'Train journey'}</h3><span class="badge">Timetable</span></div><div class="time"><strong>${train.duration} min</strong><span>scheduled journey</span></div></div>
        <div class="card-body"><p>${train.stops} stops · ${train.transfers} ${train.transfers === 1 ? 'transfer' : 'transfers'}</p><p class="small muted">Depart ${scheduleTime(train.departure)} · arrive ${scheduleTime(train.arrival)} SGT</p>
        ${train.legs.map((leg, i) => `<div class="step"><strong>${escapeHtml(leg.line)} → ${escapeHtml(leg.headsign)}</strong>${name(leg.fromStation)} → ${name(leg.toStation)}<br><small>${scheduleTime(leg.departure)} · platform ${escapeHtml(leg.platform || 'not supplied')} · ${leg.stops} stops${i ? ` · ${train.transferMinutes} min transfer allowance` : ''}</small></div>`).join('')}
        <details><summary>Station crowd levels</summary><p class="small muted">Crowding at stations, not inside carriages.</p>${crowds || '<p>Unavailable</p>'}</details>
        <p class="small muted">LTA timetable · downloaded ${time(data.timetable.updatedAt)}${data.timetable.stale ? ' · old cached timetable' : ''}. Actual train arrival may differ.</p>
        <div class="card-actions"><button class="secondary" data-show-train>Show on map</button></div></div>
    </article>`;
}
function busCrowd(load, old = false) {
    // Low/moderate/high are display labels for LTA's categories, not percentages.
    const [level, description, color, bars] = ({
        __proto__: null,
        SEA: ['Low', 'Seats available', 'low', 1],
        SDA: ['Moderate', 'Standing available', 'moderate', 2],
        LSD: ['High', 'Limited standing', 'high', 3]
    })[load] || ['Unavailable', 'Not reported by LTA', 'unknown', 0];
    return `<div class="bus-crowd ${color}"><span class="crowd-label">Crowd level${old ? ' · old reading' : ''}</span><div class="crowd-value"><span class="crowd-bars" aria-hidden="true">${[1, 2, 3].map(n => `<i class="${n <= bars ? 'filled' : ''}"></i>`).join('')}</span><b>${level}</b></div><span class="crowd-description">${description}</span></div>`;
}
function busCard(option, index) {
    return `<article class="journey-card"><div class="card-top"><div><h3>Bus ${escapeHtml(option.service)}</h3><span class="badge green">Direct bus</span></div><div class="time"><strong>${option.duration === null ? '—' : `~${option.duration} min`}</strong><span>${option.duration === null ? 'no usable arrival' : 'estimated journey'}</span></div></div>
    <div class="card-body"><p><strong>Board:</strong> ${escapeHtml(option.board.Description)} (${escapeHtml(option.board.BusStopCode)})</p><p><strong>Alight:</strong> ${escapeHtml(option.alight.Description)} (${escapeHtml(option.alight.BusStopCode)})</p>
    <p class="small muted">${option.stops} stops · ${option.km} km · ~${option.walkMinutes} min walking</p>
    ${option.next?.Feature === 'WAB' ? '<span class="badge">Wheelchair-equipped bus</span>' : ''}
    ${option.next ? `<p>Bus at ${time(option.next.EstimatedArrival)} · in ${option.waitMinutes} min</p>${busCrowd(option.next.Load, option.stale)}<span class="badge">${Number(option.next.Monitored) === 1 ? 'Live prediction' : 'Scheduled arrival'}</span><p class="small muted">Arrival checked ${time(option.updatedAt)} · total includes estimated ride and walk</p>` : '<p class="muted">No matching arrival after your walk to the stop. Service may have ended, or predictions may be unavailable.</p>'}
    <div class="card-actions"><button class="secondary" data-show-bus="${index}">Show stops</button><button class="secondary" data-arrivals="${escapeHtml(option.board.BusStopCode)}">Stop arrivals</button></div></div></article>`;
}
function accessibilityNotes(data) {
    const access = data.accessibility;
    if (!access?.requested) return '';
    let liftMessage = '';
    if (data.mode !== 'bus') {
        const status = {
            unavailable: 'Lift-maintenance data is unavailable. Confirm lift access with station staff.',
            stale: 'Lift information could not be refreshed. Confirm current access with station staff.',
            'reported-maintenance': 'Lift maintenance is reported where you need station access. Ask staff about an alternative accessible entrance or lift.',
            'no-reported-maintenance': `${data.train ? 'No lift maintenance was reported at your boarding, transfer or destination stations.' : 'No lift maintenance was reported at your start or destination; a suitable train route could not be confirmed.'} This does not confirm that every lift is working.`
        }[access.liftStatus];
        liftMessage = `<p>${escapeHtml(status)}</p>${access.notices.map(notice => `<p class="lift-notice"><strong>${escapeHtml(notice.stationName)}${notice.atEndpoint ? ' · start/destination' : ''}</strong><br>${escapeHtml(notice.description)}${notice.liftId ? ` (${escapeHtml(notice.liftId)})` : ''}</p>`).join('')}
            <p class="small muted">${access.liftUpdatedAt ? `Lift feed checked ${time(access.liftUpdatedAt)}. ` : ''}Transfers avoid stations with reported lift maintenance. Allowance: ${access.transferMinutes} min per transfer.</p><p class="small muted">Accessible entrances and the full step-free path have not been verified.</p>`;
    }
    const busMessage = data.mode !== 'train-only' ? '<p>Only buses reported as wheelchair-equipped are included.</p><p class="small muted">Step-free access to the boarding and alighting stops, and space in the wheelchair bay, are not confirmed. Access-time estimates use the general walking model.</p>' : '';
    return `<section class="access-checks" aria-label="Wheelchair access checks"><h3>Wheelchair access checks</h3>${liftMessage}${busMessage}</section>`;
}
function renderJourney(data, fit) {
    renderAlerts(data.alerts);
    const results = $('route-results');
    results.classList.remove('hidden');
    const trainOnly = data.mode === 'train-only';
    const bestBus = data.buses.options.find(option => option.available);
    let recommendation = '';
    if (data.affected) recommendation = data.train ? 'Your usual train route crosses a reported disruption. This alternative avoids the affected segment.' : `Your train route crosses a reported disruption. No alternative train journey was found in the next three hours. ${trainOnly ? 'Check station announcements or change journey type to explore buses.' : 'Check the direct bus options below.'}`;
    else if (data.mode !== 'bus' && data.train) recommendation = bestBus && bestBus.duration < data.train.duration ? `Bus ${bestBus.service} has a lower estimated journey time than the scheduled train option. Compare the walking time and service advisories before leaving.` : 'The train option below uses today’s LTA timetable. Check the platform display for the actual departure.';
    else if (data.mode !== 'bus') recommendation = `No scheduled train journey was found within the next three hours. ${trainOnly ? 'Check train operating hours.' : 'Check operating hours and bus options.'}`;
    else if (bestBus) recommendation = `Bus ${bestBus.service} has a matching arrival for this direct journey.`;
    if (!data.affected && data.train && activeJourney?.preference === 'walking') recommendation = 'Direct bus options prioritise shorter estimated walks. The train journey below uses today’s timetable; walking within stations is not measured.';
    if (!data.affected && data.train && activeJourney?.preference === 'transfers') recommendation = `The train search favours fewer transfers.${trainOnly ? '' : ' Direct bus options below require no bus transfers.'}`;
    if (data.accessibility?.requested) {
        if (data.mode !== 'bus' && !data.train) recommendation = 'No train journey meeting these settings was found within the next three hours. Check station access with staff or try a different route.';
        else if (!data.affected) recommendation = '';
    }
    const messages = data.alerts?.Message || [];
    const usedLines = new Set(data.train?.legs.map(leg => leg.line) || []);
    const usedStations = data.train?.stationIds.map(id => stationMap.get(id)?.name.toLowerCase()).filter(Boolean) || [];
    const aliases = { SLRT: 'sengkang', PLRT: 'punggol', BPL: 'bukit panjang', EWL: 'east west', NSL: 'north south', TEL: 'thomson', DTL: 'downtown', CCL: 'circle', NEL: 'north east' };
    const relevant = messages.filter(message => {
        const text = message.Content.toLowerCase().replaceAll('-', ' ');
        return usedStations.some(s => text.includes(s)) || [...usedLines].some(line => text.includes(line.toLowerCase()) || text.includes(aliases[line] || line.toLowerCase())) || data.buses.options.some(option => new RegExp(`\\b${option.service.replace(/[^a-z0-9]/gi, '')}\\b`, 'i').test(text));
    });
    results.innerHTML = `<p class="eyebrow">JOURNEY OPTIONS</p><h2>${escapeHtml(data.origin)} → ${escapeHtml(data.destination)}</h2>
        ${recommendation ? `<div class="recommendation${data.affected ? ' warning' : ''}">${escapeHtml(recommendation)}</div>` : ''}
        ${accessibilityNotes(data)}
        ${!data.alerts || data.alerts.meta?.stale || data.noDetailedDisruption ? '<div class="recommendation warning">Current disruption details could not be confirmed. Check operator announcements before travelling.</div>' : ''}
        ${data.timetable?.stale || data.buses.stale ? '<div class="recommendation warning">Some route or timetable data is cached because its refresh failed.</div>' : ''}
        ${relevant.length ? `<details class="recommendation warning" open><summary>Advisories to check for this journey</summary>${relevant.map(m => `<p>${escapeHtml(m.Content)}</p>`).join('')}</details>` : ''}
        ${data.train ? trainCard(data.train, data) : ''}
        ${trainOnly ? '' : `<h3>Direct bus options</h3>${data.buses.error ? `<p class="error">${escapeHtml(data.buses.error)}</p>` : data.buses.options.length ? data.buses.options.map(busCard).join('') : `<p class="muted small">${data.accessibility?.requested ? 'No matching direct bus arrival with wheelchair access confirmed in the current response.' : data.mode === 'train' ? `No direct bus found within an estimated ${data.buses.radius} m walk at each end.` : 'No direct service found between these two stops.'} Bus transfers are not included.</p>`}
        <p class="small muted">${data.buses.updatedAt ? `Bus routes downloaded ${time(data.buses.updatedAt)} · ` : ''}Compare estimates with care; delays, diversions and walking conditions can change your journey.</p>`}`;
    const selectedBus = !fit && mapRoute?.kind === 'bus' ? data.buses.options.find(option => busMapKey(option) === mapRoute.key) : null;
    if (selectedBus) showBus(selectedBus, fit);
    else if (data.train) showTrain(data.train, fit);
    else if (data.buses.options[0]) showBus(data.buses.options[0], fit);
    else resetMapRoute();
}

function resetMapRoute() {
    trailLayer?.clearLayers();
    mapRoute = null;
    $('map').classList.remove('route-focused');
    $('map-caption').textContent = 'Singapore rail network';
    $('map-legend').innerHTML = networkLegend;
    $('map-legend').classList.remove('route-legend');
    $('fit-route-btn').classList.add('hidden');
    syncShell();
}
function fitMapRoute() {
    if (!map) return;
    const sidebar = document.querySelector('.sidebar');
    const panelVisible = currentView !== 'map';
    const size = map.getSize();
    const bottomPanel = panelVisible && phoneLayout.matches ? sidebar.offsetHeight : 0;
    if (size.y - bottomPanel < 165) return;
    const sidePanel = panelVisible && !phoneLayout.matches ? sidebar.offsetWidth + 36 : 0;
    if (!mapRoute?.points.length) {
        map.setView([1.335, 103.82], phoneLayout.matches ? 11.5 : 12, { animate: false });
        map.panBy([-sidePanel / 2, bottomPanel / 2], { animate: false });
        return;
    }
    const legend = $('map-legend');
    const legendSpace = legend.offsetHeight ? legend.offsetHeight + (currentView === 'map' ? 120 : 60) : 45;
    const caption = document.querySelector('.map-caption');
    map.fitBounds(mapRoute.points, {
        paddingTopLeft: [sidePanel + (phoneLayout.matches ? 65 : 85), caption.offsetTop + caption.offsetHeight + 48],
        paddingBottomRight: [phoneLayout.matches ? 65 : 85, bottomPanel ? bottomPanel + 45 : legendSpace],
        maxZoom: 16, animate: false
    });
}
function routePin(point, label, role, name, detail = '') {
    const description = `${role}: ${name}${detail ? ` · ${detail}` : ''}`;
    const icon = L.divIcon({ className: 'route-pin', html: `<span class="${role.toLowerCase()}">${escapeHtml(label)}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
    const marker = L.marker(point, { icon, title: description, alt: description, zIndexOffset: 1000 }).bindPopup(`<strong>${escapeHtml(role)} · ${escapeHtml(name)}</strong>${detail ? `<br>${escapeHtml(detail)}` : ''}`).addTo(trailLayer);
    if (role !== 'Transfer') marker.bindTooltip(escapeHtml(name), { permanent: true, direction: role === 'Start' ? 'top' : 'bottom', offset: [0, role === 'Start' ? -18 : 18], className: 'route-label' });
    return `<span class="route-stop"><b class="route-key ${role.toLowerCase()}">${escapeHtml(label)}</b><span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(role)}${detail ? ` · ${escapeHtml(detail)}` : ''}</small></span></span>`;
}
function focusMapRoute(title, stops, route, fit) {
    mapRoute = route;
    $('map').classList.add('route-focused');
    $('map-caption').textContent = title;
    $('map-legend').classList.add('route-legend');
    $('map-legend').innerHTML = stops.join('');
    $('fit-route-btn').classList.remove('hidden');
    if (fit) fitMapRoute();
}
function showTrain(train, fit = true) {
    if (!map) return;
    trailLayer.clearLayers();
    const points = [];
    for (const leg of train.legs) {
        const coordinates = leg.stations.map(id => stationMap.get(id)).filter(Boolean).map(s => [s.lat, s.lon]);
        points.push(...coordinates);
        L.polyline(coordinates, { color: '#17212c', weight: 13, opacity: 1, interactive: false }).addTo(trailLayer);
        L.polyline(coordinates, { color: '#fff', weight: 10, opacity: 1, interactive: false }).addTo(trailLayer);
        L.polyline(coordinates, { color: leg.color, weight: 6, opacity: 1 }).bindTooltip(escapeHtml(`${leg.line} → ${leg.headsign}`)).addTo(trailLayer);
    }
    for (const id of new Set(train.stationIds)) {
        const station = stationMap.get(id);
        if (station) L.circleMarker([station.lat, station.lon], { radius: 4, color: '#17212c', weight: 2, fillColor: '#fff', fillOpacity: 1 }).bindPopup(`<strong>${escapeHtml(station.name)}</strong><br>${escapeHtml(station.codes.join(' / '))}`).addTo(trailLayer);
    }
    const stops = [];
    train.legs.forEach((leg, index) => {
        const station = stationMap.get(leg.fromStation);
        if (station) stops.push(routePin([station.lat, station.lon], index ? String(index) : 'A', index ? 'Transfer' : 'Start', station.name, index ? `${train.legs[index - 1].line} → ${leg.line}` : leg.line));
    });
    const destination = stationMap.get(train.legs.at(-1)?.toStation);
    if (destination) stops.push(routePin([destination.lat, destination.lon], 'B', 'End', destination.name));
    focusMapRoute('Your train route · follow A to B', stops, { kind: 'train', points }, fit);
}
const busMapKey = option => `${option.service}:${option.direction}:${option.board.BusStopCode}:${option.alight.BusStopCode}`;
function showBus(option, fit = true) {
    if (!map) return;
    trailLayer.clearLayers();
    if (option.coordinates.length) {
        L.polyline(option.coordinates, { color: '#17212c', weight: 12, opacity: 1, interactive: false }).addTo(trailLayer);
        L.polyline(option.coordinates, { color: '#fff', weight: 9, opacity: 1, interactive: false }).addTo(trailLayer);
        L.polyline(option.coordinates, { color: '#087858', weight: 6, opacity: 1, dashArray: '10 7' }).addTo(trailLayer);
        option.coordinates.forEach(point => L.circleMarker(point, { radius: 3, color: '#174739', weight: 1.5, fillColor: '#fff', fillOpacity: 1, interactive: false }).addTo(trailLayer));
    }
    const stops = [option.board, option.alight].map((stop, index) => routePin([stop.Latitude, stop.Longitude], index ? 'B' : 'A', index ? 'End' : 'Start', stop.Description, stop.BusStopCode));
    focusMapRoute(`Bus ${option.service} · schematic stop connections`, stops, { kind: 'bus', key: busMapKey(option), points: option.coordinates }, fit);
}

function installStopSearch(inputId, listId) {
    let timeout, version = 0;
    $(inputId).addEventListener('input', () => {
        clearTimeout(timeout);
        const current = ++version;
        const query = $(inputId).value.trim();
        if (query.length < 2) { $(listId).innerHTML = ''; return; }
        timeout = setTimeout(async () => {
            try {
                const data = await api(`/api/bus-stops?q=${encodeURIComponent(query)}`);
                if (version === current) $(listId).innerHTML = data.value.map(stop => `<option value="${escapeHtml(stop.BusStopCode)} — ${escapeHtml(stop.Description)}">${escapeHtml(stop.RoadName)}</option>`).join('');
            } catch { /* Search remains usable by five-digit stop code. */ }
        }, 250);
    });
}
async function searchBus(event, refresh = false) {
    event?.preventDefault();
    const code = refresh ? activeBusStop : stopCode($('bus-stop-input').value);
    if (!code) { $('bus-results').textContent = 'Select a stop or enter its five-digit code.'; return; }
    const version = ++busVersion;
    if (!refresh) $('bus-results').textContent = 'Loading arrivals…';
    try {
        const [data, stops] = await Promise.all([api(`/api/bus-arrival?BusStopCode=${code}&wheelchair=${$('wheelchair-access').checked}`), api(`/api/bus-stops?BusStopCode=${code}`)]);
        if (version !== busVersion) return;
        activeBusStop = code;
        const stop = stops.value.find(s => s.BusStopCode === code);
        if (!stop) { $('bus-results').textContent = 'Stop not found in LTA data.'; return; }
        const services = data.Services || [];
        $('bus-results').innerHTML = `<p><strong>${escapeHtml(stop.Description)}</strong><br><span class="small muted">${escapeHtml(code)} · ${escapeHtml(stop.RoadName)} · checked ${time(data.meta.updatedAt)}</span></p>
            <p class="small muted">Crowd levels use LTA’s seat / standing availability for each bus. They may change before boarding.</p>
            ${data.meta.wheelchairOnly ? '<p class="small muted">Wheelchair-equipped buses only. Stop access and wheelchair-bay space are not confirmed.</p>' : ''}
            ${data.meta.stale ? '<p class="error">Cached response — arrivals could not be refreshed. Times below may be out of date.</p>' : ''}
            ${services.length ? services.map(service => `<div class="bus-row"><div class="bus-row-heading"><span class="bus-number">${escapeHtml(service.ServiceNo)}</span><span class="muted">Next three buses</span></div><div class="bus-times">${['NextBus', 'NextBus2', 'NextBus3'].map(key => {
                const bus = service[key];
                if (!bus?.EstimatedArrival) return `<div><strong>—</strong><small>${data.meta.wheelchairOnly ? 'No confirmed wheelchair arrival' : 'No prediction'}</small></div>`;
                const mins = Math.ceil((Date.parse(bus.EstimatedArrival) - Date.now()) / 60000);
                const type = ({ SD: 'Single deck', DD: 'Double deck', BD: 'Bendy' })[bus.Type] || 'Type unavailable';
                return `<div><strong>${mins < 0 ? 'Passed' : mins === 0 ? 'Arriving' : `${mins} min`}</strong><small>${time(bus.EstimatedArrival)}</small><small>${type}</small>${busCrowd(bus.Load, data.meta.stale || mins < 0)}<small>${Number(bus.Monitored) === 1 ? 'Live prediction' : 'Scheduled'}${bus.Feature === 'WAB' ? ' · Wheelchair bus' : ''}</small></div>`;
            }).join('')}</div></div>`).join('') : `<p class="muted">${data.meta.wheelchairOnly ? 'No upcoming bus arrivals with wheelchair access confirmed in this response.' : 'No arrivals reported. Services may not be operating at this time.'}</p>`}`;
    } catch (error) { if (version === busVersion) $('bus-results').textContent = error.message; }
}

$('journey-form').addEventListener('submit', planJourney);
$('clear-route-btn').addEventListener('click', clearJourney);
$('train-mode').addEventListener('click', () => switchMode('train'));
$('train-only-mode').addEventListener('click', () => switchMode('train-only'));
$('bus-mode').addEventListener('click', () => switchMode('bus'));
$('bus-form').addEventListener('submit', searchBus);
$('bus-wheelchair-access').addEventListener('change', () => {
    $('wheelchair-access').checked = $('bus-wheelchair-access').checked;
    $('wheelchair-access').dispatchEvent(new Event('change'));
});
$('fit-route-btn').addEventListener('click', fitMapRoute);
$('theme-toggle').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
for (const view of ['plan', 'map', 'buses']) $(`view-${view}`).addEventListener('click', () => setView(view));
$('edit-journey').addEventListener('click', () => { setView('plan'); requestAnimationFrame(() => $('planner-section').focus({ preventScroll: true })); });
$('map-open-planner').addEventListener('click', () => setView('plan', Boolean(lastJourney)));
$('sheet-expand').addEventListener('click', () => setSheetExpanded(document.body.dataset.sheet !== 'expanded'));
document.querySelector('.skip-link').addEventListener('click', () => { setView('plan'); setSheetExpanded(true); });
phoneLayout.addEventListener('change', () => requestAnimationFrame(() => { map?.invalidateSize(); fitMapRoute(); }));
// Keep the form usable when the on-screen keyboard leaves little map space.
for (const input of document.querySelectorAll('input,select')) input.addEventListener('focus', () => {
    if (phoneLayout.matches && input.closest('.sidebar')) setSheetExpanded(true);
});
for (const id of ['origin-select', 'dest-select', 'bus-origin', 'bus-destination', 'preference', 'wheelchair-access', 'transfer-minutes']) {
    $(id).addEventListener('change', () => {
        updateAccessControls();
        requestVersion++; activeJourney = null; lastJourney = null; journeyBusy = false;
        $('plan-route-btn').disabled = false;
        $('route-results').classList.add('hidden');
        $('planner-status').textContent = 'Compare journeys to check your updated selection.';
        resetMapRoute();
        panelPage = 'planner';
        syncShell();
        if (id === 'wheelchair-access') {
            busVersion++;
            if (activeBusStop) searchBus(null, true);
        }
    });
}
$('route-results').addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target || !lastJourney) return;
    if (target.hasAttribute('data-show-train')) { showTrain(lastJourney.train, false); setView('map'); }
    if (target.hasAttribute('data-show-bus')) { showBus(lastJourney.buses.options[Number(target.dataset.showBus)], false); setView('map'); }
    if (target.dataset.arrivals) { setView('buses'); $('bus-stop-input').value = target.dataset.arrivals; searchBus(); }
});
installStopSearch('bus-origin', 'bus-origin-options');
installStopSearch('bus-destination', 'bus-destination-options');
installStopSearch('bus-stop-input', 'bus-search-options');
let initialTheme = 'light';
try { initialTheme = localStorage.getItem('railpulse-theme') || 'light'; } catch { /* Use the default theme. */ }
setTheme(initialTheme);
syncShell();
initialiseMap();
loadNetwork();
checkAlerts();
setInterval(() => {
    if (document.hidden) return;
    checkAlerts();
    if (activeJourney) planJourney(null, true);
    if (activeBusStop) searchBus(null, true);
}, 30000);
