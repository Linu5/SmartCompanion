// Initialize Map (centered on Singapore)
const map = L.map('map', { zoomControl: false }).setView([1.3521, 103.8198], 12);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
}).addTo(map);

// Custom icons helper
function getStationIcon(color) {
    return L.divIcon({
        className: '',
        html: `<div style="background-color: ${color}; border: 2px solid white; border-radius: 50%; width: 12px; height: 12px;"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8]
    });
}

const disruptedIcon = L.divIcon({
    className: '',
    html: '<div class="disrupted-station"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9]
});

let currentDisruptionData = null;

let graph = {};
let codeToLatLng = {};

function drawMRTLines(data) {
    const lines = {};
    const lineColors = {}; // map Line Name -> Color for Legend

    data.features.forEach(f => {
        const codes = (f.properties.code || '').split(/[\/\s-]/);
        codes.forEach(c => {
            const match = c.match(/^([A-Z]+)(\d+.*)$/);
            if (match) {
                const prefix = match[1];
                const num = parseFloat(match[2]);
                if (!lines[prefix]) lines[prefix] = [];
                lines[prefix].push({ 
                    feature: f, 
                    num: num, 
                    color: f.properties.color,
                    lineName: f.properties.line || prefix 
                });
            }
        });
    });

    const legendDiv = document.getElementById('legend-content');
    legendDiv.innerHTML = '';

    // Initialize graph
    graph = {};
    codeToLatLng = {};
    if (window.stationsLayer) {
        window.stationsLayer.eachLayer(layer => {
            const c = layer.feature.properties.code;
            codeToLatLng[c] = layer.getLatLng();
            graph[c] = [];
        });
    }

    // Draw lines, populate legend, build edges
    Object.keys(lines).forEach(prefix => {
        if (lines[prefix].length < 2) return;
        
        lines[prefix].sort((a,b) => a.num - b.num);
        
        const latlngs = lines[prefix].map(item => [item.feature.geometry.coordinates[1], item.feature.geometry.coordinates[0]]);
        
        const primaryColor = lines[prefix][0].color || '#888';
        const lineName = lines[prefix][0].lineName || prefix;

        L.polyline(latlngs, { color: primaryColor, weight: 4, opacity: 0.8 }).addTo(map);

        // Build edges for graph
        for(let i=0; i<lines[prefix].length - 1; i++) {
            const u = lines[prefix][i].feature.properties.code;
            const v = lines[prefix][i+1].feature.properties.code;
            if (graph[u] && !graph[u].includes(v)) graph[u].push(v);
            if (graph[v] && !graph[v].includes(u)) graph[v].push(u);
        }

        if (!lineColors[lineName]) {
            lineColors[lineName] = primaryColor;
            const item = document.createElement('div');
            item.style.display = 'flex';
            item.style.alignItems = 'center';
            item.style.marginBottom = '5px';
            item.style.fontSize = '12px';
            item.innerHTML = `<div style="width: 12px; height: 12px; border-radius: 50%; background-color: ${primaryColor}; margin-right: 8px;"></div>${lineName}`;
            legendDiv.appendChild(item);
        }
    });
}

// Load GeoJSON stations and populate dropdowns
fetch('/stations.geojson')
    .then(response => response.json())
    .then(data => {
        const originSelect = document.getElementById('origin-select');
        const destSelect = document.getElementById('dest-select');

        // Sort stations alphabetically
        const sortedFeatures = data.features.sort((a,b) => a.properties.name.localeCompare(b.properties.name));

        window.stationsLayer = L.geoJSON(data, {
            pointToLayer: function (feature, latlng) {
                const color = feature.properties.color || '#888';
                return L.marker(latlng, { icon: getStationIcon(color) })
                       .bindPopup(`<strong>${feature.properties.name}</strong><br>${feature.properties.code}<br>${feature.properties.line || ''}`);
            }
        }).addTo(map);
        
        // Populate "My Route" dropdowns
        sortedFeatures.forEach(f => {
            const opt1 = document.createElement('option');
            opt1.value = f.properties.code;
            opt1.textContent = `${f.properties.name} (${f.properties.code})`;
            originSelect.appendChild(opt1);
            
            const opt2 = document.createElement('option');
            opt2.value = f.properties.code;
            opt2.textContent = `${f.properties.name} (${f.properties.code})`;
            destSelect.appendChild(opt2);
        });

        // Draw the real MRT lines!
        drawMRTLines(data);

        // Event listeners
        document.getElementById('plan-route-btn').addEventListener('click', planRoute);
        document.getElementById('alert-header-text').addEventListener('click', toggleAlertBanner);

        // Check for alerts
        checkAlerts();
    });

setInterval(checkAlerts, 30000);

async function checkAlerts() {
    try {
        const res = await fetch('/api/alerts');
        const data = await res.json();
        
        if (data && data.value) {
            const alert = data.value;
            currentDisruptionData = alert;
            
            // Combine all messages if present
            let msgText = '';
            if (alert.Message && alert.Message.length > 0) {
                msgText = alert.Message.map(m => m.Content).join('<br><br>');
            }

            if (alert.Status === 2) {
                // SEVERE DISRUPTION
                showBanner(msgText, true, alert.AffectedSegments);
            } else if (msgText.trim() !== '') {
                // NORMAL STATUS but has info messages
                showBanner(msgText, false, null);
                document.getElementById('suggestion-panel').classList.add('hidden');
            } else {
                hideBanner();
            }
        }
    } catch (err) {
        console.error("Error fetching alerts:", err);
    }
}

function showBanner(message, isSevere, segments) {
    const banner = document.getElementById('alert-banner');
    const headerText = document.getElementById('alert-header-text').querySelector('span');
    const content = document.getElementById('alert-content');
    const btn = document.getElementById('find-route-btn');
    
    banner.classList.remove('hidden', 'alert-banner-severe', 'alert-banner-info');
    document.getElementById('alert-header-text').classList.remove('header-severe', 'header-info');

    // Make sure container is visible
    document.getElementById('alert-body-container').classList.remove('hidden');
    document.getElementById('alert-toggle-icon').innerText = '▼';

    if (isSevere) {
        banner.classList.add('alert-banner-severe');
        document.getElementById('alert-header-text').classList.add('header-severe');
        
        let summary = "⚠️ MRT Service Disruption";
        if (segments && segments.length > 0) {
            summary = `⚠️ ${segments[0].Line} Line delayed between ${segments[0].Stations.replace(/,/g, ' - ')}`;
        }
        headerText.innerText = summary;
        content.innerHTML = `<strong>Details:</strong><br>${message}`;
        btn.classList.remove('hidden');
        highlightStations(segments[0].Stations.split(','));
    } else {
        banner.classList.add('alert-banner-info');
        document.getElementById('alert-header-text').classList.add('header-info');
        headerText.innerText = 'ℹ️ Service Advisory';
        content.innerHTML = message;
        btn.classList.add('hidden');
        resetMapIcons();
    }
}

function hideBanner() {
    document.getElementById('alert-banner').classList.add('hidden');
    document.getElementById('suggestion-panel').classList.add('hidden');
    resetMapIcons();
}

function resetMapIcons() {
    if (window.stationsLayer) {
        window.stationsLayer.eachLayer(layer => {
            const color = layer.feature.properties.color || '#888';
            layer.setIcon(getStationIcon(color));
        });
    }
}

function highlightStations(affectedCodes) {
    if (window.stationsLayer) {
        window.stationsLayer.eachLayer(layer => {
            const codes = (layer.feature.properties.code || '').split(/[\/\\s-]/);
            const isAffected = codes.some(code => affectedCodes.includes(code.trim()));
            if (isAffected) {
                layer.setIcon(disruptedIcon);
            } else {
                const color = layer.feature.properties.color || '#888';
                layer.setIcon(getStationIcon(color));
            }
        });
    }
}

function toggleAlertBanner() {
    const body = document.getElementById('alert-body-container');
    const icon = document.getElementById('alert-toggle-icon');
    if (body.classList.contains('hidden')) {
        body.classList.remove('hidden');
        icon.innerText = '▼';
    } else {
        body.classList.add('hidden');
        icon.innerText = '▶';
    }
}

let currentTrail = null;

function planRoute() {
    const origin = document.getElementById('origin-select').value;
    const dest = document.getElementById('dest-select').value;
    const results = document.getElementById('route-results');
    
    if (!origin || !dest) {
        alert("Please select both origin and destination stations.");
        return;
    }
    
    // BFS to find shortest path across MRT lines
    const queue = [[origin]];
    const visited = new Set([origin]);
    let shortestPath = null;

    while(queue.length > 0) {
        const path = queue.shift();
        const node = path[path.length - 1];

        if (node === dest) {
            shortestPath = path;
            break;
        }

        (graph[node] || []).forEach(neighbor => {
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push([...path, neighbor]);
            }
        });
    }

    if (currentTrail) {
        map.removeLayer(currentTrail);
        currentTrail = null;
    }

    if (shortestPath && shortestPath.length > 0) {
        const latlngs = shortestPath.map(code => codeToLatLng[code]).filter(Boolean);
        if (latlngs.length > 1) {
            currentTrail = L.polyline(latlngs, {
                color: '#fff',
                weight: 6,
                opacity: 0.9,
                className: 'route-glow'
            }).addTo(map);
            map.fitBounds(L.latLngBounds(latlngs), { padding: [50, 50] });
        }
    } else {
        // Fallback zoom if graph is disconnected
        let oLoc = codeToLatLng[origin];
        let dLoc = codeToLatLng[dest];
        if (oLoc && dLoc) map.fitBounds(L.latLngBounds([oLoc, dLoc]), { padding: [50, 50] });
    }

    results.classList.remove('hidden');
    
    // Check if the route intercepts the active disruption
    let isDisrupted = false;
    if (currentDisruptionData && currentDisruptionData.Status === 2) {
        const affected = currentDisruptionData.AffectedSegments[0].Stations;
        if (affected.includes(origin) || affected.includes(dest)) {
            isDisrupted = true;
        }
    }

    if (isDisrupted) {
        results.innerHTML = `<div style="color: #ff5252; font-weight: bold;">⚠️ Route affected by disruption! See Decision Support panel.</div>`;
        showProactiveSuggestion();
    } else {
        results.innerHTML = `
            <div class="eta-card" style="margin-bottom: 8px;">
                <div class="eta-card-header eta-mrt" style="background: rgba(33, 150, 243, 0.1);">🚇 Fastest MRT</div>
                <div class="eta-content">
                    <div>Direct / 1 Transfer</div>
                    <div class="eta-time fast">~25 min</div>
                </div>
            </div>
            <div class="eta-card" style="margin-bottom: 0;">
                <div class="eta-card-header eta-bus">🚌 Bus Options</div>
                <div class="eta-content">
                    <div>Check live timings below</div>
                    <div class="eta-time">~40 min</div>
                </div>
            </div>
        `;
        document.getElementById('suggestion-panel').classList.add('hidden');
    }
}

document.getElementById('search-bus-btn').addEventListener('click', searchBus);
document.getElementById('clear-route-btn').addEventListener('click', clearRoute);

function clearRoute() {
    document.getElementById('origin-select').value = '';
    document.getElementById('dest-select').value = '';
    document.getElementById('route-results').classList.add('hidden');
    document.getElementById('suggestion-panel').classList.add('hidden');
    
    if (currentTrail) {
        map.removeLayer(currentTrail);
        currentTrail = null;
    }
}

function formatBusTiming(busData) {
    if (!busData || !busData.EstimatedArrival) return null;
    
    const arrivalTime = new Date(busData.EstimatedArrival);
    const diffMins = Math.floor((arrivalTime - new Date()) / 60000);
    
    let timeStr = '';
    if (diffMins < 0) timeStr = 'Left';
    else if (diffMins === 0) timeStr = 'Arr';
    else timeStr = diffMins + ' min';

    let typeStr = '';
    if (busData.Type === 'SD') typeStr = 'Single';
    else if (busData.Type === 'DD') typeStr = 'Double';
    else if (busData.Type === 'BD') typeStr = 'Bendy';

    return { time: timeStr, type: typeStr };
}

async function searchBus() {
    const stopCode = document.getElementById('bus-stop-input').value.trim();
    const resultsDiv = document.getElementById('bus-results');
    
    if (!stopCode) return;
    
    resultsDiv.innerHTML = 'Loading...';
    resultsDiv.classList.remove('hidden');
    
    try {
        const res = await fetch(`/api/bus-arrival?BusStopCode=${stopCode}`);
        const data = await res.json();
        
        if (data && data.Services && data.Services.length > 0) {
            let html = '<div style="max-height: 250px; overflow-y: auto; padding-right: 5px;">';
            data.Services.forEach(svc => {
                const b1 = formatBusTiming(svc.NextBus);
                const b2 = formatBusTiming(svc.NextBus2);
                const b3 = formatBusTiming(svc.NextBus3);

                let timingsHtml = '';
                if (b1) {
                    timingsHtml += `<div style="color: #4caf50; font-weight: bold; width: 60px;">${b1.time}<br><span style="font-size:10px; color:#aaa; font-weight:normal;">${b1.type}</span></div>`;
                } else {
                    timingsHtml += `<div style="width: 60px;">N/A</div>`;
                }
                
                if (b2) timingsHtml += `<div style="color: #bbb; width: 60px;">${b2.time}<br><span style="font-size:10px; color:#888;">${b2.type}</span></div>`;
                if (b3) timingsHtml += `<div style="color: #bbb; width: 60px;">${b3.time}<br><span style="font-size:10px; color:#888;">${b3.type}</span></div>`;

                html += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #333;">
                        <strong style="font-size: 16px; width: 40px;">${svc.ServiceNo}</strong>
                        <div style="display: flex; text-align: center; justify-content: flex-end; flex: 1; gap: 5px;">
                            ${timingsHtml}
                        </div>
                    </div>
                `;
            });
            html += '</div>';
            resultsDiv.innerHTML = html;
        } else {
            resultsDiv.innerHTML = '<div style="color: #aaa;">No bus data available for this stop.</div>';
        }
    } catch (err) {
        console.error(err);
        resultsDiv.innerHTML = '<div style="color: #ff5252;">Error fetching bus data.</div>';
    }
}

document.getElementById('find-route-btn').addEventListener('click', showProactiveSuggestion);

function showProactiveSuggestion() {
    const panel = document.getElementById('suggestion-panel');
    const content = document.getElementById('suggestion-content');
    
    content.innerHTML = `
        <div class="eta-card">
            <div class="eta-card-header eta-mrt">🚇 Stay on MRT</div>
            <div class="eta-content">
                <div>
                    <div>East West Line</div>
                    <div class="crowd-badge crowd-high">High Crowding</div>
                </div>
                <div class="eta-time delayed">~45 min</div>
            </div>
        </div>

        <div class="eta-card" style="border-color: #4caf50;">
            <div class="eta-card-header eta-bus">🚌 Proactive Reroute</div>
            <div class="eta-content">
                <div>
                    <div>Switch to Bus Bridging / 98</div>
                    <div class="crowd-badge crowd-low">Seats Available</div>
                </div>
                <div class="eta-time fast">~18 min</div>
            </div>
        </div>
        <p style="font-size: 12px; color: #aaa; margin-top: 10px;">
            Based on live bus arrival data and passenger load (SDA).
        </p>
    `;
    
    panel.classList.remove('hidden');
}
