const predictionKeys = ['NextBus', 'NextBus2', 'NextBus3'];
const wheelchairBus = bus => bus?.Feature === 'WAB';

function filterArrivals(data) {
    return { ...data, Services: (data.Services || []).map(service => ({
        ...service,
        ...Object.fromEntries(predictionKeys.map(key => [key, wheelchairBus(service[key]) ? service[key] : null]))
    })).filter(service => predictionKeys.some(key => service[key]?.EstimatedArrival)) };
}

function maintenanceByStation(stations, feed) {
    const result = new Map();
    for (const station of stations) {
        const codes = new Set([station.id, ...(station.codes || [])]);
        // Legacy Circle Line extension codes may still occur in advisories.
        if (codes.has('CC33')) codes.add('CE2');
        if (codes.has('CC34')) codes.add('CE1');
        const rows = (feed?.data.value || []).filter(row => {
            const reportedCodes = String(row.StationCode || '').split(/[\s/,;]+/);
            return reportedCodes.some(code => codes.has(code)) || String(row.StationName || '').trim().toLowerCase() === station.name.toLowerCase();
        });
        if (rows.length) result.set(station.id, rows);
    }
    return result;
}

function trainAccess(route, origin, destination, stations, feed, transferMinutes) {
    const byStation = maintenanceByStation(stations, feed);
    // Passing through a station does not require using its lifts.
    const needed = new Set([origin, destination, ...(route?.legs.slice(1).map(leg => leg.fromStation) || [])]);
    const notices = [...needed].flatMap(id => (byStation.get(id) || []).map(row => ({
        stationId: id, stationName: row.StationName || stations.find(s => s.id === id)?.name || id,
        liftId: row.LiftID || null, description: row.LiftDesc || 'Lift details not supplied',
        atEndpoint: id === origin || id === destination
    })));
    return {
        requested: true, transferMinutes,
        liftStatus: !feed ? 'unavailable' : feed.stale ? 'stale' : notices.length ? 'reported-maintenance' : 'no-reported-maintenance',
        liftUpdatedAt: feed?.updatedAt || null, notices,
        stepFreePathVerified: false
    };
}

module.exports = { wheelchairBus, filterArrivals, maintenanceByStation, trainAccess };
