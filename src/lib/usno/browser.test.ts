/** @jest-environment node */
import { readFileSync } from 'node:fs';
import { jest } from '@jest/globals';
import { getBrowserEvening } from './browser';

const originalFetch = globalThis.fetch;
const fixture = (task: number) =>
  readFileSync(
    new URL(`../../../tests/fixtures/usno/new-york-${task}.html`, import.meta.url),
    'utf8',
  );
const taskFor = (input: string | URL | Request) =>
  Number(new URL(String(input)).searchParams.get('task'));
const liveResponse = (input: string | URL | Request) => new Response(fixture(taskFor(input)));
const evening = (signal?: AbortSignal) =>
  getBrowserEvening(40.7128, -74.006, '2026-09-13', 'America/New_York', signal);
const taskCalls = (task: number) =>
  jest.mocked(globalThis.fetch).mock.calls.filter(([input]) => taskFor(input) === task).length;
let deadline: AbortController;

beforeEach(() => {
  jest.useFakeTimers();
  deadline = new AbortController();
  jest.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
  globalThis.fetch = jest
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async (input) => liveResponse(input));
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('reads all four USNO tables directly with one deadline and no browser credentials or cache', async () => {
  const caller = new AbortController();
  const result = await evening(caller.signal);
  expect(result.events.map((event) => event.at)).toEqual([
    '2026-09-13T23:08:00.000Z',
    '2026-09-13T23:36:00.000Z',
    '2026-09-14T00:08:00.000Z',
    '2026-09-14T00:41:00.000Z',
  ]);
  const requests = jest.mocked(globalThis.fetch).mock.calls;
  expect(requests).toHaveLength(4);
  expect(AbortSignal.timeout).toHaveBeenCalledTimes(1);
  expect(AbortSignal.timeout).toHaveBeenCalledWith(18_000);
  for (const [input, options] of requests) {
    expect(new URL(String(input)).origin).toBe('https://aa.usno.navy.mil');
    expect(options).toMatchObject({
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'text/html' },
    });
    expect(options?.signal).toBe(requests[0][1]?.signal);
    expect(options?.signal?.aborted).toBe(false);
  }
});

test('repeated evenings fetch every table again', async () => {
  await evening();
  await evening();
  expect(globalThis.fetch).toHaveBeenCalledTimes(8);
});

test('retries browser network failures twice after bounded backoff', async () => {
  let failures = 2;
  jest.mocked(globalThis.fetch).mockImplementation(async (input) => {
    if (taskFor(input) === 0 && failures-- > 0) throw new TypeError('Load failed');
    return liveResponse(input);
  });
  const result = evening();
  await jest.advanceTimersByTimeAsync(499);
  expect(taskCalls(0)).toBe(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(taskCalls(0)).toBe(2);
  await jest.advanceTimersByTimeAsync(1_999);
  expect(taskCalls(0)).toBe(2);
  await jest.advanceTimersByTimeAsync(1);
  expect((await result).events.every((event) => event.status === 'occurs')).toBe(true);
  expect(taskCalls(0)).toBe(3);
});

test('stops after three failed attempts per table', async () => {
  jest.mocked(globalThis.fetch).mockRejectedValue(new TypeError('Load failed'));
  const failed = expect(evening()).rejects.toThrow(
    'Evening times could not be retrieved from USNO.',
  );
  await jest.advanceTimersByTimeAsync(2_500);
  await failed;
  expect(globalThis.fetch).toHaveBeenCalledTimes(12);
});

test('HTTP and parser failures are not retried or presented as missing astronomical crossings', async () => {
  jest.mocked(globalThis.fetch).mockImplementation(async (input) => {
    if (taskFor(input) === 0) return new Response('Unavailable', { status: 503 });
    if (taskFor(input) === 2) return new Response('<html>Invalid calculator result</html>');
    return liveResponse(input);
  });
  const result = await evening();
  expect(result.events.map((event) => event.status)).toEqual([
    'unavailable',
    'unavailable',
    'occurs',
    'occurs',
  ]);
  expect(globalThis.fetch).toHaveBeenCalledTimes(4);
});

test('retries a network interruption while reading a response body', async () => {
  const interrupted = new Response();
  jest.spyOn(interrupted, 'text').mockRejectedValue(new TypeError('Load failed'));
  let first = true;
  jest.mocked(globalThis.fetch).mockImplementation(async (input) => {
    if (taskFor(input) === 4 && first) {
      first = false;
      return interrupted;
    }
    return liveResponse(input);
  });
  const result = evening();
  await jest.advanceTimersByTimeAsync(500);
  expect((await result).events[3].status).toBe('occurs');
  expect(taskCalls(4)).toBe(2);
});

test('an already cancelled caller makes no request', async () => {
  const caller = new AbortController();
  caller.abort();
  await expect(evening(caller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test('caller cancellation during backoff prevents retries', async () => {
  const caller = new AbortController();
  jest.mocked(globalThis.fetch).mockRejectedValue(new TypeError('Load failed'));
  const cancelled = expect(evening(caller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  await jest.advanceTimersByTimeAsync(10);
  caller.abort();
  await cancelled;
  await jest.advanceTimersByTimeAsync(2_500);
  expect(globalThis.fetch).toHaveBeenCalledTimes(4);
});

test('the shared deadline cancels pending requests and backoff without further attempts', async () => {
  jest.mocked(globalThis.fetch).mockRejectedValue(new TypeError('Load failed'));
  const failed = expect(evening()).rejects.toThrow(
    'Evening times could not be retrieved from USNO.',
  );
  await jest.advanceTimersByTimeAsync(1_000);
  deadline.abort(new DOMException('Deadline exceeded', 'TimeoutError'));
  await failed;
  await jest.advanceTimersByTimeAsync(2_000);
  expect(globalThis.fetch).toHaveBeenCalledTimes(8);
});

test('caller cancellation aborts every in-flight table request', async () => {
  const caller = new AbortController();
  jest.mocked(globalThis.fetch).mockImplementation(
    (_input, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
          once: true,
        });
      }),
  );
  const cancelled = expect(evening(caller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  caller.abort();
  await cancelled;
  expect(globalThis.fetch).toHaveBeenCalledTimes(4);
  expect(
    jest.mocked(globalThis.fetch).mock.calls.every(([, options]) => options?.signal?.aborted),
  ).toBe(true);
});

test('a timed-out phase leaves already completed live phases available', async () => {
  jest.mocked(globalThis.fetch).mockImplementation((input, options) => {
    if (taskFor(input) === 0) return Promise.resolve(liveResponse(input));
    return new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
        once: true,
      });
    });
  });
  const result = evening();
  await jest.advanceTimersByTimeAsync(1);
  deadline.abort(new DOMException('Deadline exceeded', 'TimeoutError'));
  expect((await result).events.map((event) => event.status)).toEqual([
    'occurs',
    'unavailable',
    'unavailable',
    'unavailable',
  ]);
  expect(globalThis.fetch).toHaveBeenCalledTimes(4);
});
