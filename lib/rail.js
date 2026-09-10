const fs = require('node:fs/promises');
const path = require('node:path');
const axios = require('axios');
const { unzipSync, strFromU8 } = require('fflate');
const { parse } = require('csv-parse/sync');
const lta = require('./lta');

function seconds(value) { return value.split(':').reduce((sum, part) => sum * 60 + Number(part), 0); }
function singaporeDay(now = new Date(), offset = 0) {
    const date = new Date(now.getTime() + 8 * 3600000 + offset * 86400000);
    return { date: date.toISOString().slice(0, 10).replaceAll('-', ''), weekday: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][date.getUTCDay()], seconds: date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds() };
}
function activeServices(calendar, exceptions, day) {
    const ids = new Set(calendar.filter(row => row.start_date <= day.date && row.end_date >= day.date && row[day.weekday] === '1').map(row => row.service_id));
    for (const row of exceptions.filter(row => row.date === day.date)) {
        if (row.exception_type === '1') ids.add(row.service_id); else ids.delete(row.service_id);
    }
    return ids;
}
function lineFor(route) {
    return ({ BP: 'BPL', SK: 'SLRT', PG: 'PLRT', EWL_CGL: 'CGL' })[route] || (route.startsWith('CCL') ? 'CCL' : route);
}
function decode(buffer) {
    const zip = unzipSync(new Uint8Array(buffer));
    const read = name => {
        const key = Object.keys(zip).find(key => key === name || key.endsWith(`/${name}`));
        return key ? parse(strFromU8(zip[key]), { columns: true, skip_empty_lines: true, bom: true }) : [];
    };
    const stops = read('stops.txt');
    const stopMap = new Map(stops.map(stop => [stop.stop_id, stop]));
    const stationMap = new Map(stops.filter(s => s.location_type === '1').map(s => [s.stop_id, { id: s.stop_id, name: s.stop_name, lat: Number(s.stop_lat), lon: Number(s.stop_lon), codes: [], platforms: [], lines: [] }]));
    for (const stop of stops.filter(s => s.location_type === '0')) {
        const station = stationMap.get(stop.parent_station || stop.stop_id);
        if (!station) continue;
        station.platforms.push(stop.stop_id);
        if (!station.codes.includes(stop.stop_code)) station.codes.push(stop.stop_code);
    }
    // LTA represents the MRT/LRT sides of these interchanges as separate parents.
    // Merge their platforms, preserving the four-minute transfer in the router.
    for (const [keep, merge] of [['NS4', 'BP1'], ['DT1', 'BP6']]) {
        const main = stationMap.get(keep), other = stationMap.get(merge);
        if (!main || !other || main.name !== other.name) continue;
        main.codes.push(...other.codes);
        main.platforms.push(...other.platforms);
        for (const platform of other.platforms) stopMap.get(platform).parent_station = keep;
        stationMap.delete(merge);
    }
    const routes = new Map(read('routes.txt').map(r => [r.route_id, r]));
    const trips = new Map(read('trips.txt').map(t => [t.trip_id, { ...t, stops: [] }]));
    for (const row of read('stop_times.txt')) {
        const trip = trips.get(row.trip_id);
        if (trip && stopMap.has(row.stop_id)) trip.stops.push({ id: row.stop_id, sequence: Number(row.stop_sequence), arrival: seconds(row.arrival_time), departure: seconds(row.departure_time) });
    }
    for (const trip of trips.values()) trip.stops.sort((a, b) => a.sequence - b.sequence);
    return { stopMap, stationMap, routes, trips, calendar: read('calendar.txt'), exceptions: read('calendar_dates.txt'), feed: read('feed_info.txt')[0] };
}

let parsed;
let refreshPromise;
async function dataset() {
    if (parsed && Date.now() - parsed.loadedAt < 86400000) return parsed;
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
        const file = path.join(lta.cacheDirectory, 'gtfs.zip');
        let buffer, stat, stale = false;
        try { stat = await fs.stat(file); buffer = await fs.readFile(file); } catch { /* First launch. */ }
        if (!buffer || Date.now() - stat.mtimeMs > 86400000) {
            try {
                const result = await lta.request('GTFSScheduleTrain');
                const link = result.value?.[0]?.link || result.value?.[0]?.Link;
                const url = new URL(link);
                if (url.protocol !== 'https:' || !url.hostname.endsWith('.amazonaws.com')) throw new Error('Unexpected schedule download URL');
                buffer = (await axios.get(link, { responseType: 'arraybuffer', timeout: 30000, maxContentLength: 25000000 })).data;
                await fs.mkdir(lta.cacheDirectory, { recursive: true });
                await fs.writeFile(`${file}.tmp`, buffer);
                await fs.rename(`${file}.tmp`, file);
                stat = await fs.stat(file);
            } catch {
                if (!buffer) throw new Error('Train timetable unavailable. Try again shortly.');
                stale = true;
            }
        }
        parsed = { ...decode(buffer), loadedAt: Date.now(), updatedAt: stat.mtime.toISOString(), stale };
        return parsed;
    })().finally(() => { refreshPromise = null; });
    return refreshPromise;
}

function buildNetwork(data, now = new Date()) {
    const current = singaporeDay(now);
    const graph = new Map();
    const activeStations = new Set();
    const segments = new Map();
    const platformLines = new Map();
    for (const offset of [-1, 0, 1]) {
        const services = activeServices(data.calendar, data.exceptions, singaporeDay(now, offset));
        for (const trip of data.trips.values()) {
            if (!services.has(trip.service_id)) continue;
            const route = data.routes.get(trip.route_id);
            const line = lineFor(trip.route_id);
            for (let i = 0; i < trip.stops.length - 1; i++) {
                const from = trip.stops[i], to = trip.stops[i + 1];
                const fromStop = data.stopMap.get(from.id), toStop = data.stopMap.get(to.id);
                const fromStation = fromStop.parent_station || fromStop.stop_id;
                const toStation = toStop.parent_station || toStop.stop_id;
                if (!data.stationMap.has(fromStation) || !data.stationMap.has(toStation)) continue;
                if (offset === 0) {
                    activeStations.add(fromStation); activeStations.add(toStation);
                    segments.set(`${fromStation}:${toStation}:${line}`, { from: fromStation, to: toStation, line, color: `#${route.route_color}` });
                }
                for (const id of [from.id, to.id]) {
                    if (!platformLines.has(id)) platformLines.set(id, new Set());
                    platformLines.get(id).add(line);
                }
                const departure = from.departure + offset * 86400;
                const arrival = to.arrival + offset * 86400;
                if (arrival < current.seconds || departure > current.seconds + 10800 || arrival < departure) continue;
                if (!graph.has(from.id)) graph.set(from.id, []);
                graph.get(from.id).push({ from: from.id, to: to.id, fromStation, toStation, fromCode: fromStop.stop_code, toCode: toStop.stop_code, departure, arrival, trip: `${trip.trip_id}:${offset}`, line, headsign: trip.trip_headsign, platform: fromStop.platform_code, color: `#${route.route_color}` });
            }
        }
    }
    for (const edges of graph.values()) edges.sort((a, b) => a.departure - b.departure);
    const stations = [...data.stationMap.values()].filter(s => activeStations.has(s.id)).map(s => ({ ...s, lines: [...new Set(s.platforms.flatMap(p => [...(platformLines.get(p) || [])]))] })).sort((a, b) => a.name.localeCompare(b.name));
    return { graph, stations, segments: [...segments.values()], platformLines, seconds: current.seconds };
}

function affectedEdge(edge, segments = []) {
    return segments.some(segment => {
        const line = ({ CEL: 'CCL' })[segment.Line] || segment.Line;
        if (line && line !== edge.line && !(line === 'EWL' && edge.line === 'CGL')) return false;
        const codes = (segment.Stations || '').match(/[A-Z]+\d+[A-Z]?|STC|PTC/g) || [];
        return !codes.length || codes.includes(edge.fromCode) || codes.includes(edge.toCode);
    });
}

function findRoute(data, network, origin, destination, blocked = [], preference = 'fastest', options = {}) {
    const transferSeconds = (options.transferMinutes || 4) * 60;
    const start = data.stationMap.get(origin), end = data.stationMap.get(destination);
    if (!start || !end || origin === destination) return null;
    // State includes transfer count; fewer-transfers routing remains time-feasible.
    const states = new Map();
    const queue = [];
    for (const platform of start.platforms) {
        const state = { id: platform, transfers: 0, time: network.seconds, previous: null, edge: null };
        states.set(`${platform}:0`, state); queue.push(state);
    }
    let finish;
    const priority = s => s.time + (preference === 'transfers' ? s.transfers * 900 : 0);
    const relax = (state, id, time, transfers, edge) => {
        if (transfers > 5 || time > network.seconds + 10800) return;
        const key = `${id}:${transfers}`;
        if (!states.has(key) || time < states.get(key).time) {
            const next = { id, time, transfers, previous: state, edge };
            states.set(key, next); queue.push(next);
        }
    };
    while (queue.length) {
        queue.sort((a, b) => priority(a) - priority(b));
        const state = queue.shift();
        if (states.get(`${state.id}:${state.transfers}`) !== state) continue;
        if (end.platforms.includes(state.id)) { finish = state; break; }
        const candidates = new Map();
        for (const edge of network.graph.get(state.id) || []) {
            if (edge.departure < state.time || affectedEdge(edge, blocked)) continue;
            if (!candidates.has(edge.to) || candidates.get(edge.to).arrival > edge.arrival) candidates.set(edge.to, edge);
        }
        for (const edge of candidates.values()) relax(state, edge.to, edge.arrival, state.transfers, edge);
        const stop = data.stopMap.get(state.id);
        const station = data.stationMap.get(stop?.parent_station || stop?.stop_id);
        // A transfer is possible only after arriving by train, never as a free initial shortcut.
        if (state.previous && station && !options.avoidTransfersAt?.has(station.id)) {
            for (const platform of station.platforms) {
                if (platform !== state.id) relax(state, platform, state.time + transferSeconds, state.transfers + 1, { transfer: true, fromStation: station.id, toStation: station.id, departure: state.time, arrival: state.time + transferSeconds });
            }
        }
    }
    if (!finish) return null;
    const edges = [];
    for (let cursor = finish; cursor.previous; cursor = cursor.previous) edges.unshift(cursor.edge);
    const rides = edges.filter(e => !e.transfer);
    if (!rides.length) return null;
    const legs = [];
    for (const edge of rides) {
        let leg = legs.at(-1);
        if (!leg || leg.trip !== edge.trip) {
            leg = { ...edge, stations: [edge.fromStation], stationCodes: [edge.fromCode], stops: 0 };
            legs.push(leg);
        }
        leg.to = edge.to; leg.toCode = edge.toCode; leg.toStation = edge.toStation; leg.arrival = edge.arrival; leg.stations.push(edge.toStation); leg.stationCodes.push(edge.toCode); leg.stops++;
    }
    return { type: 'train', duration: Math.ceil((finish.time - network.seconds) / 60), departure: rides[0].departure, arrival: finish.time, transfers: legs.length - 1, transferMinutes: transferSeconds / 60, stops: rides.length, legs, stationIds: [...new Set(rides.flatMap(e => [e.fromStation, e.toStation]))], affected: rides.some(e => affectedEdge(e, blocked)), basis: 'scheduled' };
}

let networkCache;
async function getNetwork(now = new Date()) {
    const data = await dataset();
    const key = `${Math.floor(now.getTime() / 30000)}:${data.updatedAt}`;
    if (!networkCache || networkCache.key !== key) networkCache = { key, network: buildNetwork(data, now) };
    return { data, network: networkCache.network };
}

module.exports = { getNetwork, findRoute, affectedEdge, activeServices, singaporeDay, seconds, buildNetwork, decode };
