const { test } = require('node:test');
const assert = require('node:assert/strict');
const preferences = require('../lib/preferences');
const bus = require('../lib/bus');
const lta = require('../lib/lta');
const access = require('../lib/accessibility');

test('journey settings preserve defaults and validate all numeric and crowd controls', () => {
    assert.deepEqual(preferences.journeySettings({}), { preference: 'fastest', maxWalk: 1000, walkPace: 75, transferMinutes: 4, busCrowding: 'any' });
    assert.equal(preferences.journeySettings({ preference: 'walking' }).maxWalk, 450);
    assert.equal(preferences.journeySettings({ wheelchair: 'true' }).transferMinutes, 8);
    assert.deepEqual(preferences.journeySettings({ preference: 'walking', maxWalk: '250', walkPace: '50', transferMinutes: '12', busCrowding: 'seats' }), { preference: 'walking', maxWalk: 250, walkPace: 50, transferMinutes: 12, busCrowding: 'seats' });
    for (const query of [{ maxWalk: '100000' }, { maxWalk: ['250'] }, { walkPace: '0' }, { walkPace: ['50'] }, { busCrowding: 'quiet' }, { busCrowding: ['seats'] }, { transferMinutes: 'NaN' }, { transferMinutes: '3' }, { transferMinutes: '31' }, { transferMinutes: ['8'] }]) {
        assert.throws(() => preferences.journeySettings(query), { statusCode: 400 });
    }
});

test('crowd filters use reported categories and never infer seats from missing data', () => {
    for (const Load of ['SEA', 'SDA', 'LSD', 'NA', '', undefined]) {
        assert.equal(preferences.crowdMatches({ Load }, 'seats'), Load === 'SEA');
        assert.equal(preferences.crowdMatches({ Load }, 'avoid-high'), ['SEA', 'SDA'].includes(Load));
        assert.equal(preferences.crowdMatches({ Load }, 'any'), true);
    }
    assert.equal(preferences.crowdMatches(null, 'seats'), false);
});

test('filtered arrivals exclude old, stale or unknown predictions without mutating the feed', () => {
    const now = Date.parse('2026-09-13T12:00:00+08:00');
    const first = { EstimatedArrival: new Date(now - 1).toISOString(), Load: 'SEA' };
    const second = { EstimatedArrival: new Date(now + 60000).toISOString(), Load: 'SEA', Feature: 'WAB' };
    const third = { ...second, Load: 'SDA', Feature: '' };
    const data = { Services: [{ ServiceNo: '10', NextBus: first, NextBus2: second, NextBus3: third }] };
    const result = preferences.filterCrowdArrivals(data, 'seats', false, now);
    assert.equal(result.Services[0].NextBus, null);
    assert.equal(result.Services[0].NextBus2, second);
    assert.equal(result.Services[0].NextBus3, null);
    assert.equal(data.Services[0].NextBus, first);
    assert.equal(preferences.filterCrowdArrivals(data, 'seats', true, now).Services.length, 0);
    assert.equal(preferences.filterCrowdArrivals(data, 'any', true, now), data);
    const combined = preferences.filterCrowdArrivals(access.filterArrivals(data), 'avoid-high', false, now);
    assert.deepEqual(combined.Services[0], { ServiceNo: '10', NextBus: null, NextBus2: second, NextBus3: null });
});

const routeRows = [
    { ServiceNo: '10', Direction: 1, StopSequence: 1, BusStopCode: '11111', Distance: 0 },
    { ServiceNo: '10', Direction: 1, StopSequence: 2, BusStopCode: '22222', Distance: 1 }
];

test('a slower pace changes walking time and the next reachable bus', () => {
    const origins = [{ BusStopCode: '11111', walkMeters: 300 }], destinations = [{ BusStopCode: '22222', walkMeters: 150 }];
    const groups = bus.groupRoutes(routeRows);
    const usual = bus.directCandidates(groups, origins, destinations, 75)[0];
    const relaxed = bus.directCandidates(groups, origins, destinations, 50)[0];
    assert.equal(usual.walkMinutes, 6);
    assert.equal(relaxed.walkMinutes, 9);
    assert.equal(relaxed.rideMinutes, usual.rideMinutes);
    const now = Date.now();
    const prediction = minutes => ({ EstimatedArrival: new Date(now + minutes * 60000).toISOString(), OriginCode: '11111', DestinationCode: '22222', Load: 'SEA', VisitNumber: '1' });
    const first = prediction(5), later = prediction(8);
    const service = { NextBus: first, NextBus2: later };
    assert.equal(bus.nextBoardable(service, usual, now), first);
    assert.equal(bus.nextBoardable(service, relaxed, now), later);
});

test('crowd and wheelchair requirements combine when selecting a later bus', () => {
    const now = Date.now(), candidate = { boardWalkMinutes: 0, originCode: '11111', destinationCode: '22222', visit: 1 };
    const prediction = (mins, Load, Feature) => ({ EstimatedArrival: new Date(now + mins * 60000).toISOString(), OriginCode: '11111', DestinationCode: '22222', Load, Feature, VisitNumber: '1' });
    const service = { NextBus: prediction(1, 'LSD', 'WAB'), NextBus2: prediction(2, 'SEA', ''), NextBus3: prediction(3, 'SEA', 'WAB') };
    assert.equal(bus.nextBoardable(service, candidate, now, true, 'seats'), service.NextBus3);
    assert.equal(bus.nextBoardable(service, candidate, now, false, 'seats'), service.NextBus2);
    assert.equal(bus.nextBoardable(service, candidate, now, true, 'any'), service.NextBus);
});

test('walking limits, pace and crowd filters affect complete direct-bus alternatives', async t => {
    const stops = [{ BusStopCode: '11111', Latitude: 1.3025, Longitude: 103.8 }, { BusStopCode: '22222', Latitude: 1.3125, Longitude: 103.8 }];
    const envelope = data => ({ data, updatedAt: new Date().toISOString(), stale: false });
    t.mock.method(lta, 'busStops', async () => envelope(stops));
    t.mock.method(lta, 'busRoutes', async () => envelope(routeRows));
    const now = Date.now();
    const prediction = (minutes, Load) => ({ EstimatedArrival: new Date(now + minutes * 60000).toISOString(), OriginCode: '11111', DestinationCode: '22222', VisitNumber: '1', Load });
    const low = prediction(12, 'SEA');
    t.mock.method(lta, 'arrivals', async () => envelope({ Services: [{ ServiceNo: '10', NextBus: prediction(9, 'LSD'), NextBus2: low }] }));
    const origin = { lat: 1.3, lon: 103.8 }, destination = { lat: 1.31, lon: 103.8 };
    const strict = await bus.alternatives(origin, destination, 'fastest', false, false, { maxWalk: 250 });
    assert.equal(strict.options.length, 0);
    const relaxed = await bus.alternatives(origin, destination, 'fastest', false, false, { maxWalk: 500, walkPace: 50, busCrowding: 'seats' });
    assert.equal(relaxed.options.length, 1);
    assert.equal(relaxed.options[0].next, low);
    assert.equal(relaxed.walkPace, 50);
    assert.equal(relaxed.crowding, 'seats');
    assert.ok(relaxed.options[0].board.walkMeters <= 500 && relaxed.options[0].alight.walkMeters <= 500);
    t.mock.method(lta, 'arrivals', async () => ({ ...envelope({ Services: [{ ServiceNo: '10', NextBus: low }] }), stale: true }));
    const stale = await bus.alternatives(origin, destination, 'fastest', false, false, { maxWalk: 500, busCrowding: 'seats' });
    assert.equal(stale.options.length, 0);
});
