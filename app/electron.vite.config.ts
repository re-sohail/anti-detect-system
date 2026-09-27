import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    build: { externalizeDeps: { exclude: ['@lvd/shared', 'zod'] } },
    resolve: { alias: { '@common': resolve('src/common') } },
  },
  preload: {
    build: { externalizeDeps: { exclude: ['@lvd/shared'] } },
    resolve: { alias: { '@common': resolve('src/common') } },
  },
  renderer: {
    resolve: { alias: { '@common': resolve('src/common') } },
    plugins: [react()],
  },
});
