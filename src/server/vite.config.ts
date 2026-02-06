import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'ui'),
  server: { port: 5173, strictPort: true },
  build: {
    outDir: resolve(__dirname, '../../dist/ui'),
    emptyOutDir: true,
  },
});
