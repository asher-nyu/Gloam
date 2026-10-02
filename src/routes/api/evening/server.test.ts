/** @jest-environment node */
import { readFileSync } from 'node:fs';
import { jest } from '@jest/globals';
import { GET } from './+server';
import type { Evening } from '$lib/domain/types';

const originalFetch = globalThis.fetch;
const now = Date.parse('2026-10-01T12:00:00Z');
const eveningUrl = (date = '2026-10-01') =>
  new URL(
    `http://localhost/api/evening?latitude=40.7128&longitude=-74.006&timezone=America%2FNew_York&date=${date}`,
  );
// This handler reads only the URL from SvelteKit's request event.
const request = (url: URL) => GET({ url } as Parameters<typeof GET>[0]);

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(now);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  globalThis.fetch = jest.fn(async (input: string | URL | Request) => {
    const task = new URL(String(input)).searchParams.get('task');
    return new Response(
      readFileSync(
        new URL(`../../../../tests/fixtures/usno/new-york-${task}.html`, import.meta.url),
        'utf8',
      ),
    );
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.restoreAllMocks();
});

test('successful evening responses forbid caching and repeat identical upstream requests', async () => {
  const first = await request(eveningUrl());
  expect(first.status).toBe(200);
  expect(first.headers.get('Cache-Control')).toBe('no-store');
  const body = (await first.json()) as Evening;
  expect(body.events.every((event) => event.status === 'occurs')).toBe(true);
  expect(globalThis.fetch).toHaveBeenCalledTimes(4);
  const second = await request(eveningUrl());
  expect(second.status).toBe(200);
  expect(second.headers.get('Cache-Control')).toBe('no-store');
  expect(globalThis.fetch).toHaveBeenCalledTimes(8);
  expect(console.error).not.toHaveBeenCalled();
});

test('upstream failure after success returns a non-cacheable error without earlier events', async () => {
  expect((await request(eveningUrl())).status).toBe(200);
  jest
    .mocked(globalThis.fetch)
    .mockImplementation(async () => new Response('Unavailable', { status: 503 }));
  const failed = await request(eveningUrl());
  expect(failed.status).toBe(502);
  expect(failed.headers.get('Cache-Control')).toBe('no-store');
  expect(await failed.json()).toEqual({
    error: 'USNO isn’t responding right now. Please try again.',
  });
  expect(globalThis.fetch).toHaveBeenCalledTimes(8);
  const logged = jest.mocked(console.error).mock.calls[0];
  expect(logged[0]).toBe('USNO live request failed');
  expect(JSON.parse(logged[1] as string)).toEqual({
    failures: Array.from({ length: 4 }, () => [{ name: 'Error', message: 'USNO HTTP 503' }]),
  });
});

test('server logs expose nested transport codes without response or request data', async () => {
  jest.mocked(globalThis.fetch).mockRejectedValue(
    new TypeError('fetch failed', {
      cause: Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' }),
    }),
  );
  expect((await request(eveningUrl())).status).toBe(502);
  const logged = jest.mocked(console.error).mock.calls[0];
  expect(JSON.parse(logged[1] as string)).toEqual({
    failures: Array.from({ length: 4 }, () => [
      { name: 'TypeError', message: 'fetch failed' },
      { name: 'Error', message: 'certificate has expired', code: 'CERT_HAS_EXPIRED' },
    ]),
  });
});

test.each([
  new URL('http://localhost/api/evening'),
  eveningUrl('2026-09-30'),
  eveningUrl('2027-10-02'),
])('validation errors forbid caching and never contact USNO', async (url) => {
  const response = await request(url);
  expect(response.status).toBe(400);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
