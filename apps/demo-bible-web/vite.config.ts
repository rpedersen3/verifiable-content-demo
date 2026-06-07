import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      // Forward /a2a/<route> in the browser to <route> on the bible-a2a worker,
      // stripping the /a2a prefix (avoids CORS in dev).
      '/a2a': {
        target: 'http://127.0.0.1:8791',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/a2a/, ''),
      },
    },
  },
});
