import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  plugins: [sveltekit()],
  // Let Vite handle the SDK's optional peers before Vercel traces the server bundle.
  // In development, Node loads its CommonJS entry directly.
  ssr: command === 'build' ? { noExternal: ['@vercel/functions'] } : undefined,
}));
