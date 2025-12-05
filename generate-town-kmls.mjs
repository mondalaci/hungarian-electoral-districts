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

  let topoData;
  try {
    topoData = JSON.parse(await readFile(topoPath, 'utf-8'));
  } catch (err) {
    console.error(`Failed to read ${topoPath}: ${err.message}`);
    continue;
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
    // Convert "lat lon,lat lon,..." to KML format "lon,lat,0 lon,lat,0 ..."
    const coordinates = item.poligon
      .split(',')
      .map((coord) => {
        const [lat, lon] = coord.trim().split(' ');
        return `${lon},${lat},0`;
      })
      .join(' ');

    const styleIndex = index % colors.length;

    return `    <Placemark>
      <name>Szavazókör ${item.szk}</name>
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
