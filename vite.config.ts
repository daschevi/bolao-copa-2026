import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFileSync } from 'fs'
import { resolve } from 'path'

const buildTime = String(Date.now())

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      // Gera dist/version.json após cada build.
      // O arquivo é buscado em runtime (cache: 'no-store'), então mesmo um JS
      // antigo em cache consegue detectar um novo deploy e forçar reload.
      name: 'version-file',
      closeBundle() {
        writeFileSync(
          resolve(__dirname, 'dist', 'version.json'),
          JSON.stringify({ v: buildTime }),
        )
      },
    },
  ],
  base: '/bolao-copa-2026/',
})
