const axios = require('axios');
const fs = require('node:fs/promises');
const path = require('node:path');

const baseURL = 'https://datamall2.mytransport.sg/ltaodataservice';
const cacheDirectory = path.join(__dirname, '..', '.cache');
const memory = new Map();
const pending = new Map();

async function cached(key, ttl, fetcher, disk = false) {
    let entry = memory.get(key);
    if (!entry && disk) {
        try { entry = JSON.parse(await fs.readFile(path.join(cacheDirectory, `${key}.json`), 'utf8')); }
        catch { /* No previously downloaded dataset. */ }
        if (entry) memory.set(key, entry);
    }
    if (entry && Date.now() - Date.parse(entry.updatedAt) < ttl) return { ...entry, stale: false };
    if (pending.has(key)) return pending.get(key);
    const promise = (async () => {
        try {
            const data = await fetcher();
            const fresh = { data, updatedAt: new Date().toISOString() };
            memory.set(key, fresh);
            if (disk) {
                try {
                    await fs.mkdir(cacheDirectory, { recursive: true });
                    const temporary = path.join(cacheDirectory, `${key}.${process.pid}.${Date.now()}.tmp`);
                    await fs.writeFile(temporary, JSON.stringify(fresh));
                    await fs.rename(temporary, path.join(cacheDirectory, `${key}.json`));
                } catch { console.warn(`Could not persist ${key}; using the downloaded data in memory.`); }
            }
            return { ...fresh, stale: false };
        } catch (error) {
            // Never invent a successful response from demo data after an API failure.
            if (entry) return { ...entry, stale: true };
            throw error;
        } finally { pending.delete(key); }
    })();
    pending.set(key, promise);
    return promise;
}

async function request(endpoint, params = {}) {
    if (!process.env.LTA_DATAMALL_API_KEY) throw new Error('LTA key is not configured');
    try {
        const response = await axios.get(`${baseURL}/${endpoint}`, {
            headers: { AccountKey: process.env.LTA_DATAMALL_API_KEY, Accept: 'application/json' },
            params, timeout: 15000
        });
        return response.data;
    } catch (error) {
        // Axios errors include request headers; expose only a sanitised error.
        throw new Error(`LTA request unavailable (${error.response?.status || error.code || 'network'})`);
    }
}

async function allPages(endpoint) {
    const rows = [];
    for (let skip = 0; skip < 100000; skip += 2000) {
        const pages = await Promise.all([0, 500, 1000, 1500].map(offset => request(endpoint, { $skip: skip + offset })));
        for (const page of pages) {
            if (!Array.isArray(page.value)) throw new Error('Invalid LTA dataset');
            rows.push(...page.value);
            if (page.value.length < 500) return rows;
        }
    }
    throw new Error('LTA dataset exceeded the supported size');
}

const ttl = { alerts: 30000, arrivals: 20000, crowd: 600000, datasets: 86400000 };
const alerts = () => cached('alerts', ttl.alerts, () => request('TrainServiceAlerts'));
const arrivals = stop => cached(`arrivals-${stop}`, ttl.arrivals, () => request('v3/BusArrival', { BusStopCode: stop }));
const crowd = line => cached(`crowd-${line}`, ttl.crowd, () => request('PCDRealTime', { TrainLine: line }));
const facilities = () => cached('facilities', 60000, async () => {
    const result = await request('v2/FacilitiesMaintenance');
    if (!Array.isArray(result.value)) throw new Error('Invalid lift maintenance response');
    return result;
});
const busStops = () => cached('bus-stops', ttl.datasets, () => allPages('BusStops'), true);
const busRoutes = () => cached('bus-routes', ttl.datasets, () => allPages('BusRoutes'), true);

module.exports = { cached, request, alerts, arrivals, crowd, facilities, busStops, busRoutes, cacheDirectory };
