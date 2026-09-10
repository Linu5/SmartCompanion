const lta = require('./lta');
const { wheelchairBus } = require('./accessibility');

function distance(a, b) {
    const rad = n => n * Math.PI / 180;
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function nearby(stops, point, radius) {
    return stops.map(stop => ({ ...stop, walkMeters: Math.round(distance(point, { lat: stop.Latitude, lon: stop.Longitude }) * 1.3) }))
        .filter(stop => stop.walkMeters <= radius).sort((a, b) => a.walkMeters - b.walkMeters).slice(0, 12);
}
function groupRoutes(rows) {
    const groups = new Map();
    for (const row of rows) {
        const key = `${row.ServiceNo}:${row.Direction}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    }
    for (const route of groups.values()) route.sort((a, b) => Number(a.StopSequence) - Number(b.StopSequence));
    return groups;
}
function directCandidates(groups, origins, destinations) {
    const originMap = new Map(origins.map(s => [s.BusStopCode, s]));
    const destinationMap = new Map(destinations.map(s => [s.BusStopCode, s]));
    const candidates = [];
    for (const route of groups.values()) {
        for (let i = 0; i < route.length - 1; i++) {
            const board = originMap.get(route[i].BusStopCode);
            if (!board) continue;
            for (let j = i + 1; j < route.length; j++) {
                const alight = destinationMap.get(route[j].BusStopCode);
                const km = Number(route[j].Distance) - Number(route[i].Distance);
                if (!alight || board.BusStopCode === alight.BusStopCode || !(km > 0)) continue;
                const walkMinutes = Math.ceil((board.walkMeters + alight.walkMeters) / 75);
                // Planning estimate, not an LTA bus journey-time field.
                const rideMinutes = Math.ceil(km / 18 * 60 + (j - i) * 0.35);
                candidates.push({ service: route[i].ServiceNo, direction: route[i].Direction, board, alight, stops: j - i, km: Math.round(km * 10) / 10, walkMinutes, rideMinutes, boardWalkMinutes: Math.ceil(board.walkMeters / 75), alightWalkMinutes: Math.ceil(alight.walkMeters / 75), originCode: route[0].BusStopCode, destinationCode: route.at(-1).BusStopCode, visit: route.slice(0, i + 1).filter(s => s.BusStopCode === board.BusStopCode).length, stopCodes: route.slice(i, j + 1).map(s => s.BusStopCode) });
            }
        }
    }
    return candidates;
}
function nextBoardable(service, candidate, now = Date.now(), wheelchair = false) {
    if (!service) return null;
    return ['NextBus', 'NextBus2', 'NextBus3'].map(key => service[key]).filter(bus => {
        if (wheelchair && !wheelchairBus(bus)) return false;
        if (!bus?.EstimatedArrival || !Number.isFinite(Date.parse(bus.EstimatedArrival)) || Date.parse(bus.EstimatedArrival) < now + candidate.boardWalkMinutes * 60000) return false;
        // Avoid the wrong direction or wrong visit on a loop service.
        if (!bus.OriginCode || !bus.DestinationCode) return false;
        if (bus.OriginCode !== candidate.originCode || bus.DestinationCode !== candidate.destinationCode) return false;
        if (candidate.visit > 1 && Number(bus.VisitNumber) !== candidate.visit) return false;
        if (bus.VisitNumber && Number(bus.VisitNumber) !== candidate.visit) return false;
        return true;
    }).sort((a, b) => Date.parse(a.EstimatedArrival) - Date.parse(b.EstimatedArrival))[0] || null;
}

async function alternatives(origin, destination, preference = 'fastest', exactStops = false, wheelchair = false) {
    const [stopResult, routeResult] = await Promise.all([lta.busStops(), lta.busRoutes()]);
    const stops = stopResult.data;
    const radius = preference === 'walking' ? 450 : 1000;
    const origins = exactStops ? [{ ...origin, walkMeters: 0 }] : nearby(stops, origin, radius);
    const destinations = exactStops ? [{ ...destination, walkMeters: 0 }] : nearby(stops, destination, radius);
    const groups = groupRoutes(routeResult.data);
    const ranked = directCandidates(groups, origins, destinations).sort((a, b) => {
        if (preference === 'walking' && a.walkMinutes !== b.walkMinutes) return a.walkMinutes - b.walkMinutes;
        return a.walkMinutes + a.rideMinutes - b.walkMinutes - b.rideMinutes;
    });
    const seen = new Set();
    const unique = ranked.filter(c => {
        const key = `${c.service}:${c.direction}`;
        if (seen.has(key)) return false;
        seen.add(key); return true;
    }).slice(0, 10);
    const boardCodes = [...new Set(unique.map(c => c.board.BusStopCode))];
    const feeds = new Map(await Promise.all(boardCodes.map(async code => {
        try { return [code, await lta.arrivals(code)]; } catch { return [code, null]; }
    })));
    const stopMap = new Map(stops.map(s => [s.BusStopCode, s]));
    const options = unique.map(candidate => {
        const feed = feeds.get(candidate.board.BusStopCode);
        const service = feed?.data.Services?.find(s => s.ServiceNo === candidate.service);
        const next = feed && !feed.stale ? nextBoardable(service, candidate, Date.now(), wheelchair) : null;
        const untilBus = next ? Math.max(0, Math.ceil((Date.parse(next.EstimatedArrival) - Date.now()) / 60000)) : null;
        return { ...candidate, type: 'bus', next, waitMinutes: untilBus, duration: untilBus === null ? null : untilBus + candidate.rideMinutes + candidate.alightWalkMinutes, available: !!next, updatedAt: feed?.updatedAt || null, stale: !!feed?.stale, basis: 'estimated', coordinates: candidate.stopCodes.map(c => stopMap.get(c)).filter(Boolean).map(s => [s.Latitude, s.Longitude]) };
    }).filter(option => !wheelchair || !!option.next).sort((a, b) => {
        if (a.available !== b.available) return Number(b.available) - Number(a.available);
        if (preference === 'walking' && a.walkMinutes !== b.walkMinutes) return a.walkMinutes - b.walkMinutes;
        return (a.duration ?? Infinity) - (b.duration ?? Infinity) || a.rideMinutes - b.rideMinutes;
    }).slice(0, 3);
    return { options, radius, nearby: origins, updatedAt: routeResult.updatedAt, stale: routeResult.stale || stopResult.stale, note: 'Direct buses only. Walking uses straight-line distance × 1.3 at 75 m/min; ride estimates use route distance at 18 km/h plus 21 seconds per stop. Check the pedestrian route and boarding stop.' };
}

module.exports = { alternatives, distance, nearby, groupRoutes, directCandidates, nextBoardable };
