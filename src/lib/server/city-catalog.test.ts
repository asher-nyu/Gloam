/** @jest-environment node */
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jest } from '@jest/globals';
import { CityCatalog, CITY_REFRESH_MS, CITY_RETRY_MS } from './city-catalog';
import { readCityCache, writeAtomic } from './city-data.mjs';
import type { CityRow } from './city-data.mjs';

const original: CityRow = [
  5128581,
  'New York City',
  'New York',
  'US',
  40.71427,
  -74.00597,
  'America/New_York',
  8804190,
  'New York City',
];
const revised: CityRow = [...original];
revised[1] = 'New York';
revised[4] = 40.7128;
const quiet = () => {};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('search remains immediate while concurrent requests share one refresh; ID lookup awaits replacement', async () => {
  const pending = deferred<CityRow[]>();
  const download = jest.fn(() => pending.promise);
  const catalog = new CityCatalog({ fallback: [original], minCount: 1, download, report: quiet });
  const searches = await Promise.all(Array.from({ length: 12 }, () => catalog.search('nyc')));
  expect(searches.every((result) => result[0].name === 'New York City')).toBe(true);
  expect(download).toHaveBeenCalledTimes(1);
  let lookupFinished = false;
  const lookup = catalog.find(original[0]).then((city) => {
    lookupFinished = true;
    return city;
  });
  await Promise.resolve();
  expect(lookupFinished).toBe(false);
  pending.resolve([revised]);
  expect(await lookup).toMatchObject({ name: 'New York', latitude: 40.7128 });
  expect((await catalog.search('new york, US'))[0].name).toBe('New York');
  expect(download).toHaveBeenCalledTimes(1);
});

test('revalidates at 24 hours, including a successful refresh at clock zero', async () => {
  let now = 0;
  const download = jest.fn(async () => [revised]);
  const catalog = new CityCatalog({
    fallback: [original],
    minCount: 1,
    download,
    now: () => now,
    report: quiet,
  });
  await catalog.refreshIfDue();
  await catalog.refreshIfDue();
  now = CITY_REFRESH_MS - 1;
  await catalog.refreshIfDue();
  expect(download).toHaveBeenCalledTimes(1);
  now++;
  await catalog.refreshIfDue();
  expect(download).toHaveBeenCalledTimes(2);
});

test('failed refreshes retain valid cities, back off exponentially, and recover', async () => {
  let now = 0;
  const download = jest
    .fn<() => Promise<CityRow[]>>()
    .mockRejectedValueOnce(new Error('Network down'))
    .mockResolvedValueOnce([])
    .mockResolvedValue([revised]);
  const catalog = new CityCatalog({
    fallback: [original],
    minCount: 1,
    download,
    now: () => now,
    report: quiet,
  });
  expect((await catalog.find(original[0]))?.name).toBe('New York City');
  now = CITY_RETRY_MS - 1;
  await catalog.refreshIfDue();
  expect(download).toHaveBeenCalledTimes(1);
  now++;
  await catalog.refreshIfDue();
  expect((await catalog.find(original[0]))?.name).toBe('New York City');
  now += CITY_RETRY_MS * 2 - 1;
  await catalog.refreshIfDue();
  expect(download).toHaveBeenCalledTimes(2);
  now++;
  expect((await catalog.find(original[0]))?.name).toBe('New York');
  expect(download).toHaveBeenCalledTimes(3);
});

test('a synchronous downloader error also clears the in-flight refresh', async () => {
  let now = 0;
  const download = jest
    .fn<() => Promise<CityRow[]>>()
    .mockImplementationOnce(() => {
      throw new Error('Unavailable');
    })
    .mockResolvedValue([revised]);
  const catalog = new CityCatalog({
    fallback: [original],
    minCount: 1,
    download,
    now: () => now,
    report: quiet,
  });
  await catalog.refreshIfDue();
  now += CITY_RETRY_MS;
  expect((await catalog.find(original[0]))?.name).toBe('New York');
});

test('a validated atomic disk snapshot survives a new server instance', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gloam-city-test-'));
  try {
    const path = join(directory, 'cities.json');
    const download = jest.fn(async () => [revised]);
    const options = {
      fallback: [original],
      minCount: 1,
      download,
      now: () => 1000,
      report: quiet,
      load: () => readCityCache(path),
      save: (snapshot: unknown) => writeAtomic(path, JSON.stringify(snapshot)),
    };
    await new CityCatalog(options).refreshIfDue();
    expect(await readdir(directory)).toEqual(['cities.json']);
    expect((await new CityCatalog(options).find(original[0]))?.name).toBe('New York');
    expect(download).toHaveBeenCalledTimes(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('malformed persisted data cannot replace the bundled fallback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gloam-city-test-'));
  try {
    const path = join(directory, 'cities.json');
    await writeFile(path, JSON.stringify({ version: 1, checkedAt: 1000, rows: [] }));
    const download = jest.fn<() => Promise<CityRow[]>>().mockRejectedValue(new Error('Offline'));
    const catalog = new CityCatalog({
      fallback: [original],
      minCount: 1,
      download,
      now: () => 1000,
      report: quiet,
      load: () => readCityCache(path),
    });
    expect((await catalog.find(original[0]))?.name).toBe('New York City');
    expect(download).toHaveBeenCalledTimes(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('an unwritable cache keeps refreshed cities in memory without repeated downloads', async () => {
  const download = jest.fn(async () => [revised]);
  const report = jest.fn();
  const catalog = new CityCatalog({
    fallback: [original],
    minCount: 1,
    download,
    save: async () => {
      throw new Error('Read-only filesystem');
    },
    report,
  });
  expect((await catalog.find(original[0]))?.name).toBe('New York');
  expect(await catalog.find(9999)).toBeNull();
  expect(download).toHaveBeenCalledTimes(1);
  expect(report).toHaveBeenCalledWith(
    expect.stringContaining('refreshed in memory'),
    expect.any(Error),
  );
});

test('search registers its complete refresh with the request lifetime before returning', async () => {
  const pending = deferred<CityRow[]>();
  const keepAlive = jest.fn<(work: Promise<void>) => void>();
  const save = jest.fn(async () => {});
  const catalog = new CityCatalog({
    fallback: [original],
    minCount: 1,
    download: () => pending.promise,
    save,
    report: quiet,
  });
  expect((await catalog.search('New York', keepAlive))[0].name).toBe('New York City');
  expect(keepAlive).toHaveBeenCalledTimes(1);
  let complete = false;
  const background = keepAlive.mock.calls[0][0].then(() => {
    complete = true;
  });
  await Promise.resolve();
  expect(complete).toBe(false);
  pending.resolve([revised]);
  await background;
  expect(save).toHaveBeenCalledTimes(1);
  expect(complete).toBe(true);
});

test('a due instance adopts another instance’s fresh shared catalog before downloading', async () => {
  let now = 1000;
  const load = jest
    .fn<() => Promise<unknown>>()
    .mockResolvedValueOnce({ version: 1, checkedAt: now, rows: [original] })
    .mockImplementation(async () => ({ version: 1, checkedAt: now, rows: [revised] }));
  const download = jest.fn(async () => [revised]);
  const catalog = new CityCatalog({
    fallback: [original],
    minCount: 1,
    load,
    download,
    now: () => now,
    reloadOnRefresh: true,
    report: quiet,
  });
  expect((await catalog.find(original[0]))?.name).toBe('New York City');
  expect(load).toHaveBeenCalledTimes(1);
  now += CITY_REFRESH_MS;
  expect((await catalog.find(original[0]))?.name).toBe('New York');
  expect(load).toHaveBeenCalledTimes(2);
  expect(download).not.toHaveBeenCalled();
});

test('shared-cache read failure falls back to a fresh download', async () => {
  const load = jest.fn<() => Promise<unknown>>().mockRejectedValue(new Error('Cache unavailable'));
  const download = jest.fn(async () => [revised]);
  const catalog = new CityCatalog({
    fallback: [original],
    minCount: 1,
    load,
    download,
    reloadOnRefresh: true,
    report: quiet,
  });
  expect((await catalog.find(original[0]))?.name).toBe('New York');
  expect(download).toHaveBeenCalledTimes(1);
});
