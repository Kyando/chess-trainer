// Builds src/data/openings.json from the lichess-org/chess-openings TSV files (CC0).
// Usage: node scripts/build-openings.mjs <dir containing a.tsv … e.tsv>
// Output maps a position key (FEN without move counters) to [eco, name].
import { Chess } from 'chess.js'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) throw new Error('pass the directory with the TSV files')

const out = {}
for (const file of ['a', 'b', 'c', 'd', 'e']) {
  const rows = readFileSync(join(dir, `${file}.tsv`), 'utf8').trim().split('\n').slice(1)
  for (const row of rows) {
    const [eco, name, pgn] = row.split('\t')
    const chess = new Chess()
    chess.loadPgn(pgn)
    out[chess.fen().split(' ').slice(0, 4).join(' ')] = [eco, name]
  }
}
writeFileSync('src/data/openings.json', JSON.stringify(out))
console.log(`${Object.keys(out).length} positions`)
