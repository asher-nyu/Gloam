/** @jest-environment node */
import { jest } from '@jest/globals';
import type { UvForecast } from '../domain/types';

interface SyntheticField {
  run: number;
  lead: number;
  irradiance: number;
}

// The GRIB decoder boundary is isolated; directory selection, file requests,
// forecast metadata checks, UV conversion, and API behavior run normally.
jest.unstable_mockModule('@azohra/meteo.grib', () => ({
  splitMessages: (bytes: Uint8Array) => [JSON.parse(new TextDecoder().decode(bytes))],
  parseFields: (value: SyntheticField) => {
    const at = new Date(value.run);
    return [
      {
        discipline: 0,
        section4: { forecastTime: value.lead },
        identification: {
          year: at.getUTCFullYear(),
          month: at.getUTCMonth() + 1,
          day: at.getUTCDate(),
          hour: at.getUTCHours(),
          minute: 0,
          second: 0,
        },
        section3: {},
        irradiance: value.irradiance,
      },
    ];
  },
  parseProduct: (value: { forecastTime: number }) => ({
    ...value,
    parameterCategory: 7,
    parameterNumber: 196,
    indicatorOfUnitOfTimeRange: 1,
    typeOfFirstFixedSurface: 1,
  }),
  parseGrid: () => ({}),
  decodeFieldValues: (field: { irradiance: number }) => ({ values: [field.irradiance] }),
  nearestGridpoint: () => ({ index: 0 }),
}));
jest.unstable_mockModule('@azohra/meteo.grib/j2k-node', () => ({
  createNodeJ2kDecoder: async () => () => new Float32Array(),
}));

const { getUv, uvIndex } = await import('./noaa');
const { GET } = await import('../../routes/api/uv/+server');
const originalFetch = globalThis.fetch;
const now = Date.parse('2026-10-01T18:00:00Z');
const latestRun = Date.parse('2026-10-01T12:00:00Z');
const olderRun = Date.parse('2026-09-30T12:00:00Z');
let irradiance = 0.25;
let publishedRun = latestRun;

function listing(run: number) {
  const firstLead = (Date.parse('2026-10-01T16:00:00Z') - run) / 3_600_000;
  return Array.from(
    { length: 8 },
    (_, index) =>
      `<a href="uv.t12z.grbf${String(firstLead + index).padStart(2, '0')}.grib2">forecast</a>`,
  ).join('\n');
}
const load = () => getUv(40.7128, -74.006, '2026-10-01', 'UTC', null);
const request = (date = '2026-10-01') =>
  GET({
    url: new URL(
      `http://localhost/api/uv?latitude=40.7128&longitude=-74.006&timezone=UTC&date=${date}`,
    ),
  } as Parameters<typeof GET>[0]);

beforeEach(() => {
  jest.useFakeTimers({ now });
  irradiance = 0.25;
  publishedRun = latestRun;
  globalThis.fetch = jest.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = String(input);
    const runDate = /uvi\.(\d{4})(\d{2})(\d{2})\//.exec(url)!;
    const run = Date.parse(`${runDate[1]}-${runDate[2]}-${runDate[3]}T12:00:00Z`);
    if (run !== publishedRun) return new Response('Unavailable', { status: 503 });
    if (url.endsWith('/')) return new Response(listing(run));
    const lead = Number(/grbf(\d+)\.grib2$/.exec(url)![1]);
    return new Response(new TextEncoder().encode(JSON.stringify({ run, lead, irradiance })));
  });
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('identical queries reread NOAA directories and files and show changed upstream values', async () => {
  const first = await load();
  expect(first.status).toBe('available');
  expect(first.points.map((point) => point.index)).toEqual(Array(8).fill(10));
  expect(globalThis.fetch).toHaveBeenCalledTimes(11);
  irradiance = 0.5;
  const second = await load();
  expect(second.status).toBe('available');
  expect(second.points.map((point) => point.index)).toEqual(Array(8).fill(20));
  expect(globalThis.fetch).toHaveBeenCalledTimes(22);
  expect(
    jest.mocked(globalThis.fetch).mock.calls.every(([, options]) => options?.cache === 'no-store'),
  ).toBe(true);
});

test('directory failure after success never reuses an earlier forecast or file', async () => {
  expect((await load()).status).toBe('available');
  jest
    .mocked(globalThis.fetch)
    .mockImplementation(async () => new Response('Unavailable', { status: 503 }));
  const failed = await load();
  expect(failed.status).toBe('unavailable');
  expect(failed.points).toEqual([]);
  expect(failed.modelRun).toBeNull();
  expect(globalThis.fetch).toHaveBeenCalledTimes(14);
});

test('file failures after success show unavailable points rather than preserved grid values', async () => {
  expect((await load()).status).toBe('available');
  const normal = jest.mocked(globalThis.fetch).getMockImplementation()!;
  jest
    .mocked(globalThis.fetch)
    .mockImplementation(async (input, options) =>
      String(input).endsWith('.grib2')
        ? new Response('Unavailable', { status: 503 })
        : normal(input, options),
    );
  const failed = await load();
  expect(failed.status).toBe('unavailable');
  expect(failed.points).toHaveLength(8);
  expect(failed.points.every((point) => point.index === null)).toBe(true);
  expect(globalThis.fetch).toHaveBeenCalledTimes(22);
});

test('an earlier NOAA model run is fetched live when it is the published run covering the evening', async () => {
  publishedRun = olderRun;
  const forecast = await load();
  expect(forecast.status).toBe('available');
  expect(forecast.modelRun).toBe('2026-09-30T12:00:00.000Z');
  const files = jest
    .mocked(globalThis.fetch)
    .mock.calls.map(([input]) => String(input))
    .filter((url) => url.endsWith('.grib2'));
  expect(files).toHaveLength(8);
  expect(files.every((url) => url.includes('/uvi.20260930/'))).toBe(true);
});

test('UV responses forbid caching and do not retain data after an upstream failure', async () => {
  const first = await request();
  expect(first.status).toBe(200);
  expect(first.headers.get('Cache-Control')).toBe('no-store');
  expect(((await first.json()) as UvForecast).status).toBe('available');
  jest
    .mocked(globalThis.fetch)
    .mockImplementation(async () => new Response('Unavailable', { status: 503 }));
  const failed = await request();
  expect(failed.headers.get('Cache-Control')).toBe('no-store');
  const forecast = (await failed.json()) as UvForecast;
  expect(forecast.status).toBe('unavailable');
  expect(forecast.points).toEqual([]);
});

test.each(['invalid', '2026-09-30', '2027-10-02'])(
  'UV validation error for %s is non-cacheable',
  async (date) => {
    const response = await request(date);
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  },
);

test('outside-horizon UV responses are non-cacheable and do not request NOAA files', async () => {
  const response = await request('2026-11-01');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(((await response.json()) as UvForecast).status).toBe('outside-horizon');
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test('UV conversion keeps missing values distinct from zero', () => {
  expect(uvIndex(0)).toBe(0);
  expect(uvIndex(0.25)).toBe(10);
  for (const value of [-1, 9999, Number.NaN, Number.POSITIVE_INFINITY])
    expect(uvIndex(value)).toBeNull();
});
