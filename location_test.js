import fetch from 'node-fetch';


async function geocode(location) {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(location)}`);
    const data = await response.json();
    console.log(data)
    return {
        latitude: parseFloat(data[0].lat),
        longitude: parseFloat(data[0].lon)
    };
}

function calculateDistance(coord1, coord2) {
    const R = 6371e3; // metres
    const φ1 = coord1.latitude * Math.PI/180; // φ, λ in radians
    const φ2 = coord2.latitude * Math.PI/180;
    const Δφ = (coord2.latitude-coord1.latitude) * Math.PI/180;
    const Δλ = (coord2.longitude-coord1.longitude) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; // in meters
}

async function main() {
    const location1 = 'Lansdale, PA';
    const location2 = 'Bavaria, germany';

    const coord1 = await geocode(location1);
    const coord2 = await geocode(location2);

    const distance = calculateDistance(coord1, coord2);
    
    console.log(`Distance between ${location1} and ${location2}: ${distance} meters`);
}

main();