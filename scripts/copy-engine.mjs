// Copies the Stockfish WASM engine from node_modules into public/engine so Vite
// serves it as a static file the Web Worker can load.
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', 'stockfish', 'bin')
const dest = join(root, 'public', 'engine')
const files = ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']

mkdirSync(dest, { recursive: true })
for (const file of files) copyFileSync(join(src, file), join(dest, file))
console.log(`copied ${files.length} engine files to public/engine`)
