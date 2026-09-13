import { unzip } from 'fflate';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

/** @typedef {[number, string, string, string, number, number, string, number, string]} CityRow */

export const MIN_CITY_COUNT = 20_000;
const MAX_CITY_COUNT = 100_000;
const MAX_TEXT_BYTES = 50 * 1024 * 1024;
const source = 'https://download.geonames.org/export/dump/';

/**
 * Validate every record before replacing a working catalog. The count floor and
 * shrink limit also reject valid-looking but truncated upstream exports.
 * @param {unknown} value
 * @param {{ minCount?: number, previousCount?: number }} options
 * @returns {CityRow[]}
 */
export function validateCityRows(value, { minCount = MIN_CITY_COUNT, previousCount = 0 } = {}) {
  if (
    !Array.isArray(value) ||
    value.length < minCount ||
    value.length > MAX_CITY_COUNT ||
    value.length < previousCount * 0.9
  ) {
    throw new Error('GeoNames catalog has an unexpected number of cities.');
  }
  const ids = new Set();
  const timezones = new Set();
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== 9) throw new Error('Invalid GeoNames city record.');
    const [id, name, region, country, latitude, longitude, timezone, population, ascii] = row;
    if (
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      ids.has(id) ||
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 200 ||
      typeof ascii !== 'string' ||
      !ascii.trim() ||
      ascii.length > 200 ||
      typeof region !== 'string' ||
      region.length > 200 ||
      typeof country !== 'string' ||
      !/^[A-Z]{2}$/.test(country) ||
      !Number.isFinite(latitude) ||
      Math.abs(latitude) > 90 ||
      !Number.isFinite(longitude) ||
      Math.abs(longitude) > 180 ||
      !Number.isSafeInteger(population) ||
      population < 0 ||
      typeof timezone !== 'string' ||
      !timezone ||
      timezone.length > 100
    )
      throw new Error('Invalid GeoNames city record.');
    ids.add(id);
    if (!timezones.has(timezone)) {
      try {
        new Intl.DateTimeFormat('en', { timeZone: timezone }).format(0);
      } catch {
        throw new Error('Invalid GeoNames city time zone.');
      }
      timezones.add(timezone);
    }
  }
  return /** @type {CityRow[]} */ (value);
}

/**
 * GeoNames field definitions: https://download.geonames.org/export/dump/readme.txt
 * @param {string} cityText
 * @param {string} regionText
 * @param {{ minCount?: number, minRegions?: number, previousCount?: number }} options
 */
export function parseGeoNames(cityText, regionText, options = {}) {
  const regions = new Map();
  for (const line of regionText.trim().split(/\r?\n/)) {
    const fields = line.split('\t');
    if (fields.length !== 4 || !/^[A-Z]{2}\..+$/.test(fields[0]) || !fields[1].trim()) {
      throw new Error('Invalid GeoNames administrative region export.');
    }
    regions.set(fields[0], fields[1]);
  }
  if (regions.size < (options.minRegions ?? 1_000)) {
    throw new Error('GeoNames administrative region export is incomplete.');
  }
  const rows = cityText
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const fields = line.split('\t');
      if (
        fields.length !== 19 ||
        !/^\d+$/.test(fields[0]) ||
        !/^-?\d+(\.\d+)?$/.test(fields[4]) ||
        !/^-?\d+(\.\d+)?$/.test(fields[5]) ||
        !/^\d+$/.test(fields[14]) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(fields[18])
      )
        throw new Error('Invalid GeoNames city export.');
      return [
        Number(fields[0]),
        fields[1],
        regions.get(`${fields[8]}.${fields[10]}`) ?? '',
        fields[8],
        Number(fields[4]),
        Number(fields[5]),
        fields[17],
        Number(fields[14]),
        fields[2],
      ];
    });
  return validateCityRows(rows, options).sort((a, b) => b[7] - a[7]);
}

/** @param {Response} response @param {number} limit */
async function readBounded(response, limit) {
  if (!response.ok) throw new Error(`GeoNames download failed (${response.status}).`);
  if (!response.body || Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new Error('GeoNames download exceeds the size limit.');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('GeoNames download exceeds the size limit.');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

/** @param {Uint8Array} bytes @param {number} timeoutMs @returns {Promise<string>} */
function extractCities(bytes, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stop = () => {};
    const timer = setTimeout(() => {
      stop();
      reject(new Error('GeoNames ZIP extraction timed out.'));
    }, timeoutMs);
    try {
      stop = unzip(
        bytes,
        {
          filter: (file) =>
            file.name === 'cities15000.txt' &&
            file.originalSize > 0 &&
            file.originalSize <= MAX_TEXT_BYTES,
        },
        (error, files) => {
          clearTimeout(timer);
          if (error) return reject(new Error('Invalid GeoNames ZIP archive.', { cause: error }));
          const text = files['cities15000.txt'];
          if (!text || text.length > MAX_TEXT_BYTES)
            return reject(new Error('GeoNames ZIP is missing its city export.'));
          try {
            resolve(new TextDecoder('utf-8', { fatal: true }).decode(text));
          } catch (error) {
            reject(error);
          }
        },
      );
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

/**
 * @param {{ fetcher?: typeof fetch, timeoutMs?: number, minCount?: number, minRegions?: number, previousCount?: number }} options
 * @returns {Promise<CityRow[]>}
 */
export async function downloadCities({ fetcher = fetch, timeoutMs = 30_000, ...validation } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const [zip, regionBytes] = await Promise.all([
      fetcher(`${source}cities15000.zip`, { signal: controller.signal }).then((response) =>
        readBounded(response, 15 * 1024 * 1024),
      ),
      fetcher(`${source}admin1CodesASCII.txt`, { signal: controller.signal }).then((response) =>
        readBounded(response, 2 * 1024 * 1024),
      ),
    ]);
    const cityText = await extractCities(zip, 5_000);
    const regionText = new TextDecoder('utf-8', { fatal: true }).decode(regionBytes);
    return parseGeoNames(cityText, regionText, validation);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/** @param {string} path @param {string} content */
export async function writeAtomic(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** @param {string} path */
export async function readCityCache(path) {
  if ((await stat(path)).size > 25 * 1024 * 1024)
    throw new Error('City cache exceeds the size limit.');
  return JSON.parse(await readFile(path, 'utf8'));
}
