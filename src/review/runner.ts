import { Chess } from 'chess.js'
import type { Color } from '../core/types'
import { toWhiteEval, winPercent } from '../engine/eval'
import type { StockfishEngine } from '../engine/stockfish'
import type { PositionEval } from './review'

/**
 * Engine work per position. ~0.3 s on a laptop, ~1 s on a phone with the lite
 * net; plenty to tell a blunder from a good move at club level.
 */
export const REVIEW_NODES = 200_000

/** Identifies a main line, so cached reviews survive reloads but not edits. */
export function reviewKey(startFen: string, ucis: string[]): string {
  return `${startFen}|${ucis.join(' ')}`
}

/** Evaluates every position, reporting progress; stops early when `signal` aborts. */
export async function evaluatePositions(
  engine: StockfishEngine,
  fens: string[],
  opts: { nodes: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void },
): Promise<PositionEval[]> {
  const out: PositionEval[] = []
  await engine.newGame()
  for (const fen of fens) {
    if (opts.signal?.aborted) throw new DOMException('Review cancelled', 'AbortError')
    out.push(await evaluate(engine, fen, opts.nodes))
    opts.onProgress?.(out.length, fens.length)
  }
  return out
}

async function evaluate(engine: StockfishEngine, fen: string, nodes: number): Promise<PositionEval> {
  const chess = new Chess(fen)
  if (chess.isCheckmate()) return { eval: { cp: 0 }, terminal: 'checkmate' }
  if (chess.isStalemate() || chess.isInsufficientMaterial()) return { eval: { cp: 0 }, terminal: 'draw' }
  const turn = chess.turn()
  const { bestmove, lines } = await engine.search(fen, { nodes, multipv: 2 })
  const [first, second] = lines
  return {
    eval: first ? toWhiteEval(first, turn) : { cp: 0 },
    best: bestmove,
    pv: first?.pv.slice(0, 8),
    second: second ? toWhiteEval(second, turn) : undefined,
  }
}

/** Winning chances (mover's POV) after playing `uci` in `fen`. */
export async function winAfterMove(engine: StockfishEngine, fen: string, uci: string, nodes: number): Promise<number> {
  const chess = new Chess(fen)
  const mover = chess.turn() as Color
  chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
  const ev = await evaluate(engine, chess.fen(), nodes)
  if (ev.terminal === 'checkmate') return 100
  if (ev.terminal === 'draw') return 50
  const white = winPercent(ev.eval)
  return mover === 'w' ? white : 100 - white
}
