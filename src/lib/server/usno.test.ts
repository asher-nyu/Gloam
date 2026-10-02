/** @jest-environment node */
import { readFileSync } from 'node:fs';
import { jest } from '@jest/globals';
import { parseUsnoTable } from './usno-parser';
import { getEvening, sourceUrl } from './usno';

const fixture = (city: string, task = 4) =>
  readFileSync(
    new URL(`../../../tests/fixtures/usno/${city}-${task}.html`, import.meta.url),
    'utf8',
  );
const withSetting = (html: string, day: number, month: number, time: string) => {
  const column = 9 + (month - 1) * 11;
  return html
    .split('\n')
    .map((line) =>
      line.startsWith(`${String(day).padStart(2, '0')}  `)
        ? line.slice(0, column) + time + line.slice(column + 4)
        : line,
    )
    .join('\n');
};
const originalFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = jest.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.searchParams.get('lon') === '-74.0070' && url.searchParams.get('task') === '0')
      return new Response('Unavailable', { status: 503 });
    if (url.searchParams.get('lon') === '-74.0100') {
      // Synthetic boundary times exercise year stitching using the real fixed-width layout.
      const task = Number(url.searchParams.get('task'));
      const times: Record<number, string> = { 2: '0000', 3: '0030', 4: '0100' };
      return new Response(
        task === 0
          ? withSetting(fixture('new-york', task), 31, 12, '2330')
          : withSetting(fixture('new-york', task), 1, 1, times[task]),
      );
    }
    const city = Number(url.searchParams.get('lat')) > 60 ? 'hammerfest' : 'new-york';
    return new Response(fixture(city, Number(url.searchParams.get('task'))));
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});

test('preserves duplicate-day continuation rows and blank fields', () => {
  const table = parseUsnoTable(fixture('new-york'), 2026);
  expect(table.find((day) => day.date === '2026-10-07')?.setting).toEqual([
    '2026-10-07T00:00:00.000Z',
    '2026-10-07T23:59:00.000Z',
  ]);
  expect(table.find((day) => day.date === '2026-02-12')?.setting).toEqual([]);
  expect(table.find((day) => day.date === '2026-02-12')?.status).toBe('no-crossing');
});
test('identifies Gloam in live USNO requests using Universal Time', () => {
  const url = new URL(sourceUrl(40.71427, -74.00597, 2026, 'astronomical'));
  expect(url.origin).toBe('https://aa.usno.navy.mil');
  expect(url.searchParams.get('ID')).toBe('Gloam');
  expect(url.searchParams.get('task')).toBe('4');
  expect(url.searchParams.get('tz')).toBe('0');
});
test('assembles a city evening from both UTC dates', async () => {
  const result = await getEvening(40.7128, -74.006, '2026-09-13', 'America/New_York');
  expect(result.events.map((event) => event.at)).toEqual([
    '2026-09-13T23:08:00.000Z',
    '2026-09-13T23:36:00.000Z',
    '2026-09-14T00:08:00.000Z',
    '2026-09-14T00:41:00.000Z',
  ]);
});
test('repeated identical evenings request all four USNO tables again', async () => {
  const fetchMock = jest.mocked(globalThis.fetch);
  const before = fetchMock.mock.calls.length;
  await getEvening(40.7128, -74.012, '2026-09-13', 'America/New_York');
  expect(fetchMock.mock.calls.length - before).toBe(4);
  await getEvening(40.7128, -74.012, '2026-09-13', 'America/New_York');
  expect(fetchMock.mock.calls.length - before).toBe(8);
});
test('a new upstream outage rejects instead of retaining a previously successful evening', async () => {
  const fetchMock = jest.mocked(globalThis.fetch);
  const successfulFetch = fetchMock.getMockImplementation()!;
  const previous = await getEvening(40.7128, -74.013, '2026-09-13', 'America/New_York');
  expect(previous.events.every((event) => event.status === 'occurs')).toBe(true);
  const before = fetchMock.mock.calls.length;
  fetchMock.mockImplementation(async () => new Response('Unavailable', { status: 503 }));
  try {
    await expect(getEvening(40.7128, -74.013, '2026-09-13', 'America/New_York')).rejects.toThrow(
      'Evening times could not be retrieved from USNO.',
    );
    expect(fetchMock.mock.calls.length - before).toBe(4);
  } finally {
    fetchMock.mockImplementation(successfulFetch);
  }
});
test('a missing sunset feed does not borrow yesterday’s after-midnight twilight', async () => {
  const result = await getEvening(40.7128, -74.007, '2026-09-13', 'America/New_York');
  expect(result.events[0].status).toBe('unavailable');
  expect(result.events[3].at).toBe('2026-09-14T00:41:00.000Z');
});
test('retains a real sunset before civil noon at high latitudes', async () => {
  const result = await getEvening(70.6634, 23.6821, '2026-11-21', 'Europe/Oslo');
  expect(result.events[0]).toEqual({
    kind: 'sunset',
    at: '2026-11-21T10:46:00.000Z',
    status: 'occurs',
  });
  expect(result.events.every((event) => event.status === 'occurs')).toBe(true);
});
test('distinguishes continuous daylight and continuous darkness from outages', async () => {
  const summer = await getEvening(70.6634, 23.6821, '2026-06-21', 'Europe/Oslo');
  expect(summer.events.every((event) => event.status === 'above')).toBe(true);
  const winter = await getEvening(70.6634, 23.6821, '2026-12-21', 'Europe/Oslo');
  expect(winter.events[0].status).toBe('below');
  expect(winter.events[3].status).toBe('occurs');
});
test('keeps one evening together when its twilight ends in the next UTC year', async () => {
  const result = await getEvening(40.7128, -74.01, '2026-12-31', 'America/New_York');
  const calls = (globalThis.fetch as ReturnType<typeof jest.fn>).mock.calls
    .map(([input]) => new URL(String(input)))
    .filter((url) => url.searchParams.get('lon') === '-74.0100');
  expect([...new Set(calls.map((url) => url.searchParams.get('year')))].sort()).toEqual([
    '2026',
    '2027',
  ]);
  expect(result.events.map((event) => event.at)).toEqual([
    '2026-12-31T23:30:00.000Z',
    '2027-01-01T00:00:00.000Z',
    '2027-01-01T00:30:00.000Z',
    '2027-01-01T01:00:00.000Z',
  ]);
});
test('does not request historical years outside the selected evening window', async () => {
  await getEvening(40.7128, -74.011, '2027-01-01', 'America/New_York');
  const calls = (globalThis.fetch as ReturnType<typeof jest.fn>).mock.calls
    .map(([input]) => new URL(String(input)))
    .filter((url) => url.searchParams.get('lon') === '-74.0110');
  expect([...new Set(calls.map((url) => url.searchParams.get('year')))]).toEqual(['2027']);
});
test('rejects HTML errors rather than publishing an empty astronomical result', () => {
  expect(() => parseUsnoTable('<html>Service unavailable</html>', 2026)).toThrow(
    'unexpected table',
  );
});
