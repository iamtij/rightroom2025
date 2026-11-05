import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import {createApi} from './server/api.js';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const siteUrl = env.VITE_SITE_URL || env.SITE_URL || 'https://ibmc2026.up.railway.app';
  return {
    plugins: [
      react(),
      {
        name: 'ibmc-api',
        configureServer(server) {
          const api = createApi();
          server.middlewares.use((req, res, next) => {
            if (!req.url?.startsWith('/api')) return next();
            api(req, res, next);
          });
        },
      },
      {
        name: 'html-transform',
        transformIndexHtml(html) {
          return html.replace(/__SITE_URL__/g, siteUrl.replace(/\/$/, ''));
        },
      },
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 3000,
      host: true,
      strictPort: true,
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
