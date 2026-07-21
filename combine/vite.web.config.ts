import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Renderer в обычном браузере (без Electron), с mock-IPC слоем.
// См. docs/DECISIONS.md D-09 и src/renderer/lib/mock-api.ts
const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  server: {
    port: 5173
  },
  build: {
    outDir: resolve(__dirname, 'out/web')
  }
})
