import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  // Let Vite handle the SDK's optional peers before Vercel traces the server bundle.
  ssr: { noExternal: ['@vercel/functions'] },
});
