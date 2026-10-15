import { Chess } from 'chess.js'
import type { Color } from '../core/types'
import type { EngineLine } from './uci'

/** An evaluation from White's point of view. */
export interface WhiteEval {
  cp?: number
  mate?: number
}

/** Converts an engine line (side-to-move POV) to White's POV. */
export function toWhiteEval(line: Pick<EngineLine, 'cp' | 'mate'>, turn: Color): WhiteEval {
  const sign = turn === 'w' ? 1 : -1
  return line.mate !== undefined ? { mate: line.mate * sign } : { cp: (line.cp ?? 0) * sign }
}

/**
 * Winning chances for White in percent, using lichess's published model
 * (also the basis for move accuracy in Game Review).
 */
export function winPercent(ev: WhiteEval): number {
  if (ev.mate !== undefined) return ev.mate > 0 ? 100 : ev.mate < 0 ? 0 : 50
  const cp = Math.max(-1000, Math.min(1000, ev.cp ?? 0))
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1)
}

/** "+1.25", "-0.40", "M3", "-M2" — chess.com style. */
export function formatEval(ev: WhiteEval): string {
  if (ev.mate !== undefined) return `${ev.mate < 0 ? '-' : ''}M${Math.abs(ev.mate)}`
  const pawns = (ev.cp ?? 0) / 100
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(2)}`
}

export interface SanMove {
  san: string
  uci: string
  /** Ply number of this move (1 = White's first move). */
  ply: number
}

/** Converts a UCI principal variation into SAN moves, stopping at the first illegal one. */
export function pvToSan(fen: string, pv: string[], max = 12): SanMove[] {
  const chess = new Chess(fen)
  const [, turn, , , , fullmove] = fen.split(' ')
  let ply = (Number(fullmove) - 1) * 2 + (turn === 'b' ? 1 : 0)
  const out: SanMove[] = []
  for (const uci of pv.slice(0, max)) {
    try {
      const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
      out.push({ san: m.san, uci, ply: ++ply })
    } catch {
      break
    }
  }
  return out
}
