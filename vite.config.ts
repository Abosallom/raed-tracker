import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths so the build works at any URL (GitHub Pages serves
  // project sites from /<repo-name>/).
  base: './',
  plugins: [react()],
})
