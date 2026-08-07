import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative base so the built app works on GitHub Pages project sites
  // (yourname.github.io/prompter/) and custom domains without changes.
  base: './',
  server: {
    host: true,
  },
})
