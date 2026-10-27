import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        // React rarely changes between releases, so a separate chunk stays cached across app updates.
        codeSplitting: { groups: [{ name: 'vendor', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ }] },
      },
    },
  },
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false },
      '/ready': 'http://127.0.0.1:8787',
      '/health': 'http://127.0.0.1:8787',
    },
  },
});
