import { channel } from 'node:diagnostics_channel';
import net from 'node:net';
import tls from 'node:tls';
import { requestUsnoTable } from '../src/lib/server/usno-request.ts';
import { parseUsnoTable } from '../src/lib/usno/parser.ts';

// Only connection metadata is printed. Response bodies and event times are never
// written to disk, and the production request helper has no response cache.
const host = 'aa.usno.navy.mil';
const log = (value) => console.log(JSON.stringify({ at: new Date().toISOString(), ...value }));

async function handshake(target, options = {}) {
  return new Promise((resolve) => {
    const start = performance.now();
    let finished = false;
    let secure;
    let stage = 'tcp';
    const raw = net.connect({ host: target, port: 443, family: 4 });
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      log({ host: target, stage, elapsedMs: Math.round(performance.now() - start), ...result });
      resolve(result.ok);
    };
    const deadline = setTimeout(() => {
      finish({ ok: false, code: 'DIAGNOSTIC_TIMEOUT' });
      (secure ?? raw).destroy();
    }, 6_000);
    raw.once('error', (error) => finish({ ok: false, code: error.code, message: error.message }));
    raw.once('connect', () => {
      log({
        host: target,
        stage: 'tcp',
        ok: true,
        elapsedMs: Math.round(performance.now() - start),
        remoteAddress: raw.remoteAddress,
        remotePort: raw.remotePort,
        localPort: raw.localPort,
      });
      stage = 'tls';
      secure = tls.connect({
        socket: raw,
        servername: target,
        rejectUnauthorized: true,
        ...options,
      });
      secure.once('secureConnect', () => {
        finish({ ok: true, authorized: secure.authorized, protocol: secure.getProtocol() });
        secure.end();
      });
      secure.once('error', (error) =>
        finish({
          ok: false,
          code: error.code,
          message: error.message,
          bytesReceived: raw.bytesRead,
          bytesSent: raw.bytesWritten,
        }),
      );
    });
  });
}

log({ check: 'Fresh USNO connections; no saved responses or event-time output' });
await handshake('nomads.ncep.noaa.gov');
await handshake(host);

for (const event of ['beforeConnect', 'connected', 'connectError']) {
  channel(`undici:client:${event}`).subscribe((message) => {
    if (message.connectParams?.hostname !== host) return;
    log({
      stage: 'production-request',
      event,
      code: message.error?.code,
      authorized: message.socket?.authorized,
    });
  });
}

const year = new Date().getUTCFullYear();
const results = await Promise.allSettled(
  [0, 2, 3, 4].map(async (task) => {
    const query = new URLSearchParams({
      ID: 'Gloam',
      year: String(year),
      task: String(task),
      lat: '40.7143',
      lon: '-74.0060',
      tz: '0',
      tz_sign: '1',
    });
    const body = await requestUsnoTable(`https://${host}/calculated/rstt/year?${query}`);
    // Validate the complete table, then discard it; no parsed events are retained.
    parseUsnoTable(body, year);
    return task;
  }),
);
const tasks = [0, 2, 3, 4];
results.forEach((result, index) => {
  log(
    result.status === 'fulfilled'
      ? { stage: 'table-validation', task: tasks[index], ok: true }
      : {
          stage: 'table-validation',
          task: tasks[index],
          ok: false,
          code: result.reason.cause?.code ?? result.reason.code,
          message: result.reason.message,
        },
  );
});
process.exitCode = results.every((result) => result.status === 'fulfilled') ? 0 : 1;
