// Shared by the foreground trip UI and the offline test suite.
((root) => {
    function distance(a, b) {
        const rad = n => n * Math.PI / 180, dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
        return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }
    function progress(stops, index, position) {
        if (!Number.isFinite(position.accuracy) || position.accuracy > 80 || position.accuracy < 0 || !Number.isFinite(position.lat) || !Number.isFinite(position.lon)) return null;
        const closest = stops.slice(index + 1, index + 4).map((stop, offset) => ({ index: index + offset + 1, meters: distance(position, stop) })).sort((a, b) => a.meters - b.meters)[0];
        return closest?.meters <= 90 ? closest.index : null;
    }
    const api = { distance, progress };
    if (typeof module !== 'undefined') module.exports = api;
    else root.TripGuide = api;
})(typeof window !== 'undefined' ? window : globalThis);
