import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** Dev-only bridge: every /api/* request is served by twin-api.mjs (shells to the twin CLI). */
function twinApi(): Plugin {
  return {
    name: 'twin-api',
    configureServer(server) {
      server.middlewares.use('/api/', async (req, res) => {
        const { handle } = await import('./server/twin-api.mjs')
        await handle(req, res)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), twinApi()],
  server: { port: 5179, strictPort: true },
})
