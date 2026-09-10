const axios = require('axios');
const fs = require('fs');

// Fetching nodes, ways, and relations for railway=station in SG
const query = `[out:json][timeout:25];area["ISO3166-1"="SG"][admin_level=2]->.searchArea;(nwr["railway"="station"](area.searchArea););out center;`;

axios.get('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(query), {
    headers: { 'User-Agent': 'SmartCommuterCompanion/1.0' }
}).then(r => {
    const feats = r.data.elements.filter(e => e.tags && e.tags.name).map(e => {
        let lat, lon;
        if (e.type === 'node') {
            lat = e.lat;
            lon = e.lon;
        } else if (e.center) {
            lat = e.center.lat;
            lon = e.center.lon;
        }
        
        if (!lat || !lon) return null;
        
        return {
            type: 'Feature',
            properties: {
                name: e.tags.name,
                code: e.tags.ref || e.tags.name
            },
            geometry: {
                type: 'Point',
                coordinates: [lon, lat]
            }
        };
    }).filter(e => e !== null);
    
    fs.writeFileSync('public/stations.geojson', JSON.stringify({
        type: 'FeatureCollection',
        features: feats
    }));
    console.log('Successfully fetched and generated GeoJSON with ' + feats.length + ' stations.');
}).catch(e => {
    console.error('Error fetching from Overpass API:', e.message);
});
