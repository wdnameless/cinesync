import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  // Emit asset URLs relative to the HTML file. The default ('/') produced
  // `<script src="/popup.js">`, which a Chrome extension resolves against the
  // EXTENSION ROOT, not against dist/ where the file actually lands — so the
  // packaged popup loaded no JavaScript at all. Relative refs make
  // `dist/popup.html` point at `dist/popup.js`.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        background: resolve(__dirname, 'src/background.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
