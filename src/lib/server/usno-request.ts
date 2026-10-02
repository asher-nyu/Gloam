import { setTimeout } from 'node:timers/promises';
import { Agent } from 'undici';

const retryDelays = [500, 2_000];
// USNO supports keep-alive. Reuse one connection rather than opening a separate
// TLS handshake for each of the four annual tables.
const dispatcher = new Agent({ connections: 1, pipelining: 1 });

function connectionReset(error: unknown): boolean {
  // Node's fetch wraps the transport error in a TypeError with a cause.
  for (let depth = 0; depth < 4 && error && typeof error === 'object'; depth++) {
    if ('code' in error && error.code === 'ECONNRESET') return true;
    error = 'cause' in error ? error.cause : null;
  }
  return false;
}

export async function requestUsnoTable(url: string): Promise<string> {
  // Retries, connection-pool waiting, backoff, and body reading share a deadline.
  const signal = AbortSignal.timeout(18_000);
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      const options = {
        signal,
        cache: 'no-store' as const,
        headers: { Accept: 'text/html' },
        dispatcher,
      };
      const response = await fetch(url, options);
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`USNO HTTP ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      if (signal.aborted || attempt >= retryDelays.length || !connectionReset(error)) throw error;
      await setTimeout(retryDelays[attempt], undefined, { signal });
    }
  }
}
