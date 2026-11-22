// Build the browser half: src/client.js -> dist/client.js (single-file CJS +
// the ModuleLoader wrapper the DSH web client expects). The Host half is plain
// ESM source and needs no build.
import { build } from 'esbuild'
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const PLUGIN_ID = pkg.name

const banner =
  `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {` +
  ` const module = { exports: {} }; const exports = module.exports;`
const footer = ' return module.exports; } });'

const CLIENT_EXTERNALS = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']

function checkBundle() {
  const file = join(root, 'dist/client.js')
  const code = readFileSync(file, 'utf8')
  const requires = [...code.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1])
  const bad = requires.filter((spec) => !CLIENT_EXTERNALS.includes(spec))
  if (bad.length) throw new Error(`client bundle references non-baseline modules: ${bad.join(', ')}`)
  if (/\bimport\s*\(/.test(code)) throw new Error('client bundle contains a dynamic import()')
  const files = readdirSync(join(root, 'dist'))
  if (files.length !== 1 || files[0] !== 'client.js') {
    throw new Error(`dist/ must contain only client.js, found: ${files.join(', ')}`)
  }
}

rmSync(join(root, 'dist'), { recursive: true, force: true })
await build({
  entryPoints: [join(root, 'src/client.js')],
  outfile: join(root, 'dist/client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'chrome120',
  external: CLIENT_EXTERNALS,
  banner: { js: banner },
  footer: { js: footer },
  minify: !process.argv.includes('--watch'),
  sourcemap: process.argv.includes('--watch') ? 'inline' : false,
  logLevel: 'info',
  ...(process.argv.includes('--watch') ? { watch: true } : {}),
})

if (!process.argv.includes('--watch')) {
  checkBundle()
  const size = (Buffer.byteLength(readFileSync(join(root, 'dist/client.js'))) / 1024).toFixed(1)
  console.log(`[build] dist/client.js ${size} KB (id=${PLUGIN_ID})`)
} else {
  console.log(`[build] watching src/client.js -> dist/client.js (id=${PLUGIN_ID})`)
}
