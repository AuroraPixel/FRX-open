import react from '@vitejs/plugin-react';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// The FastAPI server serves the build at /play/ and the runtime art (not bundled) at
// /play/assets/. Built scripts and styles therefore go to /play/static/ so the two never meet.
//
// Modes: `development` and `shots` include the component gallery and the sample-data mode
// (__DEV_PAGES__); a `production` build leaves both out. `vite build --mode shots` writes to
// dist-shots/ for the screenshot tool (tools/shots.mjs).
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(here, 'assets');
const api = `http://127.0.0.1:${process.env.FRX_API_PORT ?? '8796'}`;

const TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** In development the runtime art comes straight from assets/, as the server would serve it. */
function runtimeAssets(): Plugin {
  return {
    name: 'frx-runtime-assets',
    configureServer(server) {
      server.middlewares.use('/play/assets', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
        const file = path.join(assets, rel);
        if (!file.startsWith(assets + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
          next();
          return;
        }
        res.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(file).pipe(res);
      });
    },
  };
}

/** A Markdown file imported by a module is its text (the licence list shown in 设置 · 关于). */
function markdownText(): Plugin {
  return {
    name: 'frx-markdown-text',
    transform(code, id) {
      return id.endsWith('.md') ? { code: `export default ${JSON.stringify(code)};`, map: null } : null;
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: '/play/',
  plugins: [react(), runtimeAssets(), markdownText()],
  publicDir: 'public',
  define: {
    __DEV_PAGES__: JSON.stringify(mode !== 'production'),
  },
  build: {
    outDir: mode === 'shots' ? 'dist-shots' : 'dist',
    assetsDir: 'static',
    sourcemap: false,
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: Number(process.env.FRX_PLAY_PORT ?? 5180),
    strictPort: true,
    proxy: {
      '/api': { target: api, changeOrigin: false },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tools/**/*.test.{ts,mjs}'],
  },
}));
