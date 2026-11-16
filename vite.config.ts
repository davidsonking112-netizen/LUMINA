import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const vitePort = Number(process.env.VITE_PORT ?? 5173)
const apiPort = Number(process.env.PORT ?? 8787)

export default defineConfig({
  plugins: [react()],
  server: {
    port: vitePort,
    strictPort: process.env.VITE_STRICT_PORT === 'true',
    headers: {
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "frame-ancestors 'none'",
    },
    proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true } },
  },
})
