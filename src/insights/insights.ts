import { Chess } from 'chess.js'
import type { MoveTree } from '../core/tree'
import type { Color } from '../core/types'
import type { GameRecord } from '../data/db'
import type { GameReview, MoveClass } from '../review/review'

// ---------- Results by opening ----------

export interface OpeningRow {
  /** Opening family, e.g. "Sicilian Defense". */
  name: string
  color: Color
  games: number
  wins: number
  draws: number
  losses: number
  /** Points per game in %, draws count half. */
  score: number
}

/** "Sicilian Defense: Najdorf Variation" → "Sicilian Defense". */
export function openingFamily(name: string): string {
  return name.split(':')[0].trim()
}

/** Results per opening family and color, most played first. */
export function openingStats(games: GameRecord[], minGames = 1): OpeningRow[] {
  const rows = new Map<string, OpeningRow>()
  for (const g of games) {
    if (!g.opening) continue
    const name = openingFamily(g.opening)
    const key = `${g.userColor}|${name}`
    let row = rows.get(key)
    if (!row) rows.set(key, (row = { name, color: g.userColor, games: 0, wins: 0, draws: 0, losses: 0, score: 0 }))
    row.games++
    if (g.outcome === 'win') row.wins++
    else if (g.outcome === 'draw') row.draws++
    else row.losses++
  }
  return [...rows.values()]
    .filter((r) => r.games >= minGames)
    .map((r) => ({ ...r, score: Math.round(((r.wins + r.draws / 2) / r.games) * 100) }))
    .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name))
}

// ---------- Errors by phase and clock ----------

export type Phase = 'opening' | 'middlegame' | 'endgame'
export const PHASES: Phase[] = ['opening', 'middlegame', 'endgame']

const PIECE_VALUES: Record<string, number> = { n: 3, b: 3, r: 5, q: 9 }

/**
 * Opening: the first 10 moves each. Endgame: at most 13 points of pieces
 * (no pawns, no kings) left on the board for both sides together, e.g. rook +
 * minor each. Middlegame: everything else.
 */
export function phaseOf(fen: string, ply: number): Phase {
  let material = 0
  for (const row of new Chess(fen).board()) for (const sq of row) if (sq) material += PIECE_VALUES[sq.type] ?? 0
  if (material <= 26 - 13) return 'endgame'
  return ply < 20 ? 'opening' : 'middlegame'
}

/** One of my moves in a reviewed game. */
export interface MoveSample {
  phase: Phase
  /** My clock before the move, in ms, when the PGN has clock times. */
  clockMs?: number
  cls: MoveClass
}

/** Initial clock in ms from a time control like "180+2" (undefined for daily / untimed). */
export function initialClockMs(timeControl: string): number | undefined {
  if (timeControl === '-' || timeControl.includes('/')) return undefined
  const base = Number(timeControl.split('+')[0])
  return Number.isFinite(base) ? base * 1000 : undefined
}

/** My moves in a reviewed game, with their phase and the time I had left. */
export function moveSamples(tree: MoveTree, review: GameReview, game: Pick<GameRecord, 'userColor' | 'timeControl'>): MoveSample[] {
  const line = tree.mainline()
  const fens = [tree.root.fen, ...line.map((n) => n.fen)]
  const start = initialClockMs(game.timeControl)
  const out: MoveSample[] = []
  for (const m of review.moves) {
    if (m.color !== game.userColor) continue
    // My previous move's clock comment is the time I had when this one started.
    const clockMs = m.index >= 2 ? line[m.index - 2]?.clock : start
    out.push({ phase: phaseOf(fens[m.index], tree.root.ply + m.index), clockMs, cls: m.cls })
  }
  return out
}

export interface ErrorRate {
  label: string
  moves: number
  /** Mistakes + misses + blunders. */
  errors: number
  blunders: number
  /** Per 100 moves. */
  errorRate: number
  blunderRate: number
}

function rate(label: string, samples: MoveSample[]): ErrorRate {
  const errors = samples.filter((s) => s.cls === 'mistake' || s.cls === 'miss' || s.cls === 'blunder').length
  const blunders = samples.filter((s) => s.cls === 'blunder').length
  const per100 = (n: number) => (samples.length ? Math.round((n / samples.length) * 1000) / 10 : 0)
  return { label, moves: samples.length, errors, blunders, errorRate: per100(errors), blunderRate: per100(blunders) }
}

export const PHASE_LABELS: Record<Phase, string> = { opening: 'Opening (moves 1–10)', middlegame: 'Middlegame', endgame: 'Endgame' }

export function errorsByPhase(samples: MoveSample[]): ErrorRate[] {
  return PHASES.map((p) => rate(PHASE_LABELS[p], samples.filter((s) => s.phase === p)))
}

/** Time-left buckets, in seconds: [lower bound, label]. */
const CLOCK_BUCKETS: [number, string][] = [
  [120, 'Over 2 min'],
  [60, '1–2 min'],
  [30, '30–60 s'],
  [10, '10–30 s'],
  [0, 'Under 10 s'],
]

export function errorsByClock(samples: MoveSample[]): ErrorRate[] {
  const timed = samples.filter((s) => s.clockMs !== undefined)
  return CLOCK_BUCKETS.map(([low, label], i) => {
    const high = i === 0 ? Infinity : CLOCK_BUCKETS[i - 1][0]
    return rate(label, timed.filter((s) => s.clockMs! / 1000 >= low && s.clockMs! / 1000 < high))
  })
}
