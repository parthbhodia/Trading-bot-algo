import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  integrations: [react(), tailwind()],
  output: 'static',
  site: 'https://parthbhodia.github.io',
  base: '/Trading-bot-algo',
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
