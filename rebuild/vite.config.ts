import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      '@runtime': fileURLToPath(new URL(mode === 'fixture' ? './test/fixtures/runtime.ts' : './src/runtime.ts', import.meta.url))
    }
  },
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: {
    manifest: true,
    target: ['chrome111', 'safari16.4'],
    sourcemap: false,
    cssCodeSplit: true,
    rolldownOptions: {
      input: {
        app: fileURLToPath(new URL('./app/index.html', import.meta.url)),
        landing: fileURLToPath(new URL('./index.html', import.meta.url))
      }
    }
  }
}));
