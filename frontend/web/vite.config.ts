import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, fileURLToPath(new URL('../..', import.meta.url)), ''), ...process.env };
  return {
    plugins: [react()],
    server: {
      host: env.WEB_HOST ?? '127.0.0.1',
      port: Number(env.WEB_PORT ?? 5173),
      strictPort: true,
      proxy: {
        '/api': env.API_PROXY_TARGET ?? `http://127.0.0.1:${env.API_PORT ?? 3000}`,
      },
    },
  };
});
