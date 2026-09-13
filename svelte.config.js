import node from '@sveltejs/adapter-node';
import vercel from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const target = process.env.GLOAM_BUILD_TARGET ?? 'vercel';
if (!['node', 'vercel'].includes(target)) {
  throw new Error('GLOAM_BUILD_TARGET must be node or vercel.');
}

export default {
  preprocess: vitePreprocess(),
  kit: { adapter: target === 'node' ? node() : vercel({ maxDuration: 60 }) },
};
