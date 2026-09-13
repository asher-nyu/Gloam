/** @jest-environment node */
import { jest } from '@jest/globals';
import { zipSync, strToU8 } from 'fflate';
import { downloadCities, parseGeoNames, validateCityRows } from './city-data.mjs';

const cityLine = (id = '5128581', latitude = '40.71427', timezone = 'America/New_York') =>
  [
    id,
    'New York City',
    'New York City',
    '',
    latitude,
    '-74.00597',
    'P',
    'PPL',
    'US',
    '',
    'NY',
    '',
    '',
    '',
    '8804190',
    '',
    '10',
    timezone,
    '2026-09-13',
  ].join('\t');
const regions = 'US.NY\tNew York\tNew York\t5128638\n';
const small = { minCount: 1, minRegions: 1 };
function responses(
  zip = zipSync({ 'cities15000.txt': strToU8(cityLine()) }),
  regionText = regions,
) {
  return jest.fn<typeof fetch>(
    async (input) => new Response(String(input).endsWith('.zip') ? Buffer.from(zip) : regionText),
  );
}

test('downloads and decodes a real ZIP with validated administrative region and city fields', async () => {
  const fetcher = responses();
  const rows = await downloadCities({ ...small, fetcher });
  expect(rows).toEqual([
    [
      5128581,
      'New York City',
      'New York',
      'US',
      40.71427,
      -74.00597,
      'America/New_York',
      8804190,
      'New York City',
    ],
  ]);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test.each([
  ['malformed ZIP', strToU8('<html>Gateway error</html>')],
  ['unexpected ZIP contents', zipSync({ 'error.txt': strToU8('Unavailable') })],
  ['invalid city coordinates', zipSync({ 'cities15000.txt': strToU8(cityLine('5128581', '999')) })],
  [
    'unsupported city time zone',
    zipSync({ 'cities15000.txt': strToU8(cityLine('5128581', '40', 'Fake/City')) }),
  ],
])('rejects %s before a catalog can be published', async (_label, zip) => {
  await expect(downloadCities({ ...small, fetcher: responses(zip) })).rejects.toThrow();
});

test('rejects HTML region responses even when HTTP succeeds', async () => {
  await expect(
    downloadCities({ ...small, fetcher: responses(undefined, '<html>Unavailable</html>') }),
  ).rejects.toThrow('administrative region');
});

test('rejects incomplete, duplicated, or sharply reduced city catalogs', () => {
  const rows = parseGeoNames(cityLine(), regions, small);
  expect(() => validateCityRows(rows)).toThrow('number of cities');
  expect(() => validateCityRows([...rows, ...rows], { minCount: 1 })).toThrow('city record');
  expect(() => validateCityRows(rows, { minCount: 1, previousCount: 2 })).toThrow(
    'number of cities',
  );
  expect(() => parseGeoNames(cityLine(), regions, { minCount: 1 })).toThrow('incomplete');
});

test('HTTP failures and oversized downloads are rejected', async () => {
  const failed = jest.fn<typeof fetch>(async () => new Response('Unavailable', { status: 503 }));
  await expect(downloadCities({ ...small, fetcher: failed })).rejects.toThrow('503');
  const oversized = jest.fn<typeof fetch>(
    async () => new Response('x', { headers: { 'Content-Length': '999999999' } }),
  );
  await expect(downloadCities({ ...small, fetcher: oversized })).rejects.toThrow('size limit');
});

test('aborts a stalled download within the request timeout', async () => {
  const fetcher = jest.fn<typeof fetch>(
    (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
      }),
  );
  await expect(downloadCities({ ...small, timeoutMs: 20, fetcher })).rejects.toThrow('Aborted');
  expect(fetcher.mock.calls.every(([, init]) => init?.signal?.aborted)).toBe(true);
});
