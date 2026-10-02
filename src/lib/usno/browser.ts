import { getEvening } from './evening';
import type { Evening } from '../domain/types';

const retryDelays = [500, 2_000];

function backoff(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cancelled = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancelled);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancelled);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', cancelled, { once: true });
  });
}

async function requestTable(url: string, signal: AbortSignal): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      const response = await fetch(url, {
        signal,
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: { Accept: 'text/html' },
      });
      if (!response.ok) {
        try {
          await response.body?.cancel();
        } catch {
          // The HTTP status remains the failure even if cancelling its body fails.
        }
        throw new Error(`USNO HTTP ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      signal.throwIfAborted();
      // Browser fetch exposes network failures as TypeError, without a reset code.
      // HTTP errors and parser errors do not enter this retry path.
      if (attempt >= retryDelays.length || !(error instanceof TypeError)) throw error;
      await backoff(retryDelays[attempt], signal);
    }
  }
}

export async function getBrowserEvening(
  latitude: number,
  longitude: number,
  date: string,
  timezone: string,
  signal?: AbortSignal,
): Promise<Evening> {
  signal?.throwIfAborted();
  // All phases, retries, response bodies, and backoff share one request deadline.
  const deadline = AbortSignal.timeout(18_000);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    const evening = await getEvening(latitude, longitude, date, timezone, (url) =>
      requestTable(url, combined),
    );
    signal?.throwIfAborted();
    return evening;
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  }
}
