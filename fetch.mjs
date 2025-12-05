#!/usr/bin/env node

import { mkdir, writeFile, readFile } from 'fs/promises';

const urls = [
  'https://vtr.valasztas.hu/ep2024/data/06091753/ver/Valleir.json',
  'https://vtr.valasztas.hu/ep2024/data/06091753/ver/Megyek.json',
  'https://vtr.valasztas.hu/ep2024/data/06091753/ver/Telepulesek.json',
  'https://vtr.valasztas.hu/ep2024/data/06091856/napkozi/ReszvetelOrszag.json',
  'https://vtr.valasztas.hu/ep2024/data/06201531/szavossz/ReszvetelOrszag.json',
  'https://vtr.valasztas.hu/ep2024/data/06091856/napkozi/ReszvetelOrszag.json',
  'https://vtr.valasztas.hu/ep2024/data/06091753/ver/03/MegyeReszletes-03.json',
];

await mkdir('fetch', { recursive: true });

for (const url of urls) {
  const parts = url.split('/');
  const filename = `${parts[parts.length - 2]}-${parts[parts.length - 1]}`;
  const outputPath = `fetch/${filename}`;

  console.log(`Fetching ${url}...`);
  const response = await fetch(url);
  const data = await response.json();

  await writeFile(outputPath, JSON.stringify(data, null, 2));
  console.log(`Saved to ${outputPath}`);
}

// Fetch settlement data based on Telepulesek
const telepulesek = JSON.parse(await readFile('fetch/ver-Telepulesek.json', 'utf-8'));

// Track which maz values we've fetched Telep-Topo for (one per county)
const fetchedTelepTopo = new Set();

for (const record of telepulesek.list) {
  const { maz, taz } = record.leiro;

  const dir = `fetch/${maz}/${taz}`;
  await mkdir(dir, { recursive: true });

  // URLs to fetch for each settlement
  const settlementUrls = [
    `https://vtr.valasztas.hu/ep2024/data/06091753/ver/${maz}/TelepulesReszletes-${maz}-${taz}.json`,
    `https://vtr.valasztas.hu/ep2024/data/06091753/ver/${maz}/Szavazokorok-${maz}-${taz}.json`,
    `https://vtr.valasztas.hu/ep2024/data/06091753/ver/${maz}/SzavkorKereso-${maz}-${taz}.json`,
    `https://vtr.valasztas.hu/ep2024/data/06091753/ver/${maz}/Szavkor-Topo-${maz}-${taz}.json`,
    `https://vtr.valasztas.hu/ep2024/data/06091753/ver/${maz}/Korzethatar-${maz}-${taz}.json`,
  ];

  // Telep-Topo is per county (maz), not per settlement - save in county dir
  if (!fetchedTelepTopo.has(maz)) {
    settlementUrls.push(`https://vtr.valasztas.hu/ep2024/data/06091753/ver/${maz}/Telep-Topo-${maz}.json`);
    fetchedTelepTopo.add(maz);
  }

  for (const url of settlementUrls) {
    // Deduce filename from URL: extract base name before the codes (e.g., "TelepulesReszletes-03-005.json" -> "TelepulesReszletes.json")
    const urlFilename = url.split('/').pop();
    const filename = urlFilename.replace(/-[\d-]+\.json$/, '.json');
    // Telep-Topo goes in county dir, others go in settlement dir
    const isCountyLevel = urlFilename.startsWith('Telep-Topo');
    const outputPath = isCountyLevel ? `fetch/${maz}/${filename}` : `${dir}/${filename}`;

    console.log(`Fetching ${url}...`);
    const response = await fetch(url);
    const data = await response.json();

    await writeFile(outputPath, JSON.stringify(data, null, 2));
    console.log(`Saved to ${outputPath}`);
  }
}
