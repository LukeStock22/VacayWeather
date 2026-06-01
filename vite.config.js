import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react()],
  // GitHub Pages serves project sites from a subpath, so production builds
  // need relative asset URLs instead of assuming the app is hosted at `/`.
  base: command === 'build' ? './' : '/',
}))
