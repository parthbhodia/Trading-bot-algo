import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  integrations: [react(), tailwind()],
  output: 'server',
  vite: {
    define: {
      global: 'globalThis',
    },
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
    optimizeDeps: {
      include: ['lightweight-charts'],
    },
    ssr: {
      noExternal: ['lightweight-charts'],
    },
  },
});
