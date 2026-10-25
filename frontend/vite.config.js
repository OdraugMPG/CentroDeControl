import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Desarrollo: /api se reenvía al backend (BACKEND_URL, por defecto http://localhost:3000).
// Producción: el frontend llama a VITE_API_URL o, si está vacío, a /api del mismo dominio.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: { port: 5173, proxy: { '/api': env.BACKEND_URL || 'http://localhost:3000' } },
    preview: { port: 4173 },
    build: { rollupOptions: { output: { manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], graficos: ['chart.js', 'react-chartjs-2'] } } } }
  };
});
