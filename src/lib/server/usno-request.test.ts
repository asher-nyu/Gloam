/** @jest-environment node */
import { jest } from '@jest/globals';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { requestUsnoTable } from './usno-request';

const originalFetch = globalThis.fetch;
const url = 'https://aa.usno.navy.mil/calculated/rstt/year';
const reset = () =>
  new TypeError('fetch failed', {
    cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
  });

afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.restoreAllMocks();
});

test('retries two connection resets and returns the live successful response', async () => {
  const fetch = jest
    .fn<typeof globalThis.fetch>()
    .mockRejectedValueOnce(reset())
    .mockRejectedValueOnce(reset())
    .mockResolvedValueOnce(new Response('<pre>live table</pre>'));
  globalThis.fetch = fetch;
  expect(await requestUsnoTable(url)).toBe('<pre>live table</pre>');
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch.mock.calls.every(([, options]) => options?.cache === 'no-store')).toBe(true);
  const signals = fetch.mock.calls.map(([, options]) => options?.signal);
  expect(signals.every((signal) => signal === signals[0])).toBe(true);
  expect(signals[0]?.aborted).toBe(false);
});

test('stops after three reset failures without an unbounded request loop', async () => {
  const error = reset();
  const fetch = jest.fn<typeof globalThis.fetch>().mockRejectedValue(error);
  globalThis.fetch = fetch;
  await expect(requestUsnoTable(url)).rejects.toBe(error);
  expect(fetch).toHaveBeenCalledTimes(3);
});

test('does not retry HTTP errors or certificate failures', async () => {
  const fetch = jest
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response('Unavailable', { status: 503 }))
    .mockRejectedValueOnce(
      new TypeError('fetch failed', {
        cause: Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' }),
      }),
    );
  globalThis.fetch = fetch;
  await expect(requestUsnoTable(url)).rejects.toThrow('USNO HTTP 503');
  expect(fetch).toHaveBeenCalledTimes(1);
  await expect(requestUsnoTable(url)).rejects.toThrow('fetch failed');
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('a reset during the response body also retries the whole live request', async () => {
  const interrupted = new Response();
  jest.spyOn(interrupted, 'text').mockRejectedValueOnce(reset());
  const fetch = jest
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(interrupted)
    .mockResolvedValueOnce(new Response('<pre>complete table</pre>'));
  globalThis.fetch = fetch;
  expect(await requestUsnoTable(url)).toBe('<pre>complete table</pre>');
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('an expired shared deadline prevents further requests', async () => {
  const controller = new AbortController();
  const error = reset();
  jest.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  const fetch = jest.fn<typeof globalThis.fetch>().mockImplementation(async () => {
    controller.abort(new DOMException('Deadline exceeded', 'TimeoutError'));
    throw error;
  });
  globalThis.fetch = fetch;
  await expect(requestUsnoTable(url)).rejects.toBe(error);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('concurrent tables use one live connection and wait for the preceding body', async () => {
  let firstResponse!: ServerResponse;
  let firstReceived!: () => void;
  const received = new Promise<void>((resolve) => {
    firstReceived = resolve;
  });
  const requests: string[] = [];
  let connections = 0;
  const server = createServer((request, response) => {
    requests.push(request.url!);
    if (requests.length === 1) {
      firstResponse = response;
      firstReceived();
    } else response.end('<pre>second table</pre>');
  });
  server.on('connection', () => {
    connections++;
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const first = requestUsnoTable(`${base}/?task=0`);
    const second = requestUsnoTable(`${base}/?task=2`);
    await received;
    expect(requests).toEqual(['/?task=0']);
    firstResponse.end('<pre>first table</pre>');
    expect(await first).toBe('<pre>first table</pre>');
    expect(await second).toBe('<pre>second table</pre>');
    expect(requests).toEqual(['/?task=0', '/?task=2']);
    expect(connections).toBe(1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
});

test('an aborted request waiting for the connection never reaches the server', async () => {
  const firstDeadline = new AbortController();
  const queuedDeadline = new AbortController();
  jest
    .spyOn(AbortSignal, 'timeout')
    .mockReturnValueOnce(firstDeadline.signal)
    .mockReturnValueOnce(queuedDeadline.signal);
  let firstResponse!: ServerResponse;
  let firstReceived!: () => void;
  const received = new Promise<void>((resolve) => {
    firstReceived = resolve;
  });
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    firstResponse = response;
    firstReceived();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const first = requestUsnoTable(`${base}/?task=0`);
    const queued = requestUsnoTable(`${base}/?task=2`);
    const cancelled = expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    await received;
    queuedDeadline.abort();
    await cancelled;
    firstResponse.end('<pre>first table</pre>');
    expect(await first).toBe('<pre>first table</pre>');
    expect(requests).toBe(1);
  } finally {
    firstDeadline.abort();
    queuedDeadline.abort();
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
});

test('aborting during backoff prevents a second request', async () => {
  const controller = new AbortController();
  jest.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  const fetch = jest.fn<typeof globalThis.fetch>().mockRejectedValue(reset());
  globalThis.fetch = fetch;
  const result = requestUsnoTable(url);
  const cancelled = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  const timer = setTimeout(() => controller.abort(), 10);
  try {
    await cancelled;
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    clearTimeout(timer);
  }
});
