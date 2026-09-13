import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { downloadCities, writeAtomic } from '../src/lib/server/city-data.mjs';

const target = new URL('../src/lib/server/data/', import.meta.url);
const existing = JSON.parse(await readFile(new URL('cities.json', target), 'utf8'));
const cities = await downloadCities({ previousCount: existing.length });
const retrievedAt = new Date().toISOString().slice(0, 10);
await writeAtomic(fileURLToPath(new URL('cities.json', target)), JSON.stringify(cities));
await writeAtomic(
  fileURLToPath(new URL('NOTICE.md', target)),
  `City data: GeoNames cities15000 and admin1CodesASCII, retrieved ${retrievedAt}.\n\nSource: https://download.geonames.org/export/dump/\nLicence: Creative Commons Attribution 4.0, https://creativecommons.org/licenses/by/4.0/\nChanges: selected fields, expanded administrative region names, sorted by population.\n`,
);
console.log(`Saved ${cities.length.toLocaleString()} cities.`);
