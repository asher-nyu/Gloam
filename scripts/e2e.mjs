import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Import the actual adapter-node build and report the socket this child owns.
// An ephemeral port avoids sharing a developer's running Vite or preview server.
// Use dynamic imports so no --input-type flag leaks into dependencies' eval workers.
const serverBootstrap = `
  (async () => {
    const { once } = await import('node:events');
    const { pathToFileURL } = await import('node:url');
    const { server } = await import(pathToFileURL(process.argv[1]).href);
    if (!server.server.listening) await once(server.server, 'listening');
    process.send({ port: server.server.address().port });
    process.disconnect();
  })().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
`;

function startProcess(args, options) {
  const child = spawn(process.execPath, args, {
    ...options,
    // Keep cancellation scoped to this child and its browser descendants.
    detached: process.platform !== 'win32',
  });
  const done = new Promise((resolve) => {
    child.once('error', (error) => resolve({ code: 1, error }));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  return { child, done };
}

function sendSignal(child, signal) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

async function stopProcess(processInfo, timeoutMs) {
  if (!processInfo) return;
  const { child, done } = processInfo;
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  sendSignal(child, 'SIGTERM');
  let timer;
  try {
    const exited = await Promise.race([
      done.then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
    if (!exited) {
      sendSignal(child, 'SIGKILL');
      await done;
    }
  } finally {
    clearTimeout(timer);
  }
}

function exitCode(result) {
  return result.code ?? (128 + constants.signals[result.signal] || 1);
}

export async function runE2E({
  projectDir = fileURLToPath(new URL('..', import.meta.url)),
  port = process.env.E2E_PORT ?? '0',
  browser = process.env.E2E_BROWSER ?? 'chrome',
  readinessTimeoutMs = 20_000,
  shutdownTimeoutMs = 5_000,
  signal,
  output = 'inherit',
} = {}) {
  if (!/^\d+$/.test(String(port)) || Number(port) > 65535) {
    throw new Error('E2E_PORT must be an integer between 0 and 65535.');
  }
  signal?.throwIfAborted();
  const serverEntry = join(projectDir, 'build/index.js');
  const cypressEntry = join(projectDir, 'node_modules/cypress/bin/cypress');
  await Promise.all([access(serverEntry), access(cypressEntry)]);
  const env = {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    SHUTDOWN_TIMEOUT: '2',
    IDLE_TIMEOUT: '0',
  };
  // The test server always owns its TCP listener and derives origin from its request.
  for (const key of ['SOCKET_PATH', 'LISTEN_PID', 'LISTEN_FDS', 'ORIGIN']) delete env[key];

  const server = startProcess(['--eval', serverBootstrap, serverEntry], {
    cwd: projectDir,
    env,
    stdio: ['ignore', output, output, 'ipc'],
  });
  let tests;
  let readinessTimer;
  let onAbort;
  const interrupted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
  const serverStopped = server.done.then((result) => {
    throw (
      result.error ??
      new Error(`Production server exited before tests completed (${exitCode(result)}).`)
    );
  });
  const timeout = new Promise((_, reject) => {
    readinessTimer = setTimeout(
      () => reject(new Error('Production server did not become ready in time.')),
      readinessTimeoutMs,
    );
  });

  try {
    const ready = new Promise((resolve) => {
      server.child.on('message', (message) => {
        if (Number.isInteger(message?.port) && message.port > 0 && message.port <= 65535) {
          resolve(`http://127.0.0.1:${message.port}`);
        }
      });
    });
    const baseUrl = await Promise.race([ready, serverStopped, interrupted, timeout]);
    const response = await Promise.race([
      fetch(baseUrl, {
        signal: AbortSignal.any([
          AbortSignal.timeout(readinessTimeoutMs),
          ...(signal ? [signal] : []),
        ]),
      }),
      serverStopped,
      interrupted,
      timeout,
    ]);
    await response.body?.cancel();
    if (!response.ok)
      throw new Error(`Production server readiness request returned HTTP ${response.status}.`);
    clearTimeout(readinessTimer);

    tests = startProcess(
      [cypressEntry, 'run', '--browser', browser, '--config', `baseUrl=${baseUrl}`],
      { cwd: projectDir, env: process.env, stdio: ['ignore', output, output] },
    );
    const result = await Promise.race([tests.done, serverStopped, interrupted]);
    if (result.error) throw result.error;
    return exitCode(result);
  } finally {
    clearTimeout(readinessTimer);
    signal?.removeEventListener('abort', onAbort);
    try {
      await stopProcess(tests, shutdownTimeoutMs);
    } finally {
      await stopProcess(server, shutdownTimeoutMs);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  let interruptedCode;
  const handleSignal = (signal) => {
    interruptedCode = 128 + constants.signals[signal];
    controller.abort(new Error(`End-to-end tests interrupted by ${signal}.`));
  };
  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);
  try {
    process.exitCode = await runE2E({ signal: controller.signal });
  } catch (error) {
    console.error(error.message);
    process.exitCode = interruptedCode ?? 1;
  } finally {
    process.off('SIGINT', handleSignal);
    process.off('SIGTERM', handleSignal);
  }
}
