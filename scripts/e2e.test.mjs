import assert from 'node:assert/strict';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { runE2E } from './e2e.mjs';

const serverSource = `
  import { createServer } from 'node:http';
  import { writeFileSync } from 'node:fs';
  const http = createServer((request, response) => response.end('owned production server'));
  export const server = { server: http };
  http.listen(Number(process.env.PORT), process.env.HOST, () => {
    writeFileSync('server.json', JSON.stringify({ pid: process.pid, port: http.address().port }));
  });
  process.on('SIGTERM', () => {
    http.closeIdleConnections();
    http.close();
  });
`;
const testsSource = `
  import assert from 'node:assert/strict';
  import { writeFileSync } from 'node:fs';
  const config = process.argv[process.argv.indexOf('--config') + 1];
  const baseUrl = config.replace(/^baseUrl=/, '');
  assert.equal(await (await fetch(baseUrl)).text(), 'owned production server');
  writeFileSync('tests.json', JSON.stringify({ pid: process.pid, baseUrl, args: process.argv }));
`;

async function fixture(t, { server = serverSource, tests = testsSource } = {}) {
  const projectDir = await mkdtemp(join(tmpdir(), 'gloam-e2e-'));
  t.after(() => rm(projectDir, { recursive: true, force: true }));
  await mkdir(join(projectDir, 'build'));
  await mkdir(join(projectDir, 'node_modules/cypress/bin'), { recursive: true });
  await Promise.all([
    writeFile(join(projectDir, 'package.json'), '{"type":"module"}'),
    writeFile(join(projectDir, 'build/index.js'), server),
    writeFile(join(projectDir, 'node_modules/cypress/package.json'), '{"type":"module"}'),
    writeFile(join(projectDir, 'node_modules/cypress/bin/cypress'), tests),
  ]);
  return {
    projectDir,
    output: 'ignore',
    readinessTimeoutMs: 3000,
    shutdownTimeoutMs: 200,
  };
}

async function record(options, name) {
  return JSON.parse(await readFile(join(options.projectDir, name), 'utf8'));
}

function expectStopped(pid) {
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}

test('runs tests against its own dynamic production port and waits for clean shutdown', async (t) => {
  const options = await fixture(t);
  assert.equal(await runE2E(options), 0);
  const server = await record(options, 'server.json');
  const tests = await record(options, 'tests.json');
  assert.equal(tests.baseUrl, `http://127.0.0.1:${server.port}`);
  assert.ok(tests.args.includes('--browser'));
  expectStopped(server.pid);
  expectStopped(tests.pid);
});

test('allows production dependencies to run CommonJS eval workers', async (t) => {
  const options = await fixture(t, {
    server: `
      import assert from 'node:assert/strict';
      import { once } from 'node:events';
      import { Worker } from 'node:worker_threads';
      const worker = new Worker(
        "const { parentPort } = require('node:worker_threads'); var u8 = Uint8Array; parentPort.postMessage([...new u8([7, 8, 9])]);",
        { eval: true },
      );
      const [bytes] = await once(worker, 'message');
      assert.deepEqual(bytes, [7, 8, 9]);
      await once(worker, 'exit');
      ${serverSource}
    `,
  });
  assert.equal(await runE2E(options), 0);
  expectStopped((await record(options, 'server.json')).pid);
  expectStopped((await record(options, 'tests.json')).pid);
});

test('preserves a failing Cypress exit code and still shuts down its server', async (t) => {
  const options = await fixture(t, { tests: `${testsSource}\nprocess.exitCode = 7;` });
  assert.equal(await runE2E(options), 7);
  expectStopped((await record(options, 'server.json')).pid);
  expectStopped((await record(options, 'tests.json')).pid);
});

test('rejects an occupied explicit port without requesting or stopping its existing server', async (t) => {
  let requests = 0;
  const existing = createServer((request, response) => {
    requests++;
    response.end('unrelated existing server');
  });
  existing.listen(0, '127.0.0.1');
  await once(existing, 'listening');
  t.after(() => new Promise((resolve) => existing.close(resolve)));
  const options = await fixture(t);
  await assert.rejects(
    runE2E({ ...options, port: existing.address().port }),
    /Production server exited/,
  );
  assert.equal(requests, 0);
  assert.equal(existing.listening, true);
  await assert.rejects(access(join(options.projectDir, 'tests.json')), { code: 'ENOENT' });
});

test('reports an early server exit without launching Cypress', async (t) => {
  const options = await fixture(t, { server: 'process.exit(9);' });
  await assert.rejects(runE2E(options), /Production server exited.*9/);
  await assert.rejects(access(join(options.projectDir, 'tests.json')), { code: 'ENOENT' });
});

test('bounds readiness and cleans up a server that never starts listening', async (t) => {
  const options = await fixture(t, {
    server: `
      import { createServer } from 'node:http';
      import { writeFileSync } from 'node:fs';
      export const server = { server: createServer() };
      writeFileSync('server.json', JSON.stringify({ pid: process.pid }));
      setInterval(() => {}, 1000);
    `,
  });
  await assert.rejects(runE2E({ ...options, readinessTimeoutMs: 500 }), /did not become ready/);
  expectStopped((await record(options, 'server.json')).pid);
  await assert.rejects(access(join(options.projectDir, 'tests.json')), { code: 'ENOENT' });
});

test('cancellation stops the server and forcibly stops tests that ignore SIGTERM', async (t) => {
  const options = await fixture(t, {
    tests: `${testsSource}\nprocess.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`,
  });
  const controller = new AbortController();
  const result = runE2E({ ...options, signal: controller.signal });
  const rejection = assert.rejects(result, /cancelled by test/);
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await access(join(options.projectDir, 'tests.json'));
      break;
    } catch {
      await delay(20);
    }
  }
  controller.abort(new Error('cancelled by test'));
  await rejection;
  expectStopped((await record(options, 'server.json')).pid);
  expectStopped((await record(options, 'tests.json')).pid);
});

test('stops Cypress if the production server exits during the run', async (t) => {
  const options = await fixture(t, {
    tests: `${testsSource}\nsetInterval(() => {}, 1000);`,
  });
  const result = runE2E(options);
  const rejection = assert.rejects(result, /Production server exited/);
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await access(join(options.projectDir, 'tests.json'));
      break;
    } catch {
      await delay(20);
    }
  }
  const server = await record(options, 'server.json');
  process.kill(server.pid, 'SIGTERM');
  await rejection;
  expectStopped(server.pid);
  expectStopped((await record(options, 'tests.json')).pid);
});
