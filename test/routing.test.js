const { test } = require('node:test');
const assert = require('node:assert/strict');
const rail = require('../lib/rail');
const bus = require('../lib/bus');
const lta = require('../lib/lta');
const access = require('../lib/accessibility');

function fixture() {
    const stations = ['A', 'B', 'C', 'D'].map(id => [id, { id, name: id, platforms: [`${id}_1`], codes: [id] }]);
    const stopMap = new Map(stations.map(([id]) => [`${id}_1`, { stop_id: `${id}_1`, parent_station: id }]));
    const edge = (from, to, departure, arrival, line = 'EWL', fromCode = from, toCode = to) => ({ from: `${from}_1`, to: `${to}_1`, fromStation: from, toStation: to, fromCode, toCode, departure, arrival, line, trip: line, headsign: to });
    const graph = new Map([
        ['A_1', [edge('A', 'B', 60, 120, 'EWL', 'EW1', 'EW2'), edge('A', 'D', 60, 240, 'DTL', 'DT1', 'DT2')]],
        ['B_1', [edge('B', 'C', 150, 210, 'EWL', 'EW2', 'EW3')]],
        ['D_1', [edge('D', 'C', 270, 330, 'DTL', 'DT2', 'DT3')]]
    ]);
    return { data: { stationMap: new Map(stations), stopMap }, network: { graph, seconds: 0 } };
}

test('checks an intermediate station, then routes around its disrupted line', () => {
    const { data, network } = fixture();
    const usual = rail.findRoute(data, network, 'A', 'C');
    assert.deepEqual(usual.stationIds, ['A', 'B', 'C']);
    const alternative = rail.findRoute(data, network, 'A', 'C', [{ Line: 'EWL', Stations: 'EW2' }]);
    assert.deepEqual(alternative.stationIds, ['A', 'D', 'C']);
});
test('compares complete station codes, not partial substrings', () => {
    assert.equal(rail.affectedEdge({ line: 'EWL', fromCode: 'EW10', toCode: 'EW11' }, [{ Line: 'EWL', Stations: 'EW1' }]), false);
    assert.equal(rail.affectedEdge({ line: 'DTL', fromCode: 'EW1', toCode: 'DT2' }, [{ Line: 'EWL', Stations: 'EW1' }]), false);
});
test('checks every affected segment and handles missing station details', () => {
    assert.equal(rail.affectedEdge({ line: 'DTL', fromCode: 'DT1', toCode: 'DT2' }, [{ Line: 'EWL', Stations: 'EW1' }, { Line: 'DTL', Stations: 'DT2' }]), true);
    assert.equal(rail.affectedEdge({ line: 'EWL', fromCode: 'EW1', toCode: 'EW2' }, [{ Line: 'EWL' }]), true);
});
test('does not invent a train when departures have already passed', () => {
    const { data, network } = fixture();
    network.seconds = 1000;
    assert.equal(rail.findRoute(data, network, 'A', 'C'), null);
    assert.equal(rail.findRoute(data, network, 'A', 'A'), null);
});
test('service calendars respect weekdays, future service and date exceptions', () => {
    const rows = [
        { service_id: 'daily', start_date: '20260101', end_date: '20261231', thursday: '1' },
        { service_id: 'closed-loop', start_date: '20261019', end_date: '20261231', thursday: '1' }
    ];
    const day = { date: '20260910', weekday: 'thursday' };
    assert.deepEqual([...rail.activeServices(rows, [], day)], ['daily']);
    assert.deepEqual([...rail.activeServices(rows, [{ service_id: 'daily', date: day.date, exception_type: '2' }, { service_id: 'special', date: day.date, exception_type: '1' }], day)], ['special']);
});
test('Singapore date rolls over correctly and GTFS times can exceed midnight', () => {
    assert.equal(rail.singaporeDay(new Date('2026-09-10T16:10:00Z')).date, '20260911');
    assert.equal(rail.singaporeDay(new Date('2026-09-10T16:10:00Z'), -1).date, '20260910');
    assert.equal(rail.seconds('24:15:00'), 87300);
});
test('routes after midnight using the previous service day', () => {
    const { data } = fixture();
    data.stopMap.get('A_1').stop_code = 'EW1'; data.stopMap.get('B_1').stop_code = 'EW2';
    data.routes = new Map([['EWL', { route_color: '189E4A' }]]);
    data.trips = new Map([['late', { trip_id: 'late', service_id: 'thu', route_id: 'EWL', stops: [{ id: 'A_1', departure: 87300, arrival: 87300 }, { id: 'B_1', departure: 87600, arrival: 87600 }] }]]);
    data.calendar = [{ service_id: 'thu', start_date: '20260101', end_date: '20261231', thursday: '1' }];
    data.exceptions = [];
    const network = rail.buildNetwork(data, new Date('2026-09-10T16:10:00Z'));
    const route = rail.findRoute(data, network, 'A', 'B');
    assert.equal(route.duration, 10);
    assert.equal(route.departure, 900);
});

const stop = (code, walk = 0) => ({ BusStopCode: code, walkMeters: walk });
const routeRows = [
    { ServiceNo: '10', Direction: 1, StopSequence: 1, BusStopCode: '11111', Distance: 0 },
    { ServiceNo: '10', Direction: 1, StopSequence: 2, BusStopCode: '22222', Distance: 1 },
    { ServiceNo: '10', Direction: 1, StopSequence: 3, BusStopCode: '33333', Distance: 2 }
];
test('direct buses follow the correct stop order and real route distance', () => {
    const groups = bus.groupRoutes([...routeRows].reverse());
    const candidates = bus.directCandidates(groups, [stop('11111')], [stop('33333')]);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].km, 2);
    assert.equal(candidates[0].stops, 2);
    assert.equal(bus.directCandidates(groups, [stop('33333')], [stop('11111')]).length, 0);
});
test('bus matching rejects the opposite direction, early arrivals and wrong loop visits', () => {
    const now = Date.parse('2026-09-10T04:00:00Z');
    const candidate = { boardWalkMinutes: 5, originCode: '11111', destinationCode: '33333', visit: 1 };
    const prediction = (mins, changes = {}) => ({ EstimatedArrival: new Date(now + mins * 60000).toISOString(), OriginCode: '11111', DestinationCode: '33333', VisitNumber: '1', ...changes });
    assert.equal(bus.nextBoardable({ NextBus: prediction(2) }, candidate, now), null);
    assert.equal(bus.nextBoardable({ NextBus: prediction(8, { OriginCode: '33333' }) }, candidate, now), null);
    assert.equal(bus.nextBoardable({ NextBus: prediction(8, { VisitNumber: '2' }) }, candidate, now), null);
    assert.equal(bus.nextBoardable({ NextBus: prediction(8, { EstimatedArrival: 'invalid' }) }, candidate, now), null);
    const later = prediction(9);
    assert.equal(bus.nextBoardable({ NextBus: prediction(2), NextBus2: later }, candidate, now), later);
});
test('walking preference radius filters stops rather than making up nearby stops', () => {
    const stops = [{ BusStopCode: '11111', Latitude: 1.3, Longitude: 103.8 }, { BusStopCode: '22222', Latitude: 1.4, Longitude: 103.8 }];
    assert.deepEqual(bus.nearby(stops, { lat: 1.3, lon: 103.8 }, 450).map(s => s.BusStopCode), ['11111']);
});
test('cached real data is explicitly stale after a failed refresh', async () => {
    const key = `test-stale-${Date.now()}`;
    const fresh = await lta.cached(key, -1, async () => ({ actual: true }));
    const failed = await lta.cached(key, -1, async () => { throw new Error('network'); });
    assert.equal(fresh.stale, false);
    assert.equal(failed.stale, true);
    assert.deepEqual(failed.data, fresh.data);
    assert.equal(failed.updatedAt, fresh.updatedAt);
});
test('an unavailable feed with no cache fails instead of returning sample data', async () => {
    await assert.rejects(lta.cached(`test-unavailable-${Date.now()}`, 0, async () => { throw new Error('unavailable'); }), /unavailable/);
});

test('wheelchair mode selects a later confirmed WAB instead of an earlier unconfirmed bus', () => {
    const now = Date.parse('2026-09-10T04:00:00Z');
    const candidate = { boardWalkMinutes: 0, originCode: '11111', destinationCode: '33333', visit: 1 };
    const first = { EstimatedArrival: new Date(now + 60000).toISOString(), OriginCode: '11111', DestinationCode: '33333', VisitNumber: '1', Feature: '' };
    const later = { ...first, Feature: 'WAB', EstimatedArrival: new Date(now + 180000).toISOString() };
    assert.equal(bus.nextBoardable({ NextBus: first, NextBus2: later }, candidate, now, true), later);
    assert.equal(bus.nextBoardable({ NextBus: first }, candidate, now, true), null);
    assert.equal(bus.nextBoardable({ NextBus: first, NextBus2: later }, candidate, now, false), first);
});

test('wheelchair arrival filtering excludes unknown flags without changing cached source data', () => {
    const confirmed = { Feature: 'WAB', EstimatedArrival: '2026-09-10T12:01:00+08:00' };
    const unknown = { Feature: '', EstimatedArrival: '2026-09-10T12:00:00+08:00' };
    const source = { Services: [{ ServiceNo: '10', NextBus: unknown, NextBus2: confirmed }, { ServiceNo: '20', NextBus: unknown }] };
    const filtered = access.filterArrivals(source);
    assert.equal(filtered.Services.length, 1);
    assert.equal(filtered.Services[0].NextBus, null);
    assert.equal(filtered.Services[0].NextBus2, confirmed);
    assert.equal(source.Services[0].NextBus, unknown);
    assert.equal(source.Services.length, 2);
});

const accessStations = [
    { id: 'A', name: 'Origin', codes: ['EW1'] },
    { id: 'B', name: 'Interchange', codes: ['EW10', 'DT14'] },
    { id: 'C', name: 'Destination', codes: ['EW3'] }
];
const liftFeed = { data: { value: [{ StationCode: 'DT14', StationName: 'Interchange', LiftDesc: 'Exit lift', LiftID: 'L1' }] }, updatedAt: '2026-09-10T04:00:00Z', stale: false };
test('lift notices match interchange aliases and only flag access stations, not a pass-through', () => {
    assert.deepEqual([...access.maintenanceByStation(accessStations, liftFeed).keys()], ['B']);
    const through = { legs: [{ fromStation: 'A', toStation: 'C' }] };
    assert.equal(access.trainAccess(through, 'A', 'C', accessStations, liftFeed, 8).notices.length, 0);
    const changing = { legs: [{ fromStation: 'A', toStation: 'B' }, { fromStation: 'B', toStation: 'C' }] };
    const result = access.trainAccess(changing, 'A', 'C', accessStations, liftFeed, 8);
    assert.equal(result.notices[0].stationId, 'B');
    assert.equal(result.notices[0].atEndpoint, false);
    assert.equal(result.liftStatus, 'reported-maintenance');
    assert.equal(result.stepFreePathVerified, false);
});
test('lift outages at an endpoint stay visible and unavailable feeds never claim access is clear', () => {
    const result = access.trainAccess(null, 'B', 'C', accessStations, liftFeed, 8);
    assert.equal(result.notices[0].atEndpoint, true);
    assert.equal(access.trainAccess(null, 'A', 'C', accessStations, null, 8).liftStatus, 'unavailable');
    assert.equal(access.trainAccess(null, 'A', 'C', accessStations, { ...liftFeed, stale: true }, 8).liftStatus, 'stale');
});
test('extra transfer time changes the usable train and lift outages prevent a transfer', () => {
    const stationMap = new Map([
        ['A', { id: 'A', platforms: ['A1'] }], ['B', { id: 'B', platforms: ['B1', 'B2'] }], ['C', { id: 'C', platforms: ['C2'] }]
    ]);
    const stopMap = new Map([['A1', { parent_station: 'A' }], ['B1', { parent_station: 'B' }], ['B2', { parent_station: 'B' }], ['C2', { parent_station: 'C' }]]);
    const edge = (from, to, fromStation, toStation, departure, arrival, trip) => ({ from, to, fromStation, toStation, fromCode: fromStation, toCode: toStation, departure, arrival, trip, line: trip });
    const network = { seconds: 0, graph: new Map([
        ['A1', [edge('A1', 'B1', 'A', 'B', 60, 120, 'EWL')]],
        ['B2', [edge('B2', 'C2', 'B', 'C', 400, 500, 'DTL'), edge('B2', 'C2', 'B', 'C', 900, 1000, 'DTL')]]
    ]) };
    const data = { stationMap, stopMap };
    assert.equal(rail.findRoute(data, network, 'A', 'C', [], 'fastest').duration, 9);
    assert.equal(rail.findRoute(data, network, 'A', 'C', [], 'fastest', { transferMinutes: 8 }).duration, 17);
    assert.equal(rail.findRoute(data, network, 'A', 'C', [], 'fastest', { avoidTransfersAt: new Set(['B']) }), null);
});
test('a train can pass through a station with lift maintenance without transferring', () => {
    const { data, network } = fixture();
    assert.deepEqual(rail.findRoute(data, network, 'A', 'C', [], 'fastest', { avoidTransfersAt: new Set(['B']) }).stationIds, ['A', 'B', 'C']);
});
