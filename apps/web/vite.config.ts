import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const api = process.env.GREENLIT_API ?? 'http://localhost:4310'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    host: process.env.GREENLIT_WEB_HOST ?? 'localhost',
    port: Number(process.env.GREENLIT_WEB_PORT ?? 4300),
    strictPort: true,
    proxy: {
      '/api': { target: api, changeOrigin: false, ws: true },
    },
  },
  build: {
    target: 'es2023',
    sourcemap: true,
    chunkSizeWarningLimit: 1600,
  },
})
