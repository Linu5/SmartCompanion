const { test } = require('node:test');
const assert = require('node:assert/strict');
const times = require('../lib/travel-times');
const rail = require('../lib/rail');
const now = new Date('2026-09-13T08:05:00+08:00');
const envelope = data => ({ data, updatedAt: now.toISOString(), stale: false });
const forecast = () => envelope({ value: [{ Date: '2026-09-13T00:00:00+08:00', Stations: [{ Station: 'EW1', Interval: [
    { Start: '2026-09-13T08:30:00+08:00', CrowdLevel: 'h' },
    { Start: '2026-09-13T09:00:00+08:00', CrowdLevel: 'l' },
    { Start: '2026-09-13T09:30:00+08:00', CrowdLevel: 'NA' }
] }] }] });

test('forecast lookup respects station, date and exclusive half-hour boundaries', () => {
    assert.equal(times.forecastAt(forecast(), 'EW1', '2026-09-13T08:59:59+08:00').level, 'h');
    assert.equal(times.forecastAt(forecast(), 'EW1', '2026-09-13T09:00:00+08:00').level, 'l');
    for (const at of ['2026-09-13T08:00:00+08:00', '2026-09-13T09:30:00+08:00', '2026-09-14T09:00:00+08:00']) {
        assert.equal(times.forecastAt(forecast(), 'EW1', at).status, 'unavailable');
    }
    assert.equal(times.forecastAt(forecast(), 'EW10', '2026-09-13T09:00:00+08:00').level, null);
    assert.equal(times.forecastAt(null, 'EW1', now).level, null);
    assert.equal(times.forecastAt({ ...forecast(), stale: true }, 'EW1', '2026-09-13T09:00:00+08:00').status, 'stale');
});

test('live readings cannot use future intervals or pretend expired data is current', () => {
    const row = { Station: 'EW1', StartTime: '2026-09-13T08:00:00+08:00', EndTime: '2026-09-13T08:10:00+08:00', CrowdLevel: 'm' };
    const feed = envelope({ value: [row, { ...row, StartTime: '2026-09-13T08:10:00+08:00', EndTime: '2026-09-13T08:20:00+08:00', CrowdLevel: 'h' }] });
    assert.equal(times.liveAt(feed, 'EW1', now).level, 'm');
    assert.equal(times.liveAt(feed, 'EW1', now).status, 'live');
    assert.equal(times.liveAt(feed, 'EW1', new Date('2026-09-13T08:20:00+08:00')).status, 'stale');
    assert.equal(times.liveAt({ ...feed, stale: true }, 'EW1', now).status, 'stale');
    assert.equal(times.liveAt(feed, 'EW2', now).status, 'unavailable');
    assert.equal(times.liveAt(envelope({ value: [{ ...row, EndTime: row.StartTime }] }), 'EW1', now).level, null);
});

test('start validation uses Singapore time, future half-hours and a bounded date range', () => {
    assert.equal(times.parseStart(undefined, now).toISOString(), '2026-09-13T00:30:00.000Z');
    assert.equal(times.parseStart(undefined, new Date('2026-09-13T23:59:00+08:00')).toISOString(), '2026-09-13T16:00:00.000Z');
    assert.equal(times.parseStart('2026-09-14T08:30:00+08:00', now).toISOString(), '2026-09-14T00:30:00.000Z');
    for (const value of [[], {}, 'bad', '2026-09-13T08:00:00+08:00', '2026-09-13T08:31:00+08:00', '2026-09-13T08:30:00Z', '2026-09-21T08:30:00+08:00', '2026-09-31T08:30:00+08:00', '2026-09-13T24:00:00+08:00']) {
        assert.throws(() => times.parseStart(value, now), { statusCode: 400 });
    }
});

test('GTFS times beyond midnight serialize to the next Singapore date', () => {
    assert.equal(times.absoluteTime(now, 25 * 3600), '2026-09-13T17:00:00.000Z');
    assert.equal(times.absoluteTime('2026-09-14T00:00:00+08:00', 60), '2026-09-13T16:01:00.000Z');
});

test('nearby road reports use actual coordinates and distinguish failed or stale feeds', async () => {
    const point = { lat: 1.3, lon: 103.8 };
    const rows = [
        { Latitude: 1.31, Longitude: 103.8, Type: 'Roadwork', Message: 'Second' },
        { Latitude: 1.3, Longitude: 103.8, Type: 'Accident', Message: 'First' },
        { Latitude: 1.4, Longitude: 103.8, Type: 'Roadwork', Message: 'Too far' },
        { Latitude: null, Longitude: null }, { Latitude: 'invalid', Longitude: 103.8 }, { Latitude: 91, Longitude: 103.8 }
    ];
    assert.deepEqual(times.nearbyIncidents(rows, point).map(row => row.message), ['First', 'Second']);
    const failed = await times.roadConditions(point, { incidents: async () => { throw new Error('Offline'); } });
    assert.equal(failed.status, 'unavailable');
    assert.deepEqual(failed.incidents, []);
    assert.equal((await times.roadConditions(point, { incidents: async () => ({ ...envelope([]), stale: true }) })).status, 'stale');
    assert.equal((await times.roadConditions(point, { incidents: async () => envelope([]) })).status, 'live');
});

function fixture() {
    const stations = ['A', 'B'].map((id, index) => ({ id, name: id, codes: [`EW${index + 1}`], platforms: [`${id}_1`], lat: 1.3, lon: 103.8 }));
    const trips = Array.from({ length: 6 }, (_, index) => {
        const departure = (8.5 + index * .5) * 3600 + (index + 1) * 60;
        return [`trip${index}`, { trip_id: `trip${index}`, service_id: 'daily', route_id: 'EWL', trip_headsign: 'B', stops: [
            { id: 'A_1', departure, arrival: departure }, { id: 'B_1', departure: departure + 300, arrival: departure + 300 }
        ] }];
    });
    const data = {
        stationMap: new Map(stations.map(s => [s.id, s])),
        stopMap: new Map(stations.map(s => [`${s.id}_1`, { stop_id: `${s.id}_1`, parent_station: s.id, stop_code: s.codes[0], platform_code: '1' }])),
        trips: new Map(trips), routes: new Map([['EWL', { route_color: '189E4A' }]]), exceptions: [],
        calendar: [{ service_id: 'daily', start_date: '20260101', end_date: '20261231', sunday: '1', monday: '1' }],
        feed: { feed_start_date: '20260101', feed_end_date: '20261231' }, updatedAt: now.toISOString(), stale: false
    };
    const calls = [];
    const dependencies = { now, rail: {
        getNetwork: async at => ({ data, network: rail.buildNetwork(data, at) }), buildNetwork: rail.buildNetwork,
        findRoute: (...args) => { calls.push(args); return rail.findRoute(...args); }
    }, lta: {
        alerts: async () => envelope({ value: { Status: 1, Message: [] } }),
        facilities: async () => envelope({ value: [] }), incidents: async () => envelope([]),
        crowdForecast: async () => forecast(), crowd: async () => envelope({ value: [] })
    } };
    return { dependencies, data, calls };
}

test('six future slots route independently through the real timetable algorithm', async () => {
    const { dependencies, calls } = fixture();
    const result = await times.compareTimes({ origin: 'A', destination: 'B' }, dependencies);
    assert.equal(result.slots.length, 6);
    assert.deepEqual(result.slots.map(slot => slot.train.duration), [6, 7, 8, 9, 10, 11]);
    assert.deepEqual(result.slots.map(slot => slot.crowd.level), ['h', 'l', null, null, null, null]);
    assert.equal(result.slots[0].train.departureAt, '2026-09-13T00:31:00.000Z');
    assert.equal(result.slots[0].train.arrivalAt, '2026-09-13T00:36:00.000Z');
    assert.equal(calls.length, 6);
    assert.equal(result.live.status, 'unavailable');
});

test('tomorrow can have scheduled trains without copying today’s crowd forecast', async () => {
    const { dependencies } = fixture();
    const result = await times.compareTimes({ origin: 'A', destination: 'B', start: '2026-09-14T08:30:00+08:00' }, dependencies);
    assert.ok(result.slots.every(slot => slot.train && slot.crowd.status === 'unavailable'));
});

test('departure comparisons honour custom transfer time without requiring wheelchair mode', async () => {
    const { dependencies, calls } = fixture();
    const result = await times.compareTimes({ origin: 'A', destination: 'B', transferMinutes: '12' }, dependencies);
    assert.equal(calls[0][6].transferMinutes, 12);
    assert.equal(result.slots[0].train.transferMinutes, 12);
    assert.equal(result.slots[0].accessibility, null);
});

test('missing secondary feeds preserve the timetable while accessibility remains unconfirmed', async () => {
    const { dependencies, calls } = fixture();
    for (const key of ['alerts', 'facilities', 'incidents', 'crowdForecast', 'crowd']) dependencies.lta[key] = async () => { throw new Error('Offline'); };
    const result = await times.compareTimes({ origin: 'A', destination: 'B', wheelchair: 'true', transferMinutes: '12', preference: 'transfers' }, dependencies);
    assert.ok(result.slots.every(slot => slot.train && slot.crowd.level === null && slot.accessibility.liftStatus === 'unavailable'));
    assert.equal(result.advisories.available, false);
    assert.equal(result.traffic.status, 'unavailable');
    assert.equal(calls[0][5], 'transfers');
    assert.equal(calls[0][6].transferMinutes, 12);
});

test('current disruption segments remain respected in the time comparison', async () => {
    const { dependencies } = fixture();
    dependencies.lta.alerts = async () => envelope({ value: { Status: 2, AffectedSegments: [{ Line: 'EWL', Stations: 'EW1' }], Message: [] } });
    const result = await times.compareTimes({ origin: 'A', destination: 'B' }, dependencies);
    assert.equal(result.advisories.disruptionReported, true);
    assert.ok(result.slots.every(slot => slot.train === null));
});

test('expired timetable coverage cannot produce scheduled journeys', async () => {
    const { dependencies, data } = fixture();
    data.feed.feed_end_date = '20260912';
    const result = await times.compareTimes({ origin: 'A', destination: 'B' }, dependencies);
    assert.ok(result.slots.every(slot => !slot.timetableCovered && slot.train === null));
});

test('comparison validates stations and transfer allowance before returning a route', async () => {
    const { dependencies } = fixture();
    for (const options of [{ origin: 'A', destination: 'A' }, { origin: 'A', destination: 'missing' }, { origin: ['A'], destination: 'B' }, { origin: 'A', destination: 'B', wheelchair: 'true', transferMinutes: '0' }]) {
        await assert.rejects(times.compareTimes(options, dependencies), { statusCode: 400 });
    }
});
