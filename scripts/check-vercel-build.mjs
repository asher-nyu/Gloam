import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, lstat, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execute = promisify(execFile);
const script = fileURLToPath(import.meta.url);
const requiredRoutes = ['/', '/api/cities', '/api/evening', '/api/uv'];
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

function contained(root, path) {
  const child = relative(root, path);
  return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

async function filesInside(root) {
  const paths = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        assert.ok(
          contained(root, await realpath(path)),
          `Packaged symlink escapes its function: ${path}`,
        );
      } else if (entry.isDirectory()) await visit(path);
      else paths.push(path);
    }
  }
  await visit(root);
  return paths;
}

/** Inspect deployment routing and the complete traced function, not a local build folder. */
export async function inspectVercelOutput(outputDir) {
  const output = resolve(outputDir);
  const config = await readJson(join(output, 'config.json'));
  assert.equal(config.version, 3, 'Vercel Build Output API version must be 3.');
  assert.ok(Array.isArray(config.routes), 'Vercel routing configuration is missing.');
  const filesystemIndex = config.routes.findIndex((route) => route.handle === 'filesystem');
  assert.ok(filesystemIndex >= 0, 'Static files must be served before application routes.');

  const staticRoot = join(output, 'static');
  const staticFiles = await filesInside(staticRoot);
  const favicon = await readFile(join(staticRoot, 'favicon.svg'), 'utf8');
  assert.match(favicon, /<svg\b/, 'The shared favicon must be deployed.');
  assert.ok(
    staticFiles.some((file) => /[/\\]_app[/\\]immutable[/\\].+\.css$/.test(file)),
    'Client CSS is missing.',
  );
  assert.ok(
    staticFiles.some((file) => /[/\\]entry[/\\]start\.[^/\\]+\.js$/.test(file)),
    'SvelteKit client entry is missing.',
  );

  const functionsRoot = await realpath(join(output, 'functions'));
  const functions = new Map();
  for (const pathname of requiredRoutes) {
    const routeIndex = config.routes.findIndex(
      (route) =>
        typeof route.src === 'string' &&
        typeof route.dest === 'string' &&
        !route.continue &&
        (!route.methods || route.methods.includes('GET')) &&
        new RegExp(route.src).test(pathname),
    );
    assert.ok(
      routeIndex > filesystemIndex,
      `${pathname} must route to a function after static-file handling.`,
    );
    const route = config.routes[routeIndex];
    assert.ok(
      !route.status || route.status === 200,
      `${pathname} must not redirect or return a static error.`,
    );
    const destination = pathname.replace(new RegExp(route.src), route.dest).split('?')[0];
    assert.ok(destination.startsWith('/'), `${pathname} must use a local function destination.`);
    const alias = resolve(
      functionsRoot,
      `${destination === '/' ? 'index' : destination.slice(1)}.func`,
    );
    assert.ok(contained(functionsRoot, alias), `${pathname} function path escapes the deployment.`);
    const directory = await realpath(alias);
    assert.ok(
      contained(functionsRoot, directory),
      `${pathname} function alias escapes the deployment.`,
    );
    if (!functions.has(directory)) {
      const metadata = await readJson(join(directory, '.vc-config.json'));
      assert.equal(metadata.runtime, 'nodejs24.x', `${pathname} must use Node.js 24.`);
      assert.equal(metadata.launcherType, 'Nodejs', `${pathname} needs the Node.js launcher.`);
      assert.equal(
        metadata.framework?.slug,
        'sveltekit',
        `${pathname} must identify its SvelteKit function.`,
      );
      assert.equal(typeof metadata.handler, 'string', `${pathname} function handler is missing.`);
      const entry = resolve(directory, metadata.handler);
      assert.ok(contained(directory, entry), `${pathname} handler escapes its packaged function.`);
      assert.ok((await lstat(entry)).isFile(), `${pathname} function handler is missing.`);
      const files = await filesInside(directory);
      functions.set(directory, { directory, metadata, files, routes: [] });
    }
    functions.get(directory).routes.push(pathname);
  }
  return { output, staticRoot, staticFiles, functions: [...functions.values()] };
}

async function smokeFunction(entry, paths) {
  // No deployment credentials or live upstream data are needed for artifact verification.
  // A simulated GeoNames outage verifies that the packaged fallback catalog is usable.
  const warnings = [];
  const unexpectedRequests = [];
  const originalWarn = console.warn;
  const originalFetch = globalThis.fetch;
  const contextKey = Symbol.for('@vercel/request-context');
  const originalContext = globalThis[contextKey];
  const cacheReads = [];
  const background = [];
  if (process.env.VERCEL === '1') {
    // Exercise the packaged SDK's request-context integration without a remote cache.
    globalThis[contextKey] = {
      get: () => ({
        cache: {
          get: async (key) => {
            cacheReads.push(key);
            return undefined;
          },
          set: async () => {},
        },
        waitUntil: (work) => background.push(work),
      }),
    };
  }
  console.warn = (...args) => warnings.push(String(args[0]));
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (
      url.origin === 'https://download.geonames.org' &&
      url.pathname.startsWith('/export/dump/')
    ) {
      return new Response('Offline artifact check', { status: 503 });
    }
    unexpectedRequests.push(url.href);
    throw new Error(`Unexpected network request during artifact check: ${url.href}`);
  };
  try {
    const { default: handler } = await import(pathToFileURL(entry).href);
    assert.equal(
      typeof handler?.fetch,
      'function',
      'The deployed function must export fetch(Request).',
    );
    const assets = [];
    for (const pathname of paths) {
      const query = pathname === '/api/cities' ? '?q=New%20York' : '';
      const response = await handler.fetch(new Request(`https://gloam.test${pathname}${query}`));
      if (pathname === '/') {
        assert.equal(response.status, 200, 'Packaged SSR handler must respond successfully.');
        assert.match(response.headers.get('content-type') ?? '', /text\/html/);
        const html = await response.text();
        assert.match(html, /<title>Gloam<\/title>/);
        for (const match of html.matchAll(
          /(?:href|src)=["']([^"']+)["']|import\(["']([^"']+)["']\)/g,
        )) {
          const asset = new URL(match[1] ?? match[2], 'https://gloam.test/');
          if (
            asset.origin === 'https://gloam.test' &&
            (asset.pathname.startsWith('/_app/') || asset.pathname === '/favicon.svg')
          ) {
            assets.push(asset.pathname);
          }
        }
        assert.ok(
          assets.some((asset) => asset.startsWith('/_app/')),
          'SSR must reference built client assets.',
        );
      } else {
        assert.match(response.headers.get('content-type') ?? '', /application\/json/);
        const body = await response.json();
        if (pathname === '/api/cities') {
          assert.equal(response.status, 200, 'Packaged city search must work without GeoNames.');
          assert.ok(body.cities.some((city) => city.id === 5128581));
          const lookup = await handler.fetch(
            new Request('https://gloam.test/api/cities?id=5128581'),
          );
          assert.equal(lookup.status, 200);
          const { city } = await lookup.json();
          assert.equal(city?.id, 5128581);
          assert.equal(city?.timezone, 'America/New_York');
        } else {
          assert.equal(response.status, 400, `${pathname} must execute its input validation.`);
          assert.equal(typeof body.error, 'string');
        }
      }
    }
    if (process.env.VERCEL === '1' && paths.includes('/api/cities')) {
      assert.ok(cacheReads.length > 0, 'The deployed city route must use Vercel Runtime Cache.');
      assert.ok(
        cacheReads.every((key) => key.startsWith('gloam:gloam-artifact-check:cities:v1$')),
        'Runtime Cache reads must be scoped to the deployment project.',
      );
      assert.ok(background.length > 0, 'City search must register background work with waitUntil.');
      await Promise.all(background);
    }
    if (paths.includes('/api/uv')) {
      const require = createRequire(pathToFileURL(entry));
      const decoderEntry = require.resolve('@azohra/meteo.grib/j2k-node');
      assert.ok(
        contained(process.cwd(), await realpath(decoderEntry)),
        'GRIB decoder must resolve inside its deployment package.',
      );
      const { createNodeJ2kDecoder } = await import(pathToFileURL(decoderEntry).href);
      assert.equal(
        typeof (await createNodeJ2kDecoder()),
        'function',
        'The production JPEG 2000 codec must initialize.',
      );
      // The application's default codec is pure TypeScript; its unused optional WASM codec is not required.
    }
    assert.deepEqual(
      unexpectedRequests,
      [],
      'Artifact checks must not depend on external services.',
    );
    assert.ok(
      warnings.every((message) =>
        message.startsWith('City catalog refresh failed; keeping the last valid cities.'),
      ),
      `Unexpected packaged runtime warnings: ${warnings.join('; ')}`,
    );
    return { routes: paths, assets: [...new Set(assets)] };
  } finally {
    console.warn = originalWarn;
    globalThis.fetch = originalFetch;
    if (originalContext === undefined) delete globalThis[contextKey];
    else globalThis[contextKey] = originalContext;
  }
}

export async function checkVercelBuild(
  outputDir = fileURLToPath(new URL('../.vercel/output', import.meta.url)),
) {
  const artifact = await inspectVercelOutput(outputDir);
  const scratch = await mkdtemp(join(tmpdir(), 'gloam-vercel-check-'));
  try {
    for (const [index, fn] of artifact.functions.entries()) {
      const directory = join(scratch, `function-${index}`);
      await cp(fn.directory, directory, { recursive: true, verbatimSymlinks: true });
      for (const vercel of ['0', '1']) {
        const { stdout } = await execute(
          process.execPath,
          [
            script,
            '--smoke-function',
            resolve(directory, fn.metadata.handler),
            JSON.stringify(fn.routes),
          ],
          {
            cwd: directory,
            env: {
              ...process.env,
              VERCEL: vercel,
              VERCEL_PROJECT_ID: 'gloam-artifact-check',
            },
            timeout: 30_000,
            maxBuffer: 1024 * 1024,
          },
        );
        const result = JSON.parse(stdout);
        for (const asset of result.assets) {
          const path = resolve(artifact.staticRoot, asset.slice(1));
          assert.ok(
            contained(artifact.staticRoot, path),
            `SSR asset path escapes static output: ${asset}`,
          );
          assert.ok(
            (await lstat(path)).isFile(),
            `SSR references a missing client asset: ${asset}`,
          );
        }
      }
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  return {
    functions: artifact.functions.length,
    routes: requiredRoutes.length,
    staticFiles: artifact.staticFiles.length,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === '--smoke-function') {
      console.log(
        JSON.stringify(await smokeFunction(process.argv[3], JSON.parse(process.argv[4]))),
      );
    } else {
      const result = await checkVercelBuild(process.argv[2]);
      console.log(
        `Vercel artifact verified: ${result.functions} isolated Node.js 24 function, ${result.routes} routes, ${result.staticFiles} static files, the production GRIB decoder, and Runtime Cache / waitUntil integration.`,
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
