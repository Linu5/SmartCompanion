const lta = require('./lta');
const rail = require('./rail');
const bus = require('./bus');
const access = require('./accessibility');
const locations = require('./locations');
const { journeySettings } = require('./preferences');
const { absoluteTime, liveAt } = require('./travel-times');
const patterns = require('./patterns');
const { dayContext } = patterns;

function operatingAt(row, at) {
    if (!row) return false;
    const parse = value => /^\d{4}$/.test(String(value)) ? Number(String(value).slice(0, 2)) * 60 + Number(String(value).slice(2)) : null;
    for (const offset of [0, -1]) {
        const date = new Date(new Date(at).getTime() + offset * 86400000), context = dayContext(date);
        const sg = new Date(date.getTime() + 8 * 3600000);
        const prefix = context.holiday || sg.getUTCDay() === 0 ? 'SUN' : sg.getUTCDay() === 6 ? 'SAT' : 'WD';
        const first = parse(row[`${prefix}_FirstBus`]), last = parse(row[`${prefix}_LastBus`]);
        if (first === null || last === null) continue;
        const minute = sg.getUTCHours() * 60 + sg.getUTCMinutes() - offset * 1440;
        if (minute >= first && minute <= last + (last < first ? 1440 : 0)) return true;
    }
    return false;
}
function endpointStops(location, stops, radius) {
    if (location.type === 'bus_stop') return stops.filter(row => row.BusStopCode === location.sourceId).map(row => ({ ...row, walkMeters: 0 }));
    return bus.nearby(stops, location, radius);
}
function connections(location, other, stations, stops, groups, settings, inbound) {
    const ends = endpointStops(location, stops, settings.maxWalk);
    const connectors = [];
    for (const station of stations) {
        const walkMeters = location.id === `station:${station.id}` ? 0 : Math.round(bus.distance(location, station) * 1.3);
        if (walkMeters <= settings.maxWalk) connectors.push({ station, walkMeters, walkMinutes: Math.ceil(walkMeters / settings.walkPace), bus: null });
    }
    const stationStops = new Map();
    for (const station of stations) for (const stop of bus.nearby(stops, station, Math.min(settings.maxWalk, 500))) {
        const items = stationStops.get(stop.BusStopCode) || [];
        items.push({ station, stop }); stationStops.set(stop.BusStopCode, items);
    }
    // Each bus candidate follows actual service direction and ordered stop sequence.
    const transferStops = [...stationStops.values()].map(items => ({ ...items[0].stop, walkMeters: 0 }));
    const candidates = inbound ? bus.directCandidates(groups, ends, transferStops, settings.walkPace) : bus.directCandidates(groups, transferStops, ends, settings.walkPace);
    for (const candidate of candidates) {
        const code = inbound ? candidate.alight.BusStopCode : candidate.board.BusStopCode;
        for (const { station, stop } of stationStops.get(code) || []) {
            if (location.id === `station:${station.id}`) continue;
            const c = { ...candidate, board: { ...candidate.board }, alight: { ...candidate.alight } };
            if (inbound) { c.alight.walkMeters = stop.walkMeters; c.alightWalkMinutes = Math.ceil(stop.walkMeters / settings.walkPace); }
            else { c.board.walkMeters = stop.walkMeters; c.boardWalkMinutes = Math.ceil(stop.walkMeters / settings.walkPace); }
            c.walkMinutes = c.boardWalkMinutes + c.alightWalkMinutes;
            const route = groups.get(`${c.service}:${c.direction}`);
            c.operating = route.find(row => row.BusStopCode === c.board.BusStopCode && route.slice(0, route.indexOf(row) + 1).filter(s => s.BusStopCode === c.board.BusStopCode).length === c.visit);
            connectors.push({ station, walkMeters: c.board.walkMeters + c.alight.walkMeters, walkMinutes: c.walkMinutes, bus: c });
        }
    }
    const score = c => c.walkMinutes + (c.bus ? c.bus.rideMinutes + 10 : 0) + bus.distance(c.station, other) / 500 + (settings.preference === 'walking' ? c.walkMinutes * 3 : 0);
    connectors.sort((a, b) => score(a) - score(b));
    const seen = new Set();
    const unique = connectors.filter(c => { const key = `${c.station.id}:${c.bus?.service || 'walk'}:${c.bus?.direction || ''}`; if (seen.has(key)) return false; seen.add(key); return true; });
    // Retain walk-only rail entries as well as a bounded set of bus feeders.
    return [...unique.filter(c => !c.bus).slice(0, 3), ...unique.filter(c => c.bus).slice(0, 5)];
}
function walkLeg(from, to, meters, pace) {
    return { type: 'walk', from, to, meters, minutes: Math.ceil(meters / pace), basis: 'distance-estimate', stepFreeVerified: false };
}
function busLeg(candidate, next, stops) {
    return { type: 'bus', service: candidate.service, direction: candidate.direction, from: locations.stopLocation(candidate.board), to: locations.stopLocation(candidate.alight), stops: candidate.stopCodes.map(code => stops.get(code)).filter(Boolean).map(locations.stopLocation), rideMinutes: candidate.rideMinutes, departureAt: next?.EstimatedArrival || null, load: next?.Load || null, wheelchair: next?.Feature === 'WAB', waitingConfirmed: !!next, basis: 'estimated' };
}
function railLegs(train, stations, now) {
    return train.legs.map(leg => ({ type: 'train', line: leg.line, headsign: leg.headsign, platform: leg.platform, from: locations.stationLocation(stations.get(leg.fromStation)), to: locations.stationLocation(stations.get(leg.toStation)), stops: leg.stations.map(id => locations.stationLocation(stations.get(id))), departureAt: absoluteTime(now, leg.departure), arrivalAt: absoluteTime(now, leg.arrival), basis: 'scheduled' }));
}
async function plan(query) {
    const settings = journeySettings(query), wheelchair = query.wheelchair === 'true', now = new Date();
    const [{ data, network }, stopFeed, routeFeed, notices, facilities] = await Promise.all([rail.getNetwork(now), lta.busStops(), lta.busRoutes(), lta.alerts().catch(() => null), wheelchair ? lta.facilities().catch(() => null) : null]);
    const all = [...network.stations.map(locations.stationLocation), ...stopFeed.data.map(locations.stopLocation)];
    const origin = locations.resolve(query.origin, all), destination = locations.resolve(query.destination, all);
    if (origin.id === destination.id) throw Object.assign(new Error('Choose two different locations.'), { statusCode: 400 });
    const groups = bus.groupRoutes(routeFeed.data), stops = new Map(stopFeed.data.map(s => [s.BusStopCode, s])), stations = new Map(network.stations.map(s => [s.id, s]));
    const starts = connections(origin, destination, network.stations, stopFeed.data, groups, settings, true);
    const ends = connections(destination, origin, network.stations, stopFeed.data, groups, settings, false);
    const direct = bus.directCandidates(groups, endpointStops(origin, stopFeed.data, settings.maxWalk), endpointStops(destination, stopFeed.data, settings.maxWalk), settings.walkPace).sort((a, b) => a.rideMinutes + a.walkMinutes - b.rideMinutes - b.walkMinutes).slice(0, 5);
    const codes = [...new Set([...starts, ...ends].filter(c => c.bus).map(c => c.bus.board.BusStopCode).concat(direct.map(c => c.board.BusStopCode)))];
    const feeds = new Map(await Promise.all(codes.map(async code => [code, await lta.arrivals(code).catch(() => null)])));
    const nextFor = (candidate, at) => {
        const feed = feeds.get(candidate.board.BusStopCode);
        return feed && !feed.stale ? bus.nextBoardable(feed.data.Services?.find(row => row.ServiceNo === candidate.service), candidate, at, wheelchair, settings.busCrowding) : null;
    };
    const blocked = Number(notices?.data.value?.Status) === 2 ? notices.data.value.AffectedSegments || [] : [];
    const maintenance = new Set(access.maintenanceByStation(network.stations, facilities).keys());
    const options = [], originTime = network.seconds, ms = now.getTime();
    for (const candidate of direct) {
        const next = nextFor(candidate, ms);
        if (!next) continue;
        options.push({ kind: 'bus', minutes: Math.ceil((Date.parse(next.EstimatedArrival) - ms) / 60000) + candidate.rideMinutes + candidate.alightWalkMinutes, unknownWait: false, transfers: 0, walkMinutes: candidate.walkMinutes, legs: [walkLeg(origin, locations.stopLocation(candidate.board), candidate.board.walkMeters, settings.walkPace), busLeg(candidate, next, stops), walkLeg(locations.stopLocation(candidate.alight), destination, candidate.alight.walkMeters, settings.walkPace)] });
    }
    for (const entry of starts) {
        const before = [], entryStation = locations.stationLocation(entry.station);
        let ready = originTime;
        if (entry.bus) {
            const next = nextFor(entry.bus, ms);
            if (!next || (wheelchair && maintenance.has(entry.station.id))) continue;
            before.push(walkLeg(origin, locations.stopLocation(entry.bus.board), entry.bus.board.walkMeters, settings.walkPace), busLeg(entry.bus, next, stops), walkLeg(locations.stopLocation(entry.bus.alight), entryStation, entry.bus.alight.walkMeters, settings.walkPace));
            ready += (Date.parse(next.EstimatedArrival) - ms) / 1000 + (entry.bus.rideMinutes + entry.bus.alightWalkMinutes + settings.transferMinutes) * 60;
        } else {
            before.push(walkLeg(origin, entryStation, entry.walkMeters, settings.walkPace));
            ready += (entry.walkMinutes + (entry.walkMeters ? settings.transferMinutes : 0)) * 60;
        }
        for (const exit of ends) {
            if (entry.station.id === exit.station.id || ready > originTime + 7200 || (wheelchair && exit.bus && maintenance.has(exit.station.id))) continue;
            const train = rail.findRoute(data, { ...network, seconds: ready }, entry.station.id, exit.station.id, blocked, settings.preference, { transferMinutes: settings.transferMinutes, avoidTransfersAt: wheelchair ? maintenance : undefined });
            if (!train) continue;
            const after = [], exitStation = locations.stationLocation(exit.station);
            let final = train.arrival, unknownWait = false;
            if (exit.bus) {
                final += settings.transferMinutes * 60;
                const at = ms + (final - originTime) * 1000, next = nextFor(exit.bus, at);
                if (!next && (wheelchair || settings.busCrowding !== 'any' || !operatingAt(exit.bus.operating, at + exit.bus.boardWalkMinutes * 60000))) continue;
                unknownWait = !next;
                after.push(walkLeg(exitStation, locations.stopLocation(exit.bus.board), exit.bus.board.walkMeters, settings.walkPace), busLeg(exit.bus, next, stops), walkLeg(locations.stopLocation(exit.bus.alight), destination, exit.bus.alight.walkMeters, settings.walkPace));
                final = next ? originTime + (Date.parse(next.EstimatedArrival) - ms) / 1000 : final + exit.bus.boardWalkMinutes * 60;
                final += (exit.bus.rideMinutes + exit.bus.alightWalkMinutes) * 60;
            } else {
                after.push(walkLeg(exitStation, destination, exit.walkMeters, settings.walkPace));
                final += (exit.walkMinutes + (exit.walkMeters ? settings.transferMinutes : 0)) * 60;
            }
            options.push({ kind: entry.bus || exit.bus ? 'combined' : 'train', minutes: Math.ceil((final - originTime) / 60), unknownWait, transfers: train.transfers + Number(!!entry.bus) + Number(!!exit.bus), walkMinutes: entry.walkMinutes + exit.walkMinutes, train, accessibility: wheelchair ? access.trainAccess(train, entry.station.id, exit.station.id, network.stations, facilities, settings.transferMinutes) : null, legs: [...before, ...railLegs(train, stations, now), ...after] });
        }
    }
    const score = option => option.minutes + (option.unknownWait ? 30 : 0) + (settings.preference === 'walking' ? option.walkMinutes * 4 : settings.preference === 'transfers' ? option.transfers * 15 : 0);
    options.sort((a, b) => score(a) - score(b));
    const unique = [], seen = new Set();
    for (const option of options) {
        option.legs = option.legs.filter(leg => leg.type !== 'walk' || leg.meters > 0);
        const key = option.legs.filter(leg => leg.type !== 'walk').map(leg => `${leg.service || leg.line}:${leg.from.id}:${leg.to.id}`).join('|');
        if (seen.has(key)) continue;
        seen.add(key); unique.push(option);
    }
    // Include a mixed option when it exists, even if a simple route ranks first.
    const selected = unique.slice(0, 3), mixed = unique.find(option => option.kind === 'combined');
    if (mixed && !selected.includes(mixed)) selected.splice(2, 1, mixed);
    const trainLines = [...new Set(selected.filter(option => option.train).map(option => option.train.legs[0].line))];
    const [crowds, history] = await Promise.all([Promise.all(trainLines.map(async line => [line, await lta.crowd(line).catch(() => null)])), selected.some(option => option.train) ? patterns.dataset('train', now).catch(() => null) : null]);
    const crowdMap = new Map(crowds);
    for (const option of selected.filter(option => option.train)) {
        const leg = option.train.legs[0], station = stations.get(leg.fromStation);
        option.stationCrowd = { ...liveAt(crowdMap.get(leg.line), leg.fromCode, now), station: station.name };
        option.pattern = patterns.profileAt(history, station.codes, absoluteTime(now, leg.departure));
    }
    return { mode: 'combined', origin, destination, options: selected, generatedAt: now.toISOString(), settings, wheelchair, alerts: notices ? { ...notices.data.value, meta: { updatedAt: notices.updatedAt, stale: notices.stale } } : null, stale: stopFeed.stale || routeFeed.stale || data.stale, note: 'Search covers direct buses and walking/bus connections to rail, including bus → train → bus. It checks a bounded set of nearby connections, so results are not an exhaustive fastest-route guarantee. Bus ride times use 18 km/h + 21 seconds per stop, not live traffic. Unknown transfer-bus waits are excluded from the displayed minimum. Walking is straight-line distance × 1.3, not verified street directions. Station entry/exit uses your transfer allowance. Train times are scheduled; check displays.' };
}
module.exports = { plan, operatingAt, endpointStops, connections, walkLeg, busLeg, railLegs };
