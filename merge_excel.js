const fs = require('fs');
const xlsx = require('xlsx');

// Read Excel
const wb = xlsx.readFile('MRT_Stations.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const excelData = xlsx.utils.sheet_to_json(ws);

// Read GeoJSON
const geojson = JSON.parse(fs.readFileSync('public/stations.geojson', 'utf8'));

// Create a map for easy lookup by lowercase name
const excelMap = {};
excelData.forEach(row => {
    if (row['Station Name']) {
        const nameKey = row['Station Name'].trim().toLowerCase().replace(/ mrt station/i, '');
        excelMap[nameKey] = row;
    }
});

// Update GeoJSON features
const newFeatures = geojson.features.map(f => {
    let nameKey = f.properties.name.trim().toLowerCase().replace(/ mrt station/i, '');
    
    // Some manual adjustments might be needed, but let's try direct match
    if (excelMap[nameKey]) {
        f.properties.color = excelMap[nameKey].Color.toLowerCase(); // Ensure lowercase
        f.properties.line = excelMap[nameKey].Line;
        f.properties.code = excelMap[nameKey].Code;
        // Optionally update name if you want to use the exact Excel name
        f.properties.name = excelMap[nameKey]['Station Name'];
    } else {
        // If not found, check if code matches any code
        // Simple fallback
        const codeArr = (f.properties.code || '').split(/[\/\s-]/);
        const match = excelData.find(r => {
           const rowCodes = (r.Code||'').split(/[\/\s-]/);
           return codeArr.some(c => rowCodes.includes(c));
        });
        if (match) {
            f.properties.color = match.Color.toLowerCase();
            f.properties.line = match.Line;
            f.properties.code = match.Code;
            f.properties.name = match['Station Name'];
        } else {
            // Default color
            f.properties.color = 'gray';
        }
    }
    return f;
});

geojson.features = newFeatures;
fs.writeFileSync('public/stations.geojson', JSON.stringify(geojson, null, 2));
console.log('Successfully updated stations.geojson with colors and lines from Excel.');
