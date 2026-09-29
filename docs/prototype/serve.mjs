// Local, read-only design preview. Serves only the prototype and official theme.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const harness = process.argv[2]
if (!harness) throw new Error('Usage: node docs/prototype/serve.mjs <harness-checkout> [port]')
const port = Number(process.argv[3] || 3182)
const theme = resolve(harness, 'packages/client/ui-theme/src/styles')
const files = new Map([
  ['/', new URL('./index.html', import.meta.url)],
  ['/base.css', resolve(theme, 'base.css')],
  ['/theme.css', resolve(theme, 'design-platform.css')],
  ['/elevation.css', resolve(theme, 'gradient-shadow-text.css')],
])
createServer(async (req, res) => {
  const path = files.get(req.url)
  if (!path) { res.writeHead(404); res.end(); return }
  try {
    const content = await readFile(path)
    res.writeHead(200, { 'Content-Type': req.url === '/' ? 'text/html; charset=utf-8' : 'text/css; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(content)
  } catch { res.writeHead(500); res.end('Preview source unavailable') }
}).listen(port, '127.0.0.1', () => console.log(`CTM design preview: http://127.0.0.1:${port}`))
