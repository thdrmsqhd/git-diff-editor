import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname, 'webview'),
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, 'dist/webview'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'webview/index.html'),
      output: {
        entryFileNames: 'webview.js',
        chunkFileNames: 'chunk-[name].js',
        assetFileNames: (asset) => asset.name?.endsWith('.css') ? 'webview.css' : 'asset-[name][extname]'
      }
    }
  }
});
