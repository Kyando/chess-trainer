// Builds public/puzzles/lichess.json: a small, themed subset of the lichess puzzle
// database (CC0, https://database.lichess.org/#puzzles), for 400–1800 rated players.
// Usage: node scripts/build-puzzles.mjs
// Streams the compressed CSV and stops as soon as every theme × rating band is full,
// so only the first few percent of the file is downloaded. Needs Node 23.8+ (zstd).
import { mkdirSync, writeFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const URL = 'https://database.lichess.org/lichess_db_puzzle.csv.zst'

/** Lichess theme tags we keep. */
const THEMES = [
  'mateIn1',
  'mateIn2',
  'mateIn3',
  'backRankMate',
  'hangingPiece',
  'fork',
  'pin',
  'skewer',
  'discoveredAttack',
  'trappedPiece',
  'deflection',
  'attraction',
  'defensiveMove',
  'endgame',
  'opening',
]
const BANDS = [400, 600, 800, 1000, 1200, 1400, 1600] // each 200 wide
const PER_BAND = 30
const MAX_LINES = 1_500_000

const quota = new Map(THEMES.flatMap((t) => BANDS.map((b) => [`${t}|${b}`, 0])))
const kept = []
let lines = 0

const res = await fetch(URL, { headers: { 'User-Agent': 'chess-trainer (personal project)' } })
if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
const stream = decompressFrames(res.body)

let rest = ''
outer: for await (const chunk of stream) {
  const text = rest + chunk
  const rows = text.split('\n')
  rest = rows.pop()
  for (const row of rows) {
    if (++lines === 1 || !row) continue
    // PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
    const [id, fen, moves, rating, rd, popularity, plays, themes] = row.split(',')
    const r = Number(rating)
    if (r < 400 || r >= 1800 || Number(rd) > 90 || Number(popularity) < 85 || Number(plays) < 300) continue
    const band = BANDS.findLast((b) => r >= b)
    const tags = themes.split(' ').filter((t) => THEMES.includes(t))
    const open = tags.filter((t) => quota.get(`${t}|${band}`) < PER_BAND)
    if (open.length === 0) continue
    for (const t of tags) quota.set(`${t}|${band}`, quota.get(`${t}|${band}`) + 1)
    kept.push([id, fen, moves, r, tags.join(' ')])
    if ([...quota.values()].every((n) => n >= PER_BAND)) break outer
    if (lines >= MAX_LINES) break outer
  }
}
await res.body.cancel().catch(() => {})

mkdirSync('public/puzzles', { recursive: true })
writeFileSync('public/puzzles/lichess.json', JSON.stringify(kept))
const short = [...quota].filter(([, n]) => n < PER_BAND).map(([k, n]) => `${k}:${n}`)
console.log(`${kept.length} puzzles from ${lines} rows; unfilled: ${short.join(', ') || 'none'}`)
process.exit(0)

/**
 * The file is written by pzstd: each zstd frame is preceded by a skippable frame
 * holding its compressed size. Node's streaming decoder stops at the first
 * skippable frame, so frames are cut out and decoded one by one.
 */
async function* decompressFrames(body) {
  let buf = Buffer.alloc(0)
  for await (const chunk of body) {
    buf = Buffer.concat([buf, chunk])
    for (;;) {
      if (buf.length < 12) break
      const magic = buf.readUInt32LE(0)
      if ((magic & 0xfffffff0) !== 0x184d2a50) throw new Error('unexpected frame layout')
      const size = buf.readUInt32LE(8)
      if (buf.length < 12 + size) break
      yield zstdDecompressSync(buf.subarray(12, 12 + size)).toString('utf8')
      buf = buf.subarray(12 + size)
    }
  }
}
