/** @jest-environment node */
import { gzipSync } from 'node:zlib';
import { jest } from '@jest/globals';
import bundled from './data/cities.json' with { type: 'json' };
import { validateCityRows } from './city-data.mjs';
import { type CitySnapshot } from './city-catalog';
import {
  SharedCityCache,
  CITY_CACHE_CHUNK_CHARS,
  CITY_CACHE_MAX_JSON_BYTES,
  cityCacheNamespace,
  cityCacheKeyHash,
} from './city-shared-cache';

const row = validateCityRows(bundled)[0];
const small: CitySnapshot = { version: 1, checkedAt: 1000, rows: [row] };
const options = { minCount: 1, now: () => 1000 };
const manifestKey = 'geonames-v1:manifest';
function memoryCache() {
  const values = new Map<string, unknown>();
  return {
    values,
    get: jest.fn(async (key: string) => values.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      values.set(key, structuredClone(value));
    }),
  };
}
function seed(cache: ReturnType<typeof memoryCache>, bytes: Buffer, jsonBytes: number) {
  const encoded = bytes.toString('base64');
  const revision = cityCacheKeyHash(encoded);
  const parts = Math.ceil(encoded.length / CITY_CACHE_CHUNK_CHARS);
  cache.values.set(manifestKey, {
    version: 1,
    encoding: 'gzip-base64',
    revision,
    parts,
    compressedBytes: bytes.length,
    jsonBytes,
  });
  for (let i = 0; i < parts; i++)
    cache.values.set(
      `geonames-v1:${revision}:${i}`,
      encoded.slice(i * CITY_CACHE_CHUNK_CHARS, (i + 1) * CITY_CACHE_CHUNK_CHARS),
    );
}

test('a complete real catalog survives a new instance and each cache item stays below 2 MB', async () => {
  const cache = memoryCache();
  const snapshot: CitySnapshot = { version: 1, checkedAt: 1000, rows: validateCityRows(bundled) };
  const writer = new SharedCityCache(() => cache, options);
  await writer.save(snapshot);
  const manifest = cache.values.get(manifestKey) as { parts: number };
  expect(manifest.parts).toBeGreaterThan(1);
  expect(
    [...cache.values.values()].every(
      (value) => Buffer.byteLength(JSON.stringify(value)) < 2_000_000,
    ),
  ).toBe(true);
  expect(cache.set.mock.calls.at(-1)?.[0]).toBe(manifestKey);
  expect(await new SharedCityCache(() => cache, options).load()).toEqual(snapshot);
});

test('an evicted manifest is an ordinary cache miss', async () => {
  const cache = memoryCache();
  expect(await new SharedCityCache(() => cache, options).load()).toBeNull();
  expect(cache.get).toHaveBeenCalledTimes(1);
});

test.each(['missing', 'corrupt'])(
  'rejects a %s chunk instead of returning partial catalog data',
  async (failure) => {
    const cache = memoryCache();
    const shared = new SharedCityCache(() => cache, options);
    await shared.save(small);
    const key = [...cache.values.keys()].find((key) => key !== manifestKey)!;
    if (failure === 'missing') cache.values.delete(key);
    else {
      const chunk = String(cache.values.get(key));
      cache.values.set(key, (chunk[0] === 'A' ? 'B' : 'A') + chunk.slice(1));
    }
    await expect(shared.load()).rejects.toThrow(failure === 'missing' ? 'incomplete' : 'checksum');
  },
);

test('a silently dropped chunk write leaves the last complete manifest available', async () => {
  const cache = memoryCache();
  const shared = new SharedCityCache(() => cache, options);
  await shared.save(small);
  const originalManifest = cache.values.get(manifestKey);
  cache.set.mockImplementation(async (key, value) => {
    if (!key.endsWith(':1')) cache.values.set(key, value);
  });
  await expect(shared.save({ ...small, rows: validateCityRows(bundled) })).rejects.toThrow(
    'every chunk',
  );
  expect(cache.values.get(manifestKey)).toEqual(originalManifest);
  expect(await shared.load()).toEqual(small);
});

test.each([
  ['unsupported version', { version: 2 }],
  ['too many chunks', { parts: 100_000 }],
  ['oversized inflated content', { jsonBytes: CITY_CACHE_MAX_JSON_BYTES + 1 }],
])('rejects %s in a manifest before reading chunks', async (_label, invalid) => {
  const cache = memoryCache();
  const shared = new SharedCityCache(() => cache, options);
  await shared.save(small);
  cache.values.set(manifestKey, { ...(cache.values.get(manifestKey) as object), ...invalid });
  cache.get.mockClear();
  await expect(shared.load()).rejects.toThrow('manifest');
  expect(cache.get).toHaveBeenCalledTimes(1);
});

test('bounded decompression rejects content larger than its declared limit', async () => {
  const cache = memoryCache();
  seed(cache, gzipSync(Buffer.alloc(1025, 'x')), 1024);
  await expect(new SharedCityCache(() => cache, options).load()).rejects.toMatchObject({
    code: 'ERR_BUFFER_TOO_LARGE',
  });
});

test('correctly hashed cached JSON still has to pass full city validation', async () => {
  const cache = memoryCache();
  const json = Buffer.from(JSON.stringify({ ...small, rows: [] }));
  seed(cache, gzipSync(json), json.length);
  await expect(new SharedCityCache(() => cache, options).load()).rejects.toThrow(
    'number of cities',
  );
});

test('cache read and write stalls are bounded', async () => {
  const stalled = new Promise<never>(() => {});
  const cache = { get: jest.fn(() => stalled), set: jest.fn(() => stalled) };
  const shared = new SharedCityCache(() => cache, { ...options, timeoutMs: 20 });
  await expect(shared.load()).rejects.toThrow('timed out');
  await expect(shared.save(small)).rejects.toThrow('timed out');
});

test('cache failures propagate without publishing a manifest', async () => {
  const cache = memoryCache();
  cache.set.mockRejectedValue(new Error('Cache unavailable'));
  await expect(new SharedCityCache(() => cache, options).save(small)).rejects.toThrow(
    'Cache unavailable',
  );
  expect(cache.values.has(manifestKey)).toBe(false);
});

test('project namespaces isolate Hobby projects while remaining stable across deployments', () => {
  const a = { VERCEL_PROJECT_ID: 'prj_a', VERCEL_DEPLOYMENT_ID: 'dpl_one' };
  expect(cityCacheNamespace(a)).toBe(cityCacheNamespace({ ...a, VERCEL_DEPLOYMENT_ID: 'dpl_two' }));
  expect(cityCacheNamespace(a)).not.toBe(cityCacheNamespace({ VERCEL_PROJECT_ID: 'prj_b' }));
  expect(cityCacheNamespace({ VERCEL_PROJECT_PRODUCTION_URL: 'gloam.vercel.app' })).toContain(
    'gloam.vercel.app',
  );
  expect(() => cityCacheNamespace({})).toThrow('project identifier');
});
