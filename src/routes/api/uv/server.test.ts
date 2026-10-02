/** @jest-environment node */
import { jest } from '@jest/globals';
import type { UvForecast } from '$lib/domain/types';
import type { getUv as GetUv } from '$lib/server/noaa';
import type { getEvening as GetEvening } from '$lib/server/usno';

const getUv = jest.fn<typeof GetUv>();
const getEvening = jest.fn<typeof GetEvening>();
jest.unstable_mockModule('$lib/server/noaa', () => ({ getUv }));
jest.unstable_mockModule('$lib/server/usno', () => ({ getEvening }));
const { GET } = await import('./+server');

const forecast: UvForecast = {
  status: 'available',
  points: [{ at: '2026-10-01T20:00:00.000Z', index: 1.2 }],
  modelRun: '2026-10-01T12:00:00.000Z',
  retrievedAt: '2026-10-01T18:00:00.000Z',
  sourceUrl: 'https://nomads.ncep.noaa.gov/pub/data/nccf/com/uvi/prod/uvi.20261001/',
};
function request(sunset?: string, overrides: Record<string, string> = {}) {
  const query = new URLSearchParams({
    latitude: '40.7128',
    longitude: '-74.006',
    timezone: 'America/New_York',
    date: '2026-10-01',
    ...overrides,
  });
  if (sunset !== undefined) query.set('sunset', sunset);
  return GET({ url: new URL(`http://localhost/api/uv?${query}`) } as Parameters<typeof GET>[0]);
}
beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-01T18:00:00Z'));
  getUv.mockReset().mockResolvedValue(forecast);
  getEvening.mockReset().mockRejectedValue(new Error('USNO unavailable'));
});
afterEach(() => jest.restoreAllMocks());

test('a fresh client sunset is validated and forwarded to NOAA without contacting USNO', async () => {
  const response = await request('2026-10-01T18:38:00-04:00');
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toEqual(forecast);
  expect(getUv).toHaveBeenCalledWith(
    40.7128,
    -74.006,
    '2026-10-01',
    'America/New_York',
    '2026-10-01T22:38:00.000Z',
  );
  expect(getEvening).not.toHaveBeenCalled();
});

test('omitting sunset keeps UV independent of the astronomy connection', async () => {
  const response = await request();
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(getUv).toHaveBeenCalledWith(40.7128, -74.006, '2026-10-01', 'America/New_York', null);
  expect(getEvening).not.toHaveBeenCalled();
});

test('sunset date validation uses the selected city’s local date rather than its UTC date', async () => {
  const response = await request('2026-10-02T01:00:00Z');
  expect(response.status).toBe(200);
  expect(getUv).toHaveBeenCalledWith(
    40.7128,
    -74.006,
    '2026-10-01',
    'America/New_York',
    '2026-10-02T01:00:00.000Z',
  );
});

test.each([
  '',
  'not a date',
  '2026-10-01T18:38:00',
  '2026-10-01',
  '2026-02-30T18:38:00Z',
  '2026-10-01T18:38:00+25:00',
  '2026-10-01T03:00:00Z',
  '2026-10-02T22:38:00Z',
])('invalid or mismatched sunset %s is rejected without any upstream requests', async (sunset) => {
  const response = await request(sunset);
  expect(response.status).toBe(400);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toEqual({
    error: 'Choose a valid sunset time for the selected date and city.',
  });
  expect(getUv).not.toHaveBeenCalled();
  expect(getEvening).not.toHaveBeenCalled();
});

const invalidRequests: Array<Record<string, string>> = [
  { latitude: '91' },
  { longitude: '-181' },
  { timezone: 'Invalid/Timezone' },
  { date: '2026-09-30' },
  { date: '2027-10-02' },
];
test.each(invalidRequests)(
  'existing city and planning-window validation remains non-cacheable: %s',
  async (overrides) => {
    const response = await request(undefined, overrides);
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(getUv).not.toHaveBeenCalled();
    expect(getEvening).not.toHaveBeenCalled();
  },
);

test('repeated requests forward each fresh sunset and do not retain a prior available forecast', async () => {
  expect((await request('2026-10-01T22:38:00Z')).status).toBe(200);
  const unavailable: UvForecast = {
    ...forecast,
    status: 'unavailable',
    points: [],
    modelRun: null,
  };
  getUv.mockResolvedValue(unavailable);
  const response = await request('2026-10-01T22:39:00Z');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toEqual(unavailable);
  expect(getUv).toHaveBeenCalledTimes(2);
  expect(getUv.mock.calls.map((args) => args[4])).toEqual([
    '2026-10-01T22:38:00.000Z',
    '2026-10-01T22:39:00.000Z',
  ]);
  expect(getEvening).not.toHaveBeenCalled();
});
