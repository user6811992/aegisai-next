import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [preact(), tailwindcss()],
  publicDir: 'static',
  build: {
    outDir: 'public',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8080',
    },
  },
});
