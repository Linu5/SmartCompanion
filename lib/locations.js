const axios = require('axios');
const lta = require('./lta');
const rail = require('./rail');
const { distance } = require('./bus');
const exitDataset = 'd_b39d3a0871985372d7e1637193335da5';
const invalid = message => Object.assign(new Error(message), { statusCode: 400 });
function point(lat, lon) {
    if (lat === '' || lon === '' || lat == null || lon == null || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon)) || Number(lat) < 1.13 || Number(lat) > 1.49 || Number(lon) < 103.59 || Number(lon) > 104.12) throw invalid('Choose a location in Singapore.');
    return { lat: Number(lat), lon: Number(lon) };
}
function stopLocation(stop) { return { id: `stop:${stop.BusStopCode}`, type: 'bus_stop', sourceId: stop.BusStopCode, name: stop.Description, detail: `${stop.BusStopCode} · ${stop.RoadName}`, lat: Number(stop.Latitude), lon: Number(stop.Longitude) }; }
function stationLocation(station) { return { id: `station:${station.id}`, type: 'station', sourceId: station.id, name: station.name, detail: station.codes.join(' / '), lat: station.lat, lon: station.lon, lines: station.lines }; }
async function all() {
    const [stops, { network }] = await Promise.all([lta.busStops(), rail.getNetwork()]);
    return [...network.stations.map(stationLocation), ...stops.data.map(stopLocation)];
}
function resolve(id, locations) {
    if (typeof id !== 'string' || id.length > 100) throw invalid('Choose a start and destination.');
    if (id.startsWith('point:')) {
        const parts = id.slice(6).split(',');
        if (parts.length !== 2) throw invalid('Choose a valid map point.');
        const p = point(...parts);
        return { ...p, id, type: 'address', name: 'Map location', detail: `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` };
    }
    const location = locations.find(row => row.id === id);
    if (!location) throw invalid('That stop or station is not in the current LTA data.');
    return location;
}
async function nearby(lat, lon) {
    const origin = point(lat, lon), locations = await all();
    const sorted = locations.map(row => ({ ...row, distanceMeters: Math.round(distance(origin, row)) })).filter(row => row.distanceMeters <= 2500).sort((a, b) => a.distanceMeters - b.distanceMeters);
    return { stations: sorted.filter(row => row.type === 'station').slice(0, 5), stops: sorted.filter(row => row.type === 'bus_stop').slice(0, 8), origin, radiusMeters: 2500, generatedAt: new Date().toISOString(), note: 'Distances are straight-line, not a measured walking route. Check crossings, entrances and lift access.' };
}
async function exits(stationId) {
    const { network } = await rail.getNetwork();
    const station = network.stations.find(row => row.id === stationId);
    if (!station) throw invalid('Choose an operating station.');
    const feed = await lta.cached('station-exits', 86400000, async () => {
        try {
            const result = await axios.get(`https://api-open.data.gov.sg/v1/public/api/datasets/${exitDataset}/poll-download`, { timeout: 15000 });
            const link = result.data?.data?.url, url = new URL(link);
            if (url.protocol !== 'https:' || !url.hostname.endsWith('.amazonaws.com')) throw new Error();
            const geo = (await axios.get(link, { timeout: 20000, maxContentLength: 6000000 })).data;
            if (!Array.isArray(geo.features)) throw new Error();
            return geo.features.filter(f => f.geometry?.type === 'Point').map(f => ({ station: f.properties.STATION_NA, label: f.properties.EXIT_CODE, lon: Number(f.geometry.coordinates[0]), lat: Number(f.geometry.coordinates[1]) }));
        } catch { throw new Error('Station exits are temporarily unavailable'); }
    }, true);
    const normal = name => String(name).toLowerCase().replace(/\b(mrt|lrt|station)\b/g, '').replace(/[^a-z0-9]/g, '');
    return { station: stationLocation(station), exits: feed.data.filter(row => normal(row.station) === normal(station.name) && distance(station, row) < 2000), source: 'LTA MRT Station Exit · data.gov.sg', sourceUrl: `https://data.gov.sg/datasets/${exitDataset}/view`, retrievedAt: feed.updatedAt, stale: feed.stale, stepFreeVerified: false };
}
module.exports = { point, all, resolve, nearby, exits, stationLocation, stopLocation };
