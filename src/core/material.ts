import { Chess } from 'chess.js'
import type { Color } from './types'

const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 }
const START_COUNT: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 }
const ORDER = ['p', 'n', 'b', 'r', 'q']
const GLYPHS: Record<Color, Record<string, string>> = {
  w: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕' },
  b: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' },
}

export interface MaterialSummary {
  /** Glyphs of the opponent pieces this side has captured, low value first. */
  captured: Record<Color, string>
  /** Material lead in pawns (positive for the leading side only). */
  lead: Record<Color, number>
}

export function materialSummary(chess: Chess): MaterialSummary {
  const count: Record<Color, Record<string, number>> = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0 },
  }
  for (const row of chess.board()) {
    for (const sq of row) if (sq && sq.type !== 'k') count[sq.color][sq.type]++
  }
  const captured = { w: '', b: '' }
  const points = { w: 0, b: 0 }
  for (const color of ['w', 'b'] as const) {
    const opp: Color = color === 'w' ? 'b' : 'w'
    for (const t of ORDER) {
      points[color] += count[color][t] * VALUES[t]
      // Promotions can push a count above the start; never show negative captures.
      const missing = Math.max(0, START_COUNT[t] - count[opp][t])
      captured[color] += GLYPHS[opp][t].repeat(missing)
    }
  }
  const diff = points.w - points.b
  return { captured, lead: { w: Math.max(0, diff), b: Math.max(0, -diff) } }
}

const BALANCE_VALUES: Record<string, number> = { ...VALUES, k: 0 }

/** Material balance in pawns for `color` after playing `ucis` from `fen` (stops at an illegal move). */
export function materialBalance(fen: string, ucis: string[], color: Color): number {
  const chess = new Chess(fen)
  for (const u of ucis) {
    try {
      chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] })
    } catch {
      break
    }
  }
  let total = 0
  for (const row of chess.board()) {
    for (const sq of row) if (sq) total += (sq.color === color ? 1 : -1) * BALANCE_VALUES[sq.type]
  }
  return total
}
