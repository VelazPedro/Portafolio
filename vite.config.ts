import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// GitHub Pages sirve el sitio en /Portafolio/; Vercel y otros hosts, en la raíz.
const base = process.env.VERCEL ? '/' : '/Portafolio/'

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
