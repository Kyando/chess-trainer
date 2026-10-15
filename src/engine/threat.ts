import { Chess } from 'chess.js'
import { materialBalance } from '../core/material'
import { opposite, type Color } from '../core/types'
import { toWhiteEval, winPercent } from './eval'
import type { StockfishEngine } from './stockfish'
import { scoreValue, type EngineLine } from './uci'

/** Engine work per search when looking for threats (~0.3 s on a laptop). */
export const THREAT_NODES = 150_000

/** How much (in win %) the opponent must gain from a free move for it to count as a threat. */
export const THREAT_MIN_GAIN = 10

/**
 * …or in centipawns: in a lopsided position win % barely moves, but a piece
 * left hanging is still a threat worth seeing.
 */
export const THREAT_MIN_CP = 250

const isThreat = (winGain: number, cpGain: number) => winGain >= THREAT_MIN_GAIN || cpGain >= THREAT_MIN_CP

export interface Threat {
  uci: string
  san: string
  /** Opponent's win % gained if I ignore it, vs. my best move. */
  gain: number
  /** Moves to mate, when the threat is a mate. */
  mate?: number
  /** Material (in pawns) the opponent wins within a few moves. */
  material: number
}

export interface ThreatAnalysis {
  fen: string
  /** Real threats, strongest first; empty when there is none. */
  threats: Threat[]
  /** Opponent's win % in the real position, with me to move. */
  baseline: number
  /** The same as a comparable score (see scoreValue), opponent's POV. */
  baselineScore: number
}

/** The same position with the other side to move, as if I passed. Null when I am in check. */
export function nullMoveFen(fen: string): string | null {
  if (new Chess(fen).inCheck()) return null
  const parts = fen.split(' ')
  parts[1] = parts[1] === 'w' ? 'b' : 'w'
  parts[3] = '-'
  return parts.join(' ')
}

/** Opponent's moves in the passed position, in chessground's dests shape. */
export function threatDests(fen: string): Map<string, string[]> {
  const dests = new Map<string, string[]>()
  const passed = nullMoveFen(fen)
  if (!passed) return dests
  for (const m of new Chess(passed).moves({ verbose: true })) {
    const list = dests.get(m.from)
    if (list) list.push(m.to)
    else dests.set(m.from, [m.to])
  }
  return dests
}

/** Win % for `color` from an engine line scored for the side to move `turn`. */
function winFor(line: Pick<EngineLine, 'cp' | 'mate'>, turn: Color, color: Color): number {
  const white = winPercent(toWhiteEval(line, turn))
  return color === 'w' ? white : 100 - white
}

/**
 * Finds what the opponent threatens in `fen` (me to move): the moves they could
 * play if I passed that gain them at least THREAT_MIN_GAIN win % over the
 * position after my best move.
 */
export async function findThreats(engine: StockfishEngine, fen: string, nodes = THREAT_NODES): Promise<ThreatAnalysis> {
  const me = new Chess(fen).turn()
  const opp = opposite(me)
  const passed = nullMoveFen(fen)
  const real = await engine.search(fen, { nodes, multipv: 1 })
  const baseline = real.lines[0] ? winFor(real.lines[0], me, opp) : 50
  const baselineScore = real.lines[0] ? -scoreValue(real.lines[0]) : 0
  if (!passed) return { fen, threats: [], baseline, baselineScore }

  const { lines } = await engine.search(passed, { nodes, multipv: 3 })
  const chess = new Chess(passed)
  const threats: Threat[] = []
  for (const line of lines) {
    const uci = line.pv[0]
    if (!uci) continue
    const gain = winFor(line, opp, opp) - baseline
    const mate = line.mate !== undefined && line.mate > 0 ? line.mate : undefined
    if (!isThreat(gain, scoreValue(line) - baselineScore) && !mate) continue
    const san = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san
    chess.undo()
    // Material over the threat, my reply and their follow-up.
    const material = materialBalance(passed, line.pv.slice(0, 3), opp) - materialBalance(passed, [], opp)
    threats.push({ uci, san, gain: Math.round(gain), mate, material })
  }
  return { fen, threats, baseline, baselineScore }
}

/** Whether `uci` would be a threat too, if the opponent could play it for free. */
export async function isThreatMove(engine: StockfishEngine, analysis: ThreatAnalysis, uci: string, nodes = THREAT_NODES): Promise<boolean> {
  const passed = nullMoveFen(analysis.fen)
  if (!passed) return false
  const chess = new Chess(passed)
  const opp = chess.turn()
  // Answers come from board drags, which carry no promotion piece: assume a queen.
  chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q' })
  if (chess.isCheckmate()) return true
  if (chess.isDraw()) return false
  const { lines } = await engine.search(chess.fen(), { nodes, multipv: 1 })
  // Scored for me (to move after their move): flip to their POV.
  return lines[0] ? isThreat(winFor(lines[0], opposite(opp), opp) - analysis.baseline, -scoreValue(lines[0]) - analysis.baselineScore) : false
}

export type Verdict =
  /** Named a real threat. */
  | 'spotted'
  /** Rightly said there was nothing. */
  | 'calm'
  /** There was a threat and I named something else or nothing. */
  | 'missed'
  /** Named a move that isn't dangerous when there was no threat. */
  | 'false-alarm'

export const VERDICT_OK: Record<Verdict, boolean> = { spotted: true, calm: true, missed: false, 'false-alarm': false }

/**
 * Grades my answer: a move I think the opponent threatens (UCI), or null for
 * "no threat". `answerIsThreat` is the engine's view of that move when it is
 * not among the threats found (another real threat counts too).
 */
export function judgeThreat(analysis: ThreatAnalysis, answer: string | null, answerIsThreat = false): Verdict {
  const { threats } = analysis
  if (answer === null) return threats.length ? 'missed' : 'calm'
  // The same target square counts: Bxf7+ and Qxf7 are the same idea.
  const hit = threats.some((t) => t.uci.slice(0, 4) === answer.slice(0, 4) || (t.san.includes('x') && t.uci.slice(2, 4) === answer.slice(2, 4)))
  if (hit || answerIsThreat) return 'spotted'
  return threats.length ? 'missed' : 'false-alarm'
}

/** "Qxf7# — mate", "Nxe5 wins a knight (+3)", "d5 — a strong move". */
export function describeThreat(t: Threat): string {
  if (t.mate === 1) return `${t.san} is checkmate`
  if (t.mate) return `${t.san} leads to mate in ${t.mate}`
  if (t.material >= 1) return `${t.san} wins material (+${t.material})`
  return `${t.san} is a strong threat`
}
