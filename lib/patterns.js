const axios = require('axios');
const { unzipSync, strFromU8 } = require('fflate');
const { parse } = require('csv-parse/sync');
const lta = require('./lta');

// MOM's gazetted dates, including Monday holidays. Never extrapolate this calendar.
// https://www.mom.gov.sg/newsroom/press-releases/2025/0616-public-holidays-for-2026
const holidays = new Set(['2026-01-01', '2026-02-17', '2026-02-18', '2026-03-21', '2026-04-03', '2026-05-01', '2026-05-27', '2026-05-31', '2026-06-01', '2026-08-09', '2026-08-10', '2026-11-08', '2026-11-09', '2026-12-25']);
function dayContext(at) {
    const sg = new Date(new Date(at).getTime() + 8 * 3600000);
    const date = sg.toISOString().slice(0, 10), weekend = [0, 6].includes(sg.getUTCDay());
    return { date, hour: sg.getUTCHours(), dayType: weekend || holidays.has(date) ? 'WEEKENDS/HOLIDAY' : 'WEEKDAY', holiday: holidays.has(date), calendarKnown: sg.getUTCFullYear() === 2026 || weekend };
}
function summariseRows(rows) {
    const profiles = {};
    for (const row of rows) {
        if (![row.TIME_PER_HOUR, row.TOTAL_TAP_IN_VOLUME, row.TOTAL_TAP_OUT_VOLUME].every(value => /^\d+$/.test(String(value).trim()))) continue;
        const hour = Number(row.TIME_PER_HOUR), incoming = Number(row.TOTAL_TAP_IN_VOLUME), outgoing = Number(row.TOTAL_TAP_OUT_VOLUME);
        if (!['WEEKDAY', 'WEEKENDS/HOLIDAY'].includes(row.DAY_TYPE) || !Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isFinite(incoming + outgoing) || incoming < 0 || outgoing < 0) continue;
        const key = `${row.PT_CODE}:${row.DAY_TYPE}`;
        if (!profiles[key]) profiles[key] = { code: row.PT_CODE, month: row.YEAR_MONTH, hours: Array(24).fill(null) };
        profiles[key].hours[hour] = (profiles[key].hours[hour] || 0) + incoming + outgoing;
    }
    return profiles;
}
async function dataset(kind = 'train', now = new Date()) {
    const sg = new Date(now.getTime() + 8 * 3600000);
    const available = new Date(Date.UTC(sg.getUTCFullYear(), sg.getUTCMonth() - (sg.getUTCDate() >= 10 ? 1 : 2), 1));
    const month = available.toISOString().slice(0, 7).replace('-', '');
    return lta.cached(`volume-${kind}-${month}`, 86400000, async () => {
        const result = await lta.request(kind === 'bus' ? 'PV/Bus' : 'PV/Train', { Date: month });
        const link = result.value?.[0]?.Link, url = new URL(link);
        if (url.protocol !== 'https:' || !url.hostname.endsWith('.amazonaws.com')) throw new Error('Unexpected passenger dataset host');
        let buffer;
        try { buffer = (await axios.get(link, { responseType: 'arraybuffer', timeout: 30000, maxContentLength: 30000000 })).data; }
        catch { throw new Error('Passenger history download unavailable'); }
        const zip = unzipSync(new Uint8Array(buffer));
        const filename = Object.keys(zip).find(name => name.toLowerCase().endsWith('.csv'));
        if (!filename) throw new Error('Passenger history unavailable');
        return summariseRows(parse(strFromU8(zip[filename]), { columns: true, trim: true, bom: true, skip_empty_lines: true }));
    }, true);
}
function profileAt(feed, codes, at) {
    const context = dayContext(at);
    const unavailable = { status: 'unavailable', ...context, label: 'Pattern unavailable' };
    if (!feed) return unavailable;
    const entries = Object.values(feed.data).filter(row => row.code.split('-').some(code => codes.includes(code)) && feed.data[`${row.code}:${context.dayType}`] === row);
    // Do not add interchange totals twice when the source combines station codes.
    if (!entries.length) return unavailable;
    const hours = Array.from({ length: 24 }, (_, hour) => {
        const counts = entries.map(row => row.hours[hour]);
        return counts.some(value => value === null) ? null : counts.reduce((sum, value) => sum + value, 0);
    });
    const peak = Math.max(...hours.filter(Number.isFinite)), volume = hours[context.hour];
    if (!(peak > 0) || volume === null) return unavailable;
    const level = volume >= peak * .75 ? 'busy' : volume >= peak * .4 ? 'steady' : 'lighter';
    return { ...context, status: feed.stale ? 'stale' : 'historical', level, label: ({ busy: 'Usually busier', steady: 'Usually moderate activity', lighter: 'Usually lighter' })[level], month: entries[0].month, source: 'LTA monthly passenger volumes', retrievedAt: feed.updatedAt, hours: hours.map((value, hour) => ({ hour, volume: value, relative: value === null ? null : Math.round(value / peak * 100) })), peakHours: hours.flatMap((value, hour) => value >= peak * .75 ? [hour] : []), note: 'Tap-ins + tap-outs compared with this location’s busiest hour for the same day type. This is historical activity, not live crowding, train occupancy or road congestion. Busier means at least 75% of the historical peak; moderate means 40–74%. Hourly totals cover the whole source month.' };
}
module.exports = { dayContext, summariseRows, dataset, profileAt };
