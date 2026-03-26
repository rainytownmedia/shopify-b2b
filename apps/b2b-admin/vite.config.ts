import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ⚠️ IMPORTANT: Set BACKEND_PORT to the port shown in your `shopify app dev` terminal
// e.g. if terminal shows "Local: http://localhost:3456", set BACKEND_PORT=3456
const BACKEND_PORT = process.env.BACKEND_PORT || 4000;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api/admin': {
        target: `http://127.0.0.1:${BACKEND_PORT}`,
        changeOrigin: true,
      }
    }
  }
})

