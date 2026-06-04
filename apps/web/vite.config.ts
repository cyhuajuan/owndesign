import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    proxy: {
      '/api': {
        changeOrigin: true,
        target: 'http://127.0.0.1:3711',
      },
    },
  },
  resolve: {
    alias: [
      {
        find: /^@owndesign\/renderer$/,
        replacement: path.resolve(__dirname, '../../packages/renderer/src/app.tsx'),
      },
      {
        find: /^@owndesign\/renderer\/(.*)$/,
        replacement: path.resolve(__dirname, '../../packages/renderer/src/$1'),
      },
      {
        find: /^@owndesign\/core\/(.*)$/,
        replacement: path.resolve(__dirname, '../../packages/core/src/$1'),
      },
      {
        find: '@',
        replacement: path.resolve(__dirname, '../../packages/renderer/src'),
      },
    ],
  },
});
