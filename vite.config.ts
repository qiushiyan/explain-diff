import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Builds the viewer once at package build time into dist/viewer.
// Sessions are pure data; nothing here runs per-session.
export default defineConfig({
  root: 'src/viewer',
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist/viewer', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    // Dev loop for the viewer itself: run `explain-diff open <session>` on 4747,
    // then `pnpm dev:viewer` proxies the data API to it.
    proxy: {
      '/api': 'http://localhost:4747',
      '/figures': 'http://localhost:4747',
    },
  },
})
