import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const api = process.env.AMS_API || 'http://localhost:8080';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // Relative asset URLs so the same build works from the hospital server and inside the Android app.
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Android System WebView on older phones: keep the syntax conservative.
    target: ['es2020', 'chrome87', 'safari14'],
    chunkSizeWarningLimit: 1600,
  },
  server: {
    fs: { allow: ['..'] },
    proxy: { '/api': api },
  },
  preview: {
    proxy: { '/api': api },
  },
});
