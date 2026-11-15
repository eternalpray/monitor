import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 产物直接输出到 server/public，生产由 Express 托管，运行时无需 Vite
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, '../server/public'),
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:7788',
        changeOrigin: true,
      },
    },
  },
});
