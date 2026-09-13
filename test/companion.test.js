const { test } = require('node:test');
const assert = require('node:assert/strict');
const patterns = require('../lib/patterns');
const locations = require('../lib/locations');
const combined = require('../lib/combined');
const bus = require('../lib/bus');
const notifications = require('../lib/notifications');
const guide = require('../public/guidance');

test('patterns distinguish weekdays, Sundays and observed holidays in Singapore time', () => {
    assert.equal(patterns.dayContext('2026-09-13T23:30:00+08:00').dayType, 'WEEKENDS/HOLIDAY');
    assert.equal(patterns.dayContext('2026-09-14T00:30:00+08:00').dayType, 'WEEKDAY');
    assert.equal(patterns.dayContext('2026-08-10T08:00:00+08:00').holiday, true);
    assert.equal(patterns.dayContext('2027-01-01T08:00:00+08:00').calendarKnown, false);
});
test('historical activity uses the correct day group and does not double-count interchange codes', () => {
    const row = (hour, count, day = 'WEEKDAY') => ({ PT_CODE: 'EW14-NS26', YEAR_MONTH: '2026-08', DAY_TYPE: day, TIME_PER_HOUR: String(hour), TOTAL_TAP_IN_VOLUME: String(count), TOTAL_TAP_OUT_VOLUME: '0' });
    const feed = { data: patterns.summariseRows([row(8, 100), row(12, 20), row(8, 5, 'WEEKENDS/HOLIDAY'), row(12, 100, 'WEEKENDS/HOLIDAY')]), stale: false, updatedAt: '2026-09-13T00:00:00Z' };
    const weekday = patterns.profileAt(feed, ['EW14', 'NS26'], '2026-09-14T08:00:00+08:00');
    assert.equal(weekday.level, 'busy'); assert.equal(weekday.hours[8].volume, 100);
    assert.equal(patterns.profileAt(feed, ['EW14'], '2026-09-13T08:00:00+08:00').level, 'lighter');
    assert.equal(patterns.profileAt(feed, ['EW14'], '2026-09-14T09:00:00+08:00').status, 'unavailable');
    assert.equal(patterns.profileAt(feed, ['NE9'], '2026-09-14T08:00:00+08:00').status, 'unavailable');
    assert.equal(patterns.profileAt({ ...feed, stale: true }, ['EW14'], '2026-09-14T08:00:00+08:00').status, 'stale');
});
test('missing passenger counts and malformed hours cannot become fake quiet periods', () => {
    const row = { PT_CODE: 'NE9', YEAR_MONTH: '2026-08', DAY_TYPE: 'WEEKDAY', TIME_PER_HOUR: '8', TOTAL_TAP_IN_VOLUME: '', TOTAL_TAP_OUT_VOLUME: '' };
    assert.deepEqual(patterns.summariseRows([row, { ...row, TIME_PER_HOUR: '-1', TOTAL_TAP_IN_VOLUME: '1', TOTAL_TAP_OUT_VOLUME: '0' }]), {});
});
test('location inputs preserve five-digit stops and reject invalid or outside-Singapore pins', () => {
    assert.throws(() => locations.point('', ''), /Singapore/); assert.throws(() => locations.point(51, 0), /Singapore/);
    assert.throws(() => locations.resolve('point:1.3,103.8,9', []), /valid/);
    assert.equal(locations.resolve('point:1.3,103.8', []).lat, 1.3);
    const stop = locations.stopLocation({ BusStopCode: '01012', Description: 'Test stop', RoadName: 'Test road', Latitude: 1.3, Longitude: 103.8 });
    assert.equal(stop.id, 'stop:01012'); assert.equal(locations.resolve(stop.id, [stop]), stop);
});
test('bus-to-rail connectors use real service order, transfer stops and walking limits', () => {
    const origin = { id: 'stop:01001', type: 'bus_stop', sourceId: '01001', lat: 1.3, lon: 103.8 };
    const stops = [{ BusStopCode: '01001', Latitude: 1.3, Longitude: 103.8 }, { BusStopCode: '01002', Latitude: 1.32, Longitude: 103.81 }];
    const stations = [{ id: 'X', lat: 1.3201, lon: 103.8101 }, { id: 'Y', lat: 1.4, lon: 103.9 }];
    const groups = bus.groupRoutes([{ ServiceNo: '7', Direction: 1, StopSequence: 1, BusStopCode: '01001', Distance: 0 }, { ServiceNo: '7', Direction: 1, StopSequence: 2, BusStopCode: '01002', Distance: 3 }]);
    const options = combined.connections(origin, stations[1], stations, stops, groups, { maxWalk: 250, walkPace: 50, preference: 'fastest' }, true);
    assert.equal(options.length, 1); assert.equal(options[0].station.id, 'X'); assert.equal(options[0].bus.board.BusStopCode, '01001'); assert.equal(options[0].bus.alight.BusStopCode, '01002');
    assert.ok(options[0].walkMeters <= 250); assert.equal(combined.connections(origin, stations[1], stations, stops, groups, { maxWalk: 250, walkPace: 50 }, false).length, 0);
});
test('transfer-bus service hours consider the previous operating day after midnight', () => {
    const row = { WD_FirstBus: '0600', WD_LastBus: '0030', SAT_FirstBus: '0700', SAT_LastBus: '2300', SUN_FirstBus: '0800', SUN_LastBus: '2200' };
    assert.equal(combined.operatingAt(row, Date.parse('2026-09-12T00:20:00+08:00')), true);
    assert.equal(combined.operatingAt(row, Date.parse('2026-09-12T00:40:00+08:00')), false);
    assert.equal(combined.operatingAt(row, Date.parse('2026-09-13T07:30:00+08:00')), false);
    assert.equal(combined.operatingAt(row, Date.parse('2026-09-13T08:30:00+08:00')), true);
    assert.equal(combined.operatingAt(null, Date.now()), false);
});
test('GPS guidance rejects inaccurate fixes, backward travel and implausible jumps', () => {
    const stops = Array.from({ length: 8 }, (_, index) => ({ lat: 1.3 + index * .005, lon: 103.8 }));
    assert.equal(guide.progress(stops, 0, { ...stops[1], accuracy: 10 }), 1);
    assert.equal(guide.progress(stops, 0, { ...stops[1], accuracy: 500 }), null);
    assert.equal(guide.progress(stops, 3, { ...stops[1], accuracy: 10 }), null);
    assert.equal(guide.progress(stops, 0, { ...stops[7], accuracy: 10 }), null);
    assert.equal(guide.progress(stops, 0, { ...stops[1], accuracy: NaN }), null);
});
test('notification delivery matches watched lines and never fabricates network-wide attribution', () => {
    const alert = { Status: 2, AffectedSegments: [{ Line: 'NEL', Stations: 'NE8,NE9' }] };
    assert.equal(notifications.eventFor(alert, ['EWL']), null);
    assert.equal(notifications.eventFor({ Status: 1 }, ['NEL']), null);
    assert.equal(notifications.eventFor({ Status: 2 }, ['NEL']), null);
    const event = notifications.eventFor(alert, ['NEL'], new Date('2026-09-13T00:00:00Z'));
    assert.match(event.payload.body, /NEL/); assert.equal(event.eventHash.length, 64);
    assert.equal(event.eventHash, notifications.eventFor(alert, ['NEL','NSL'], new Date('2026-09-13T01:00:00Z')).eventHash);
    assert.notEqual(event.eventHash, notifications.eventFor(alert, ['NEL'], new Date('2026-09-14T01:00:00Z')).eventHash);
});
test('push endpoints and scheduler credentials reject arbitrary URLs and empty secrets', () => {
    const crypto = require('node:crypto');
    const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys: { p256dh: crypto.createECDH('prime256v1').generateKeys().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
    assert.equal(notifications.validSubscription(subscription), true);
    assert.equal(notifications.validSubscription({ ...subscription, keys: { ...subscription.keys, p256dh: 'a'.repeat(87) } }), false);
    for (const endpoint of ['http://fcm.googleapis.com/x','https://fcm.googleapis.com.evil.invalid/x','https://127.0.0.1/x','https://user@fcm.googleapis.com/x','https://fcm.googleapis.com:8443/x']) assert.equal(notifications.validSubscription({ ...subscription, endpoint }), false);
    assert.equal(notifications.authorised('Bearer demo', 'demo'), true);
    assert.equal(notifications.authorised('Bearer demo', 'wrong'), false);
    assert.equal(notifications.authorised('Bearer ', ''), false);
    assert.equal(notifications.configured({}), false);
});
