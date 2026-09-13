const invalid = message => Object.assign(new Error(message), { statusCode: 400 });

function transferAllowance(value, wheelchair = false) {
    const minutes = value === undefined ? (wheelchair ? 8 : 4) : Number(value);
    if (Array.isArray(value) || !Number.isInteger(minutes) || minutes < 4 || minutes > 30) throw invalid('Choose a transfer allowance from 4 to 30 minutes.');
    return minutes;
}
function crowdSetting(value = 'any') {
    if (!['any', 'avoid-high', 'seats'].includes(value)) throw invalid('Choose a supported bus crowd preference.');
    return value;
}
function journeySettings(query) {
    const preference = ['fastest', 'walking', 'transfers'].includes(query.preference) ? query.preference : 'fastest';
    const maxWalk = query.maxWalk === undefined || query.maxWalk === 'auto' ? (preference === 'walking' ? 450 : 1000) : Number(query.maxWalk);
    if (Array.isArray(query.maxWalk) || ![250, 450, 500, 1000, 1500].includes(maxWalk)) throw invalid('Choose a supported maximum walking distance.');
    const walkPace = query.walkPace === undefined ? 75 : Number(query.walkPace);
    if (Array.isArray(query.walkPace) || ![50, 75, 100].includes(walkPace)) throw invalid('Choose a supported walking or rolling pace.');
    return { preference, maxWalk, walkPace, transferMinutes: transferAllowance(query.transferMinutes, query.wheelchair === 'true'), busCrowding: crowdSetting(query.busCrowding) };
}
function crowdMatches(bus, setting = 'any') {
    if (setting === 'any') return true;
    if (setting === 'seats') return bus?.Load === 'SEA';
    return setting === 'avoid-high' && ['SEA', 'SDA'].includes(bus?.Load);
}
function filterCrowdArrivals(data, setting, stale = false, now = Date.now()) {
    if (setting === 'any') return data;
    return { ...data, Services: stale ? [] : (data.Services || []).map(service => ({
        ...service,
        ...Object.fromEntries(['NextBus', 'NextBus2', 'NextBus3'].map(key => {
            const prediction = service[key];
            return [key, Date.parse(prediction?.EstimatedArrival) >= now && crowdMatches(prediction, setting) ? prediction : null];
        }))
    })).filter(service => ['NextBus', 'NextBus2', 'NextBus3'].some(key => service[key])) };
}

module.exports = { journeySettings, transferAllowance, crowdSetting, crowdMatches, filterCrowdArrivals };
