import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command, isPreview }) => ({
  base: process.env.VITE_BASE || (command === 'build' || isPreview ? '/app/' : '/'),
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    fs: {
      allow: ['..']
    }
  }
}));
