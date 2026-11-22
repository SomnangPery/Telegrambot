import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Listen on every local address (localhost, 127.0.0.1, ::1) so all browsers can connect.
    host: true,
    // Fail loudly instead of silently moving to 5174 if 5173 is taken.
    strictPort: true,
    // In dev, /api goes to the local backend so no CORS setup is needed.
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
});
