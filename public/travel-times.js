let timingVersion = 0, timingRequest = null, timingTrigger = null;
const timingDay = value => new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 10);
const timingDateLabel = value => new Date(value).toLocaleDateString('en-SG', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short' });
const crowdNames = { l: 'Low', m: 'Moderate', h: 'High' };
$('timing-time').innerHTML = Array.from({ length: 48 }, (_, index) => {
    const label = `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`;
    return `<option value="${label}">${label}</option>`;
}).join('');

function updateTimingEntry() {
    $('compare-times-entry').classList.toggle('hidden', mode === 'bus');
    const ready = $('origin-select').value && $('dest-select').value && $('origin-select').value !== $('dest-select').value;
    $('compare-times-button').disabled = !ready;
    $('compare-times-hint').textContent = ready ? 'See scheduled train times and crowd forecasts for later.' : 'Choose both stations to compare crowd forecasts and train times.';
}
function openTimingShell(trigger, roadOnly = false) {
    timingTrigger = trigger;
    $('timing-form').classList.toggle('hidden', roadOnly);
    $('timing-title').textContent = roadOnly ? 'Road alerts nearby' : 'When should I go?';
    $('timing-dialog').querySelector('.eyebrow').textContent = roadOnly ? 'CURRENT CONDITIONS' : 'PLAN AHEAD';
    $('timing-results').innerHTML = '';
    $('timing-status').classList.remove('error');
    $('timing-status').textContent = 'Checking LTA data…';
    if (!$('timing-dialog').open) $('timing-dialog').showModal();
    $('timing-scroll').scrollTop = 0;
    $('timing-close').focus({ preventScroll: true });
}
function crowdPill(reading) {
    const known = crowdNames[reading?.level];
    const usable = known && reading.status !== 'stale';
    const rank = ({ l: 1, m: 2, h: 3 })[reading?.level] || 0;
    return `<span class="forecast-level ${usable ? reading.level : 'unknown'}"><span class="forecast-bars" aria-hidden="true">${[1, 2, 3].map(n => `<i class="${usable && n <= rank ? 'filled' : ''}"></i>`).join('')}</span><span>${known || 'Unavailable'}${reading?.status === 'stale' ? '<small>Old reading</small>' : ''}</span></span>`;
}
function renderRoadConditions(data, location) {
    const status = data.status === 'live' ? 'Current report' : data.status === 'stale' ? 'Old cached report' : 'Unavailable';
    return `<section class="road-conditions"><div class="conditions-heading"><h3>Roads near ${escapeHtml(location)}</h3><span class="badge">${status}</span></div>
        ${data.status === 'unavailable' ? '<p>Road alerts could not be loaded. Traffic conditions are unknown.</p>' : `<p>${data.incidents.length ? `${data.incidents.length} road ${data.incidents.length === 1 ? 'alert' : 'alerts'} within 1.5 km.` : 'No road alerts reported within 1.5 km.'}</p>
        ${data.incidents.length ? `<ul>${data.incidents.map(row => `<li><strong>${escapeHtml(row.type)} · ${(row.distanceMeters / 1000).toFixed(1)} km away</strong><p>${escapeHtml(row.message)}</p></li>`).join('')}</ul>` : ''}
        <p class="small muted">LTA Traffic Incidents · checked ${time(data.retrievedAt)}${data.status === 'stale' ? ' · refresh failed' : ''}.</p>`}
        <p class="small muted">Nearby reports, not a traffic forecast or your bus's exact route. No alert does not mean roads are clear.</p></section>`;
}
function renderTimeComparison(data) {
    const usable = data.slots.filter(slot => slot.train && slot.crowd.status === 'forecast' && !data.timetable.stale && crowdNames[slot.crowd.level]);
    const unique = [...new Set(usable.map(slot => slot.crowd.level))];
    const rank = { l: 1, m: 2, h: 3 };
    const quietest = usable.slice().sort((a, b) => rank[a.crowd.level] - rank[b.crowd.level] || Date.parse(a.at) - Date.parse(b.at))[0];
    let insight = 'No usable crowd forecast for these train times. Choose another window or check closer to departure.';
    if (unique.length === 1) insight = `${crowdNames[unique[0]]} crowd levels across ${usable.length === data.slots.length ? 'these times' : 'the times with available forecasts'}. Choose the departure that suits you.`;
    if (unique.length > 1) insight = `A quieter option: ${time(quietest.at)} on ${timingDateLabel(quietest.at)} — ${crowdNames[quietest.crowd.level].toLowerCase()} crowd forecast, ${quietest.train.duration} min scheduled journey.`;
    $('timing-results').innerHTML = `<p class="comparison-insight">${escapeHtml(insight)}</p>
        <p class="small muted">Crowds at <strong>${escapeHtml(data.origin.name)}</strong>, not inside carriages. Times start at this station.</p>
        <div class="time-columns" aria-hidden="true"><span>At station</span><span>Train journey</span><span>Station crowd</span></div>
        <div class="time-options">${data.slots.map(slot => `<details class="time-option${unique.length > 1 && slot === quietest ? ' quieter' : ''}"><summary>
            <span class="slot-clock"><strong>${time(slot.at)}</strong><small>${timingDateLabel(slot.at)}</small></span>
            <span class="slot-duration"><strong>${slot.train ? `${slot.train.duration} min` : 'No train'}</strong><small>${slot.train ? `Arrive ${time(slot.train.arrivalAt)}${timingDay(slot.train.arrivalAt) !== timingDay(slot.at) ? ` · ${timingDateLabel(slot.train.arrivalAt)}` : ''}` : slot.timetableCovered ? 'None within 3h' : 'Outside timetable'}</small></span>
            ${crowdPill(slot.crowd)}<span class="slot-more">${unique.length > 1 && slot === quietest ? 'Quieter option · ' : ''}View details <span aria-hidden="true">⌄</span></span></summary>
            <div class="slot-details">${slot.train ? `<p><strong>Be at ${escapeHtml(data.origin.name)} by ${time(slot.at)}.</strong> Scheduled train departure ${time(slot.train.departureAt)}${timingDay(slot.train.departureAt) !== timingDay(slot.at) ? ` on ${timingDateLabel(slot.train.departureAt)}` : ''}.</p><p>${slot.train.stops} ${slot.train.stops === 1 ? 'stop' : 'stops'} · ${slot.train.transfers ? `${slot.train.transfers} ${slot.train.transfers === 1 ? 'transfer' : 'transfers'}` : 'Direct train'} · includes timetable waiting and transfers.</p>
            ${slot.train.legs.map(leg => `<div class="time-leg"><strong>${escapeHtml(leg.line)} → ${escapeHtml(leg.headsign)}</strong><p>${escapeHtml(leg.from)} → ${escapeHtml(leg.to)}</p><small>${time(leg.departureAt)}–${time(leg.arrivalAt)} · platform ${escapeHtml(leg.platform || 'not supplied')}</small></div>`).join('')}` : '<p>No scheduled train journey found in the search window. A low crowd forecast does not mean trains are running.</p>'}
            <p class="small muted">${slot.crowd.level ? `${escapeHtml(slot.crowd.line)} ${escapeHtml(slot.crowd.stationCode)} · LTA forecast for ${time(slot.crowd.intervalStart)}–${time(slot.crowd.intervalEnd)} · retrieved ${time(slot.crowd.retrievedAt)}${slot.crowd.status === 'stale' ? ' · refresh failed' : ''}.` : 'LTA has not supplied a matching forecast for this station and interval.'}</p>
            ${slot.accessibility ? `<p class="small">Wheelchair transfer allowance: ${slot.accessibility.transferMinutes} min. ${slot.accessibility.liftStatus === 'no-reported-maintenance' ? 'No lift maintenance currently reported at the access stations. Future lift access is not confirmed.' : 'Check current lift access with station staff; maintenance information is incomplete, old or reports an outage.'}</p>` : ''}</div></details>`).join('')}</div>
        <p class="timing-footnote">30-minute forecasts from LTA. Train times use the published timetable and current service/lift notices. They exclude travel to the station. Recheck before leaving.</p>
        <div class="current-crowd"><div><strong>Latest reading at ${escapeHtml(data.origin.name)}</strong><small>${data.live.line ? escapeHtml(data.live.line) + ' · ' : ''}${data.live.status === 'live' ? `Reading ${time(data.live.intervalStart)}–${time(data.live.intervalEnd)}` : data.live.status === 'stale' ? `Old reading · ${timingDateLabel(data.live.intervalStart)} ${time(data.live.intervalStart)}–${time(data.live.intervalEnd)}` : 'Live reading unavailable'}</small></div>${crowdPill(data.live)}</div>
        ${data.timetable.stale ? '<p class="recommendation warning">Old cached timetable: the latest timetable could not be retrieved.</p>' : ''}
        ${!data.advisories.available ? '<p class="recommendation warning">Current service advisories could not be confirmed.</p>' : ''}
        ${data.advisories.disruptionReported ? '<p class="recommendation warning">A disruption is currently reported. This comparison avoids reported affected segments, but future service conditions may change.</p>' : ''}
        ${data.advisories.messages.length ? `<details class="timing-advisories"><summary>Current service advisories</summary>${data.advisories.messages.map(row => `<p>${escapeHtml(row.Content)}</p>`).join('')}</details>` : ''}
        ${renderRoadConditions(data.traffic, data.origin.name)}
        <p class="small muted">Future bus crowd and road traffic forecasts are not available from these feeds. Use Buses for upcoming arrivals and their current crowd readings.</p>`;
    $('timing-status').textContent = `Singapore time · checked ${time(data.generatedAt)}. Tap a row for train details.`;
}
async function loadTimeComparison(event) {
    event?.preventDefault();
    if (!timingRequest) return;
    const version = ++timingVersion;
    $('timing-results').innerHTML = '';
    $('timing-status').classList.remove('error');
    $('timing-status').textContent = 'Comparing timetables and LTA crowd forecasts…';
    $('timing-submit').disabled = true;
    const start = `${$('timing-date').value}T${$('timing-time').value}:00+08:00`;
    try {
        const data = await api(`/api/travel-times?${new URLSearchParams({ ...timingRequest, start })}`);
        if (version !== timingVersion || !$('timing-dialog').open) return;
        renderTimeComparison(data);
    } catch (error) {
        if (version !== timingVersion) return;
        $('timing-status').textContent = error.message;
        $('timing-status').classList.add('error');
    } finally { if (version === timingVersion) $('timing-submit').disabled = false; }
}
function openTimeComparison(trigger) {
    const origin = $('origin-select').value, destination = $('dest-select').value;
    if (!origin || !destination || origin === destination) return;
    timingRequest = { origin, destination, preference: $('preference').value, wheelchair: String($('wheelchair-access').checked), transferMinutes: $('transfer-minutes').value };
    const now = Date.now(), start = new Date(Math.ceil((now + 1000) / 1800000) * 1800000);
    $('timing-date').min = timingDay(now);
    $('timing-date').max = timingDay(now + 6 * 86400000);
    $('timing-date').value = timingDay(start);
    $('timing-time').value = time(start);
    $('timing-route').textContent = `${stationMap.get(origin)?.name || origin} → ${stationMap.get(destination)?.name || destination}`;
    openTimingShell(trigger);
    loadTimeComparison();
}
async function openRoadConditions(code, trigger) {
    if (!/^\d{5}$/.test(code)) return;
    const version = ++timingVersion;
    timingRequest = null;
    $('timing-route').textContent = `Bus stop ${code}`;
    openTimingShell(trigger, true);
    try {
        const data = await api(`/api/road-conditions?BusStopCode=${code}`);
        if (version !== timingVersion || !$('timing-dialog').open) return;
        $('timing-route').textContent = `${data.stop.name} · ${data.stop.code}`;
        $('timing-status').textContent = 'Live road reports are separate from bus occupancy.';
        $('timing-results').innerHTML = renderRoadConditions(data, data.stop.name);
    } catch (error) { if (version === timingVersion) { $('timing-status').textContent = error.message; $('timing-status').classList.add('error'); } }
}
$('compare-times-button').addEventListener('click', event => openTimeComparison(event.currentTarget));
$('timing-form').addEventListener('submit', loadTimeComparison);
for (const id of ['timing-date', 'timing-time']) $(id).addEventListener('input', () => {
    timingVersion++;
    $('timing-submit').disabled = false;
    $('timing-results').innerHTML = '';
    $('timing-status').classList.remove('error');
    $('timing-status').textContent = 'Press Compare times to check this window. All times are Singapore time.';
});
$('timing-close').addEventListener('click', () => $('timing-dialog').close());
$('timing-dialog').addEventListener('close', () => {
    timingVersion++;
    $('timing-submit').disabled = false;
    if (timingTrigger?.isConnected && timingTrigger.getClientRects().length) timingTrigger.focus({ preventScroll: true });
});
document.addEventListener('click', event => {
    const comparison = event.target.closest('[data-compare-times]'), road = event.target.closest('[data-road-stop]');
    if (comparison) openTimeComparison(comparison);
    if (road) openRoadConditions(road.dataset.roadStop, road);
    if (event.target.closest('#train-mode,#train-only-mode,#bus-mode,#clear-route-btn')) updateTimingEntry();
});
for (const id of ['origin-select', 'dest-select']) $(id).addEventListener('change', updateTimingEntry);
updateTimingEntry();
