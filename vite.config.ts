import react from '@vitejs/plugin-react';
import {sentryVitePlugin} from '@sentry/bundler-plugins/vite';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import {createApi} from './server/api.js';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const siteUrl = env.VITE_SITE_URL || env.SITE_URL || 'https://ibmc2026.up.railway.app';
  const sentryRelease = process.env.VITE_SENTRY_RELEASE || process.env.SENTRY_RELEASE || process.env.RAILWAY_GIT_COMMIT_SHA || env.VITE_SENTRY_RELEASE || '';
  const sentryEnvironment = process.env.VITE_SENTRY_ENVIRONMENT || process.env.SENTRY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME || mode;
  const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN || env.SENTRY_AUTH_TOKEN || '';
  return {
    build: {
      sourcemap: sentryAuthToken ? 'hidden' : false,
    },
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
      ...(sentryAuthToken ? [sentryVitePlugin({
        org: 'small-simple-steps',
        project: 'ibmc-web',
        authToken: sentryAuthToken,
        release: {name: sentryRelease || undefined},
        sourcemaps: {filesToDeleteAfterUpload: ['./dist/**/*.map']},
      })] : []),
    ],
    define: {
      'import.meta.env.VITE_SENTRY_RELEASE': JSON.stringify(sentryRelease),
      'import.meta.env.VITE_SENTRY_ENVIRONMENT': JSON.stringify(sentryEnvironment),
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
