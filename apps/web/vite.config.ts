import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  // GitHub Pages serves from /<repo>/; set VITE_BASE=/valuer/ for that build.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        manualChunks: { firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage', 'firebase/functions'] },
      },
    },
  },
});
