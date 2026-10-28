import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@warsha/ui': path.resolve(__dirname, '../../packages/ui/src'),
      '@warsha/i18n': path.resolve(__dirname, '../../packages/i18n/src'),
      '@warsha/client': path.resolve(__dirname, '../../packages/client/src'),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});