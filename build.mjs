// Build the host half (dsh/index.js, ESM) and the client half (dsh/client.js,
// lazy-CJS browser bundle). The shared contract.ts and zod are inlined into both.
import { build } from 'esbuild'

const ID = '@deepseek-ai/dsh-ctm'

// Host half → dsh/index.js (ESM, Node)
await build({
  entryPoints: ['src/host.ts'],
  outfile: 'dsh/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  treeShaking: true,
  minify: false,
})

// Client half → dsh/client.js (lazy-CJS browser bundle; react resolved from the
// shell's frozen module table through the injected require).
await build({
  entryPoints: ['src/client/index.tsx'],
  outfile: 'dsh/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  treeShaking: true,
  minify: false,
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
  banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {\nvar module = { exports: {} };\nvar exports = module.exports;` },
  footer: { js: 'return module.exports; } });' },
})
