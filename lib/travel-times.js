const rail = require('./rail');
const lta = require('./lta');
const access = require('./accessibility');
const { distance } = require('./bus');
const { transferAllowance } = require('./preferences');
const patterns = require('./patterns');
const HALF_HOUR = 1800000;
const DAY = 86400000;
const levels = new Set(['l', 'm', 'h']);
const sgDate = value => new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 10);
const inputError = message => Object.assign(new Error(message), { statusCode: 400 });

function parseStart(value, now = new Date()) {
    if (value === undefined || value === '') return new Date(Math.ceil(now.getTime() / HALF_HOUR) * HALF_HOUR);
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:(00|30):00\+08:00$/.test(value)) throw inputError('Choose a date and a half-hour start time in Singapore time.');
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || sgDate(date) !== value.slice(0, 10)) throw inputError('Choose a valid date.');
    if (date.getTime() < now.getTime()) throw inputError('That start time has passed. Choose a later time.');
    if (date.getTime() > now.getTime() + 7 * DAY) throw inputError('Compare times within the next seven days.');
    return date;
}

function forecastAt(feed, code, at) {
    const unavailable = { level: null, status: 'unavailable', stationCode: code, retrievedAt: feed?.updatedAt || null };
    if (!feed || !code) return unavailable;
    const ms = new Date(at).getTime();
    for (const day of feed.data?.value || []) {
        if (!Number.isFinite(Date.parse(day.Date)) || sgDate(day.Date) !== sgDate(at)) continue;
        const station = day.Stations?.find(row => row.Station === code);
        const interval = station?.Interval?.find(row => {
            const start = Date.parse(row.Start);
            return Number.isFinite(start) && sgDate(row.Start) === sgDate(at) && ms >= start && ms < start + HALF_HOUR;
        });
        if (interval && levels.has(interval.CrowdLevel)) return {
            level: interval.CrowdLevel, status: feed.stale ? 'stale' : 'forecast', stationCode: code,
            intervalStart: interval.Start, intervalEnd: new Date(Date.parse(interval.Start) + HALF_HOUR).toISOString(), retrievedAt: feed.updatedAt
        };
    }
    return unavailable;
}

function liveAt(feed, code, now = new Date()) {
    const row = feed?.data?.value?.filter(row => row.Station === code && levels.has(row.CrowdLevel) && Number.isFinite(Date.parse(row.StartTime)) && Date.parse(row.EndTime) > Date.parse(row.StartTime) && Date.parse(row.StartTime) <= now.getTime())
        .sort((a, b) => Date.parse(b.StartTime) - Date.parse(a.StartTime))[0];
    if (!row) return { level: null, status: 'unavailable', stationCode: code };
    return { level: row.CrowdLevel, status: feed.stale || now.getTime() >= Date.parse(row.EndTime) ? 'stale' : 'live', stationCode: code, intervalStart: row.StartTime, intervalEnd: row.EndTime, retrievedAt: feed.updatedAt };
}

function nearbyIncidents(rows, point, radiusMeters = 1500) {
    return rows.flatMap(row => {
        if (row.Latitude == null || row.Longitude == null || row.Latitude === '' || row.Longitude === '' || !Number.isFinite(Number(row.Latitude)) || !Number.isFinite(Number(row.Longitude)) || Math.abs(Number(row.Latitude)) > 90 || Math.abs(Number(row.Longitude)) > 180) return [];
        const meters = distance(point, { lat: Number(row.Latitude), lon: Number(row.Longitude) });
        return meters <= radiusMeters ? [{ type: String(row.Type || 'Road incident'), message: String(row.Message || ''), distanceMeters: Math.round(meters) }] : [];
    }).sort((a, b) => a.distanceMeters - b.distanceMeters);
}

function absoluteTime(base, seconds) {
    return new Date(new Date(`${sgDate(base)}T00:00:00+08:00`).getTime() + seconds * 1000).toISOString();
}
function summariseTrain(train, base, stations) {
    if (!train) return null;
    return {
        duration: train.duration, departureAt: absoluteTime(base, train.departure), arrivalAt: absoluteTime(base, train.arrival), transfers: train.transfers, transferMinutes: train.transferMinutes, stops: train.stops,
        legs: train.legs.map(leg => ({ line: leg.line, headsign: leg.headsign, from: stations.get(leg.fromStation)?.name || leg.fromStation, to: stations.get(leg.toStation)?.name || leg.toStation, departureAt: absoluteTime(base, leg.departure), arrivalAt: absoluteTime(base, leg.arrival), platform: leg.platform || null, stops: leg.stops }))
    };
}

async function roadConditions(point, api = lta) {
    try {
        const result = await api.incidents();
        return { status: result.stale ? 'stale' : 'live', radiusMeters: 1500, incidents: nearbyIncidents(result.data, point), retrievedAt: result.updatedAt, source: 'LTA Traffic Incidents' };
    } catch {
        return { status: 'unavailable', radiusMeters: 1500, incidents: [], retrievedAt: null, source: 'LTA Traffic Incidents' };
    }
}

async function compareTimes(options, dependencies = {}) {
    const railApi = dependencies.rail || rail, feeds = dependencies.lta || lta;
    const now = dependencies.now || new Date();
    const start = parseStart(options.start, now);
    if (typeof options.origin !== 'string' || typeof options.destination !== 'string' || options.origin === options.destination) throw inputError('Choose two different stations to compare times.');
    const wheelchair = options.wheelchair === 'true';
    const transferMinutes = transferAllowance(options.transferMinutes, wheelchair);
    const preference = options.preference === 'transfers' ? 'transfers' : 'fastest';
    const { data, network: firstNetwork } = await railApi.getNetwork(start);
    const origin = firstNetwork.stations.find(s => s.id === options.origin), destination = firstNetwork.stations.find(s => s.id === options.destination);
    if (!origin || !destination) throw inputError('These stations are not in the timetable for the selected date.');
    const [notices, facilities, traffic, history] = await Promise.all([
        feeds.alerts().catch(() => null), wheelchair ? feeds.facilities().catch(() => null) : null, roadConditions(origin, feeds),
        dependencies.lta ? Promise.resolve(null) : patterns.dataset('train', now).catch(() => null)
    ]);
    const alert = notices?.data.value;
    const blocked = Number(alert?.Status) === 2 ? alert.AffectedSegments || [] : [];
    const routingOptions = { transferMinutes };
    if (wheelchair) routingOptions.avoidTransfersAt = new Set(access.maintenanceByStation(firstNetwork.stations, facilities).keys());
    const slots = Array.from({ length: 6 }, (_, index) => {
        const at = new Date(start.getTime() + index * HALF_HOUR);
        const network = index ? railApi.buildNetwork(data, at) : firstNetwork;
        const day = sgDate(at).replaceAll('-', '');
        const covered = (!data.feed?.feed_start_date || day >= data.feed.feed_start_date) && (!data.feed?.feed_end_date || day <= data.feed.feed_end_date);
        const train = covered ? railApi.findRoute(data, network, origin.id, destination.id, blocked, preference, routingOptions) : null;
        return { at: at.toISOString(), train, timetableCovered: covered };
    });
    const fallbackLine = origin.lines[0];
    const fallbackPlatform = origin.platforms.find(id => firstNetwork.platformLines.get(id)?.has(fallbackLine));
    const fallbackCode = data.stopMap.get(fallbackPlatform)?.stop_code || null;
    const lines = [...new Set(slots.map(slot => slot.train?.legs[0]?.line || fallbackLine).filter(Boolean))];
    const forecastFeeds = new Map(await Promise.all(lines.map(async line => [line, await feeds.crowdForecast(line).catch(() => null)])));
    const firstLeg = slots.find(slot => slot.train)?.train.legs[0];
    const liveLine = firstLeg?.line || fallbackLine, liveCode = firstLeg?.fromCode || fallbackCode;
    const liveFeed = liveLine ? await feeds.crowd(liveLine).catch(() => null) : null;
    return {
        origin: { id: origin.id, name: origin.name }, destination: { id: destination.id, name: destination.name },
        generatedAt: now.toISOString(), intervalMinutes: 30,
        live: { ...liveAt(liveFeed, liveCode, now), line: liveLine }, traffic,
        slots: slots.map(slot => {
            const line = slot.train?.legs[0]?.line || fallbackLine, code = slot.train?.legs[0]?.fromCode || fallbackCode;
            return {
                at: slot.at, timetableCovered: slot.timetableCovered, train: summariseTrain(slot.train, slot.at, data.stationMap),
                crowd: { ...forecastAt(forecastFeeds.get(line), code, slot.at), line },
                pattern: patterns.profileAt(history, origin.codes, slot.at),
                accessibility: wheelchair ? access.trainAccess(slot.train, origin.id, destination.id, firstNetwork.stations, facilities, transferMinutes) : null
            };
        }),
        timetable: { source: 'LTA GTFS timetable', retrievedAt: data.updatedAt, stale: data.stale, validUntil: data.feed?.feed_end_date },
        advisories: { available: !!notices && !notices.stale, disruptionReported: Number(alert?.Status) === 2, messages: alert?.Message || [], retrievedAt: notices?.updatedAt || null },
        forecastSource: 'LTA Station Crowd Density Forecast'
    };
}

module.exports = { parseStart, forecastAt, liveAt, nearbyIncidents, absoluteTime, summariseTrain, roadConditions, compareTimes };
