require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const NodeCache = require('node-cache');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize cache with 60 seconds TTL
const cache = new NodeCache({ stdTTL: 60 });

app.use(cors());
app.use(express.static('public'));

const DATAMALL_URL = 'https://datamall2.mytransport.sg/ltaodataservice';
const API_KEY = process.env.LTA_DATAMALL_API_KEY;

// Helper to read mock data
const getMockData = (filename) => {
    try {
        const data = fs.readFileSync(path.join(__dirname, 'mock-data', filename), 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error(`Failed to read mock data: ${filename}`, err);
        return null;
    }
};

// Generic proxy route with caching and fallback
app.get('/api/:endpoint', async (req, res) => {
    const endpointMap = {
        'alerts': 'TrainServiceAlerts',
        'bus-stops': 'BusStops',
        'bus-routes': 'BusRoutes',
        'bus-arrival': 'BusArrivalv2'
    };

    const targetEndpoint = endpointMap[req.params.endpoint];
    if (!targetEndpoint) {
        return res.status(404).json({ error: 'Endpoint not found' });
    }

    // Include query params in cache key
    const cacheKey = `${req.params.endpoint}_${JSON.stringify(req.query)}`;
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
        console.log(`Serving ${req.params.endpoint} from cache`);
        return res.json(cachedData);
    }

    try {
        if (!API_KEY) {
            throw new Error('No API key configured');
        }

        let url = `${DATAMALL_URL}/${targetEndpoint}`;
        // v3 path override for BusArrival
        if (targetEndpoint === 'BusArrivalv2') {
            url = `${DATAMALL_URL}/v3/BusArrival`;
        }

        const response = await axios.get(url, {
            headers: { 'AccountKey': API_KEY, 'accept': 'application/json' },
            params: req.query,
            timeout: 5000 // 5 second timeout
        });

        // Cache the successful response
        cache.set(cacheKey, response.data);
        console.log(`Serving ${req.params.endpoint} from LTA DataMall`);
        res.json(response.data);
    } catch (error) {
        console.error(`Error fetching ${req.params.endpoint}, falling back to mock.`, error.message);
        
        // Map to mock files
        const mockMap = {
            'alerts': 'train-alerts.json',
            'bus-stops': 'bus-stops.json',
            'bus-routes': 'bus-routes.json',
            'bus-arrival': 'bus-arrival.json'
        };
        
        const mockData = getMockData(mockMap[req.params.endpoint]);
        if (mockData) {
            // Optional: cache the mock data briefly so it doesn't repeatedly fail rapidly
            cache.set(cacheKey, mockData, 15);
            res.json(mockData);
        } else {
            res.status(500).json({ error: 'Failed to fetch data and no mock available.' });
        }
    }
});

app.listen(PORT, () => {
    console.log(`Smart Commuter Companion server running on http://localhost:${PORT}`);
});
