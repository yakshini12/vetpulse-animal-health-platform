import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev requests to /api are proxied to the local API server, so the browser
// client always talks to a same-origin endpoint in development.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // recharts dominates the bundle; split it out for better cache behaviour.
        manualChunks: {
          charts: ['recharts'],
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
