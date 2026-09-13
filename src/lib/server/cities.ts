import { join } from 'node:path';
import { getCache } from '@vercel/functions';
import bundledCities from './data/cities.json';
import { CityCatalog } from './city-catalog';
import { readCityCache, validateCityRows, writeAtomic } from './city-data.mjs';
import { SharedCityCache, cityCacheNamespace, cityCacheKeyHash } from './city-shared-cache';

const cachePath = join(process.cwd(), '.cache', 'geonames-cities-v1.json');
const shared = new SharedCityCache(() =>
  getCache({
    namespace: cityCacheNamespace(process.env),
    keyHashFunction: cityCacheKeyHash,
  }),
);
const onVercel = process.env.VERCEL === '1';
export const cityCatalog = new CityCatalog({
  fallback: validateCityRows(bundledCities),
  load: onVercel ? () => shared.load() : () => readCityCache(cachePath),
  save: onVercel
    ? (snapshot) => shared.save(snapshot)
    : (snapshot) => writeAtomic(cachePath, JSON.stringify(snapshot)),
  reloadOnRefresh: onVercel,
});
