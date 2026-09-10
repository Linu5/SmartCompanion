require('dotenv').config({ quiet: true });
const express = require('express');
const path = require('node:path');
const lta = require('./lib/lta');
const rail = require('./lib/rail');
const bus = require('./lib/bus');
const access = require('./lib/accessibility');

const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public')));
const validStop = value => typeof value === 'string' && /^\d{5}$/.test(value);
const validPreference = value => ['fastest', 'walking', 'transfers'].includes(value) ? value : 'fastest';
const provenance = result => ({ source: 'LTA DataMall', updatedAt: result.updatedAt, stale: result.stale });
const sendFeed = (res, result) => res.json({ ...result.data, meta: provenance(result) });

app.get('/api/health', (req, res) => res.json({ ok: true, keyConfigured: !!process.env.LTA_DATAMALL_API_KEY }));
app.get('/api/alerts', async (req, res) => sendFeed(res, await lta.alerts()));
app.get('/api/bus-arrival', async (req, res) => {
    if (!validStop(req.query.BusStopCode)) return res.status(400).json({ error: 'Enter a five-digit bus stop code.' });
    const result = await lta.arrivals(req.query.BusStopCode);
    const wheelchair = req.query.wheelchair === 'true';
    res.json({ ...(wheelchair ? access.filterArrivals(result.data) : result.data), meta: { ...provenance(result), wheelchairOnly: wheelchair } });
});
app.get('/api/bus-stops', async (req, res) => {
    const result = await lta.busStops();
    const query = String(req.query.q || req.query.BusStopCode || '').toLowerCase().slice(0, 100);
    const value = result.data.filter(s => !query || `${s.BusStopCode} ${s.Description} ${s.RoadName}`.toLowerCase().includes(query)).slice(0, 60);
    res.json({ value, meta: provenance(result) });
});
app.get('/api/bus-routes', async (req, res) => {
    const result = await lta.busRoutes();
    res.json({ value: result.data.filter(r => !req.query.ServiceNo || r.ServiceNo === req.query.ServiceNo), meta: provenance(result) });
});
app.get('/api/station-crowd', async (req, res) => {
    if (!['NSL', 'EWL', 'NEL', 'CCL', 'CEL', 'CGL', 'DTL', 'TEL', 'BPL', 'SLRT', 'PLRT'].includes(req.query.TrainLine)) return res.status(400).json({ error: 'Choose a supported train line.' });
    sendFeed(res, await lta.crowd(req.query.TrainLine));
});
app.get('/api/network', async (req, res) => {
    const { data, network } = await rail.getNetwork();
    res.json({ stations: network.stations, segments: network.segments, meta: { source: 'LTA GTFS timetable', updatedAt: data.updatedAt, stale: data.stale, validUntil: data.feed?.feed_end_date } });
});
app.get('/api/facilities', async (req, res) => sendFeed(res, await lta.facilities()));

app.get('/api/journey', async (req, res) => {
    const { origin, destination } = req.query;
    if (typeof origin !== 'string' || typeof destination !== 'string' || origin === destination) return res.status(400).json({ error: 'Choose two different stops or stations.' });
    const preference = validPreference(req.query.preference);
    const wheelchair = req.query.wheelchair === 'true';
    const transferMinutes = wheelchair && req.query.mode !== 'bus' ? Number(req.query.transferMinutes ?? 8) : 4;
    if (!Number.isInteger(transferMinutes) || transferMinutes < 4 || transferMinutes > 30) return res.status(400).json({ error: 'Choose a transfer allowance from 4 to 30 minutes.' });
    if (req.query.mode === 'bus') {
        if (!validStop(origin) || !validStop(destination)) return res.status(400).json({ error: 'Choose valid five-digit bus stops.' });
        const stops = await lta.busStops();
        const from = stops.data.find(s => s.BusStopCode === origin), to = stops.data.find(s => s.BusStopCode === destination);
        if (!from || !to) return res.status(404).json({ error: 'Bus stop not found in LTA data.' });
        const [options, notices] = await Promise.allSettled([bus.alternatives(from, to, preference, true, wheelchair), lta.alerts()]);
        if (options.status === 'rejected') throw options.reason;
        return res.json({ mode: 'bus', origin: from.Description, destination: to.Description, buses: options.value, accessibility: wheelchair ? { requested: true, stepFreePathVerified: false } : null, alerts: notices.status === 'fulfilled' ? { ...notices.value.data.value, meta: provenance(notices.value) } : null, generatedAt: new Date().toISOString() });
    }
    const { data, network } = await rail.getNetwork();
    const from = network.stations.find(s => s.id === origin), to = network.stations.find(s => s.id === destination);
    if (!from || !to) return res.status(400).json({ error: 'Choose stations in the current LTA timetable.' });
    const [notices, facilities] = await Promise.all([lta.alerts().catch(() => null), wheelchair ? lta.facilities().catch(() => null) : null]);
    const alert = notices?.data.value;
    const segments = Number(alert?.Status) === 2 ? alert.AffectedSegments || [] : [];
    const routingOptions = { transferMinutes };
    if (wheelchair) routingOptions.avoidTransfersAt = new Set(access.maintenanceByStation(network.stations, facilities).keys());
    const original = rail.findRoute(data, network, origin, destination, [], preference, routingOptions);
    const affected = !!original?.legs.some(leg => {
        for (let i = 0; i < leg.stationCodes.length - 1; i++) {
            if (rail.affectedEdge({ line: leg.line, fromCode: leg.stationCodes[i], toCode: leg.stationCodes[i + 1] }, segments)) return true;
        }
        return false;
    });
    const train = affected ? rail.findRoute(data, network, origin, destination, segments, preference, routingOptions) : original;
    const trainOnly = req.query.mode === 'train-only';
    const lines = [...new Set([...(train?.legs || []), ...(original?.legs || [])].map(leg => leg.line))];
    const [busResult, crowdResults] = await Promise.all([
        trainOnly ? { options: [] } : bus.alternatives(from, to, preference, false, wheelchair).catch(() => ({ options: [], error: 'Bus alternatives are unavailable. Try again shortly.' })),
        Promise.all(lines.map(async line => {
            try { const result = await lta.crowd(line); return { line, value: result.data.value, meta: provenance(result) }; }
            catch { return { line, value: [], error: 'Crowd data unavailable' }; }
        }))
    ]);
    res.json({ mode: trainOnly ? 'train-only' : 'train', origin: from.name, destination: to.name, train, affected, accessibility: wheelchair ? access.trainAccess(train, origin, destination, network.stations, facilities, transferMinutes) : null, noDetailedDisruption: Number(alert?.Status) === 2 && !segments.length, buses: busResult, crowd: crowdResults, alerts: alert ? { ...alert, meta: provenance(notices) } : null, timetable: { source: 'LTA GTFS timetable', updatedAt: data.updatedAt, stale: data.stale, validUntil: data.feed?.feed_end_date }, generatedAt: new Date().toISOString() });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
app.use((error, req, res, next) => {
    console.error(`Request failed: ${req.path}: ${error.message}`);
    res.status(503).json({ error: 'Transport data is temporarily unavailable. Please try again. No sample data is being shown.' });
});

if (require.main === module) {
    const port = process.env.PORT || 3000;
    app.listen(port, () => console.log(`Smart Commuter Companion running at http://localhost:${port}`));
}
module.exports = app;
