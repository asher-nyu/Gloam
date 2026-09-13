import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { inspectVercelOutput } from './check-vercel-build.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'gloam-vercel-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'output');
  const fn = join(output, 'functions/catchall.func');
  const metadata = {
    runtime: 'nodejs24.x',
    launcherType: 'Nodejs',
    handler: 'server/index.js',
    framework: { slug: 'sveltekit' },
  };
  const files = {
    'config.json': JSON.stringify({
      version: 3,
      routes: [
        { handle: 'filesystem' },
        { src: '^/$', dest: '/' },
        ...['cities', 'evening', 'uv'].map((route) => ({
          src: `^/api/${route}$`,
          dest: `/api/${route}`,
        })),
      ],
    }),
    'static/favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    'static/_app/immutable/entry/start.fixture.js': 'export {};',
    'static/_app/immutable/assets/app.fixture.css': ':root { color-scheme: light dark; }',
    'functions/catchall.func/.vc-config.json': JSON.stringify(metadata),
    'functions/catchall.func/server/index.js': 'export default { fetch() {} };',
  };
  await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      const target = join(output, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }),
  );
  await mkdir(join(output, 'functions/api'));
  await symlink('catchall.func', join(output, 'functions/index.func'));
  await Promise.all(
    ['cities', 'evening', 'uv'].map((route) =>
      symlink('../catchall.func', join(output, `functions/api/${route}.func`)),
    ),
  );
  return { root, output, fn, metadata };
}

test('resolves all deployed page and API aliases to the packaged Node.js 24 function', async (t) => {
  const { output, fn } = await fixture(t);
  const artifact = await inspectVercelOutput(output);
  assert.equal(artifact.functions.length, 1);
  assert.equal(artifact.functions[0].directory, await realpath(fn));
  assert.deepEqual(artifact.functions[0].routes, ['/', '/api/cities', '/api/evening', '/api/uv']);
  assert.equal(artifact.staticFiles.length, 3);
});

test('rejects an accidentally downgraded deployment runtime', async (t) => {
  const { output, fn, metadata } = await fixture(t);
  await writeFile(
    join(fn, '.vc-config.json'),
    JSON.stringify({ ...metadata, runtime: 'nodejs22.x' }),
  );
  await assert.rejects(inspectVercelOutput(output), /must use Node.js 24/);
});

test('rejects a dependency link that would work locally but escape the deployed package', async (t) => {
  const { root, output, fn } = await fixture(t);
  const external = join(root, 'local-only-dependency');
  await mkdir(external);
  await mkdir(join(fn, 'node_modules'));
  await symlink(external, join(fn, 'node_modules/local-only-dependency'));
  await assert.rejects(inspectVercelOutput(output), /Packaged symlink escapes/);
});

test('rejects deployment output that cannot hydrate the rendered page', async (t) => {
  const { output } = await fixture(t);
  await rm(join(output, 'static/_app/immutable/entry/start.fixture.js'));
  await assert.rejects(inspectVercelOutput(output), /SvelteKit client entry is missing/);
});
