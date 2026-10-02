import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Standalone component gallery: no API proxy or local credentials.
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5183, strictPort: true },
});
