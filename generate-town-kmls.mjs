#!/usr/bin/env node

import { mkdir, writeFile, readFile } from 'fs/promises';

// Color palette for voting districts (KML uses AABBGGRR format - Alpha, Blue, Green, Red)
const colors = [
  '7f0000ff', // red
  '7f00ff00', // green
  '7fff0000', // blue
  '7f00ffff', // yellow
  '7fff00ff', // magenta
  '7fffff00', // cyan
  '7f0080ff', // orange
  '7f800080', // purple
  '7f008080', // teal
  '7f80ff00', // lime
  '7fff8000', // sky blue
  '7f8000ff', // pink
];

// Read the settlements data
const telepulesek = JSON.parse(await readFile('fetch/ver-Telepulesek.json', 'utf-8'));

await mkdir('kml', { recursive: true });

for (const record of telepulesek.list) {
  const { maz, taz, megnev } = record.leiro;
  const topoPath = `fetch/${maz}/${taz}/Szavkor-Topo.json`;
  const korzethatarPath = `fetch/${maz}/${taz}/Korzethatar.json`;

  let topoData;
  try {
    topoData = JSON.parse(await readFile(topoPath, 'utf-8'));
  } catch (err) {
    console.error(`Failed to read ${topoPath}: ${err.message}`);
    continue;
  }

  // Load voter count data (optional - may not exist for all settlements)
  let voterCountByDistrict = {};
  try {
    const szavazokorokPath = `fetch/${maz}/${taz}/Szavazokorok.json`;
    const szavazokorokData = JSON.parse(await readFile(szavazokorokPath, 'utf-8'));
    for (const szk of szavazokorokData.data.szavazokorok) {
      voterCountByDistrict[szk.leiro.sorszam] = szk.letszam.onkVp;
    }
  } catch (err) {
    // Szavazokorok.json may not exist for all settlements - that's OK
  }

  // Load boundary streets data (optional - may not exist for all settlements)
  let streetsByDistrict = {};
  try {
    const korzethatarData = JSON.parse(await readFile(korzethatarPath, 'utf-8'));
    // Group streets by szavkor
    for (const item of korzethatarData.data.korzethatarok) {
      const szk = item.szavkor;
      if (!streetsByDistrict[szk]) {
        streetsByDistrict[szk] = [];
      }
      // Build street entry with house number range if available
      const streetEntry = formatStreetEntry(item);
      streetsByDistrict[szk].push(streetEntry);
    }
    // Sort streets alphabetically within each district
    for (const szk of Object.keys(streetsByDistrict)) {
      streetsByDistrict[szk].sort((a, b) => a.localeCompare(b, 'hu'));
    }
  } catch (err) {
    // Korzethatar.json may not exist for all settlements - that's OK
  }

  // Generate styles for each color
  const styles = colors.map((color, i) => `    <Style id="style${i}">
      <LineStyle>
        <color>ff000000</color>
        <width>1</width>
      </LineStyle>
      <PolyStyle>
        <color>${color}</color>
      </PolyStyle>
    </Style>`).join('\n');

  // Build KML content
  const placemarks = topoData.list.map((item, index) => {
    // Convert "lat lon,lat lon,..." to numeric [lon, lat] pairs
    let points = item.poligon.split(',').map((coord) => {
      const [lat, lon] = coord.trim().split(' ');
      return [parseFloat(lon), parseFloat(lat)];
    });

    // Simplify polygon using Douglas-Peucker algorithm
    // This removes micro-variations that cause Google My Maps rendering issues
    // epsilon = 0.0001 degrees ≈ 10 meters
    points = douglasPeucker(points, 0.0001);

    // Convert to KML coordinate strings
    let coordPairs = points.map(([lon, lat]) => `${lon.toFixed(6)},${lat.toFixed(6)},0`);

    // Ensure polygon is closed (first point == last point)
    if (coordPairs.length > 0 && coordPairs[0] !== coordPairs[coordPairs.length - 1]) {
      coordPairs.push(coordPairs[0]);
    }

    const coordinates = coordPairs.join(' ');

    const styleIndex = index % colors.length;

    // Get streets for this district
    const streets = streetsByDistrict[item.szk] || [];
    const streetList = streets.length > 0
      ? streets.join(', ')
      : 'Nincs adat';

    // Get voter count for this district
    const onkVp = voterCountByDistrict[item.szk];
    const voterCountLine = onkVp !== undefined
      ? `Önkormányzati választásra jogosultak száma 2024-ben: ${onkVp}<br/>`
      : '';

    // Build description with street boundaries
    const description = `<![CDATA[
${voterCountLine}<b>A szavazókörhöz tartozó címek:</b><br/>
${streetList}
]]>`;

    return `    <Placemark>
      <name>Szavazókör ${item.szk}</name>
      <description>${description}</description>
      <styleUrl>#style${styleIndex}</styleUrl>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${coordinates}</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>`;
  });

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(megnev)}</name>
${styles}
${placemarks.join('\n')}
  </Document>
</kml>
`;

  // Sanitize filename (remove characters not allowed in filenames)
  const safeFilename = megnev.replace(/[<>:"/\\|?*]/g, '_');
  const outputPath = `kml/${safeFilename}.kml`;

  await writeFile(outputPath, kml);
  console.log(`Created ${outputPath}`);
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Parse house number string like "000001/A" -> { num: 1, suffix: "/A" }
function parseHouseNumber(hsz) {
  if (!hsz) return null;
  // Match leading digits, then optional suffix
  const match = hsz.match(/^0*(\d+)(.*)$/);
  if (!match) return null;
  return { num: parseInt(match[1], 10), suffix: match[2] || '' };
}

// Format a single street entry with house number range
function formatStreetEntry(item) {
  const streetName = `${item.kt_nev} ${item.kt_jelleg}`;

  // int_tip: 2 = full street, 3 = even, 4 = odd, 5 = specific range
  if (item.int_tip === '2') {
    // Full street, no house numbers needed
    return streetName;
  }

  const kezd = parseHouseNumber(item.kezd_hsz);
  const zaro = parseHouseNumber(item.zaro_hsz);

  if (!kezd || !zaro) {
    return streetName;
  }

  // Format the range
  let range;
  if (kezd.num === zaro.num && kezd.suffix === zaro.suffix) {
    // Single house number
    range = `${kezd.num}${kezd.suffix}`;
  } else {
    // Range of house numbers
    const kezdStr = `${kezd.num}${kezd.suffix}`;
    const zaroStr = zaro.num >= 999998 ? '' : `${zaro.num}${zaro.suffix}`;

    if (zaroStr) {
      range = `${kezdStr}-${zaroStr}`;
    } else {
      // Open-ended range (999999 means "to the end")
      range = `${kezdStr}-`;
    }
  }

  // Determine parity annotation
  let parityNote = '';
  if (item.int_tip === '3') {
    parityNote = ' (páros)';
  } else if (item.int_tip === '4') {
    parityNote = ' (páratlan)';
  } else if (item.int_tip === '5') {
    // Check if both numbers have same parity
    if (kezd.num % 2 === 0 && zaro.num % 2 === 0 && zaro.num < 999998) {
      parityNote = ' (páros)';
    } else if (kezd.num % 2 === 1 && zaro.num % 2 === 1 && zaro.num < 999998) {
      parityNote = ' (páratlan)';
    }
  }

  return `${streetName} ${range}${parityNote}`;
}

// Douglas-Peucker polygon simplification algorithm
// Reduces the number of points while preserving the overall shape
// epsilon: maximum perpendicular distance threshold (in degrees)
function douglasPeucker(points, epsilon) {
  if (points.length < 3) return points;

  // Find the point with the maximum distance from the line between first and last
  let maxDist = 0;
  let maxIndex = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  // If max distance is greater than epsilon, recursively simplify
  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIndex + 1), epsilon);
    const right = douglasPeucker(points.slice(maxIndex), epsilon);
    return left.slice(0, -1).concat(right);
  } else {
    // All points between first and last are within epsilon, keep only endpoints
    return [points[0], points[points.length - 1]];
  }
}

// Calculate perpendicular distance from a point to a line segment
function perpendicularDistance(point, lineStart, lineEnd) {
  const [px, py] = point;
  const [x1, y1] = lineStart;
  const [x2, y2] = lineEnd;

  const dx = x2 - x1;
  const dy = y2 - y1;

  // Handle degenerate case where line segment is a point
  if (dx === 0 && dy === 0) {
    return Math.sqrt(Math.pow(px - x1, 2) + Math.pow(py - y1, 2));
  }

  // Calculate parameter t for closest point on line
  const t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);

  let nearestX, nearestY;
  if (t < 0) {
    nearestX = x1;
    nearestY = y1;
  } else if (t > 1) {
    nearestX = x2;
    nearestY = y2;
  } else {
    nearestX = x1 + t * dx;
    nearestY = y1 + t * dy;
  }

  return Math.sqrt(Math.pow(px - nearestX, 2) + Math.pow(py - nearestY, 2));
}
