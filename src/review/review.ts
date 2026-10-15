import { Chess } from 'chess.js'
import type { Color } from '../core/types'
import { winPercent, type WhiteEval } from '../engine/eval'

/** Engine verdict on one position of the game. */
export interface PositionEval {
  /** Evaluation from White's point of view (ignored when `terminal` is set). */
  eval: WhiteEval
  terminal?: 'checkmate' | 'draw'
  /** Engine's best move (UCI) and its continuation. */
  best?: string
  pv?: string[]
  /** White-POV evaluation of the second-best move, when there is one. */
  second?: WhiteEval
}

export type MoveClass =
  | 'book'
  | 'forced'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'miss'
  | 'blunder'

/** Display order and labels, chess.com style. */
export const MOVE_CLASSES: { cls: MoveClass; label: string; glyph: string; color: string }[] = [
  { cls: 'great', label: 'Great', glyph: '!', color: '#5c8bb0' },
  { cls: 'best', label: 'Best', glyph: '★', color: '#81b64c' },
  { cls: 'excellent', label: 'Excellent', glyph: '✓', color: '#96bc4b' },
  { cls: 'good', label: 'Good', glyph: '✓', color: '#95b776' },
  { cls: 'book', label: 'Book', glyph: '≡', color: '#a88865' },
  { cls: 'forced', label: 'Forced', glyph: '□', color: '#97a0a8' },
  { cls: 'inaccuracy', label: 'Inaccuracy', glyph: '?!', color: '#f7c631' },
  { cls: 'mistake', label: 'Mistake', glyph: '?', color: '#ffa459' },
  { cls: 'miss', label: 'Miss', glyph: '✗', color: '#ff7769' },
  { cls: 'blunder', label: 'Blunder', glyph: '??', color: '#fa412d' },
]
export const CLASS_INFO = Object.fromEntries(MOVE_CLASSES.map((c) => [c.cls, c])) as Record<
  MoveClass,
  (typeof MOVE_CLASSES)[number]
>

/** Moves worth retrying or jumping to. */
export const ERRORS: ReadonlySet<MoveClass> = new Set(['mistake', 'miss', 'blunder'])

export interface ReviewedMove {
  /** Index of the move in the main line (0 = first move); positions i → i+1. */
  index: number
  color: Color
  san: string
  uci: string
  cls: MoveClass
  /** Winning chances lost by the move, in percentage points (mover's POV). */
  loss: number
  /** Move accuracy 0–100 (lichess formula). */
  accuracy: number
  /** Mover's winning chances before and after the move. */
  winBefore: number
  winAfter: number
  /** Engine's best move in the position before, when it differs from the played one. */
  bestUci?: string
  bestSan?: string
  /** Engine line starting with the best move. */
  bestPv?: string[]
}

export interface GameReview {
  moves: ReviewedMove[]
  /** White's winning chances for every position (moves.length + 1 values). */
  whiteWin: number[]
  accuracy: Record<Color, number | null>
  counts: Record<Color, Record<MoveClass, number>>
}

/** White's winning chances (0–100) for a reviewed position. */
export function positionWin(fen: string, ev: PositionEval): number {
  if (ev.terminal === 'checkmate') return fen.split(' ')[1] === 'w' ? 0 : 100
  if (ev.terminal === 'draw') return 50
  return winPercent(ev.eval)
}

/** lichess: accuracy of a single move from the winning chances it lost. */
export function moveAccuracy(loss: number): number {
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669))
}

/**
 * Game accuracy as lichess computes it: per-move accuracies weighted by how
 * volatile the position was, averaged with their harmonic mean (which punishes
 * single big errors).
 */
export function gameAccuracy(whiteWin: number[], moves: Pick<ReviewedMove, 'color' | 'accuracy'>[], color: Color): number | null {
  const own = moves.map((m, i) => ({ m, i })).filter((x) => x.m.color === color)
  if (!own.length) return null
  const size = Math.max(2, Math.min(8, Math.floor(whiteWin.length / 10)))
  const windows: number[][] = []
  for (let i = 0; i + size <= whiteWin.length; i++) windows.push(whiteWin.slice(i, i + size))
  if (!windows.length) windows.push(whiteWin)
  // The first moves reuse the first window.
  while (windows.length < moves.length) windows.unshift(windows[0])
  const weights = windows.map((w) => Math.max(0.5, Math.min(12, stdev(w))))
  const weighted =
    own.reduce((a, x) => a + x.m.accuracy * weights[x.i], 0) / own.reduce((a, x) => a + weights[x.i], 0)
  const harmonic = own.length / own.reduce((a, x) => a + 1 / Math.max(x.m.accuracy, 1), 0)
  return (weighted + harmonic) / 2
}

function stdev(a: number[]): number {
  const m = a.reduce((x, y) => x + y, 0) / a.length
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length)
}

const classByLoss = (loss: number): MoveClass =>
  loss >= 20 ? 'blunder' : loss >= 10 ? 'mistake' : loss >= 5 ? 'inaccuracy' : loss >= 2 ? 'good' : 'excellent'

/**
 * Classifies every move of a game.
 * @param fens positions from the start, `moves.length + 1` of them
 * @param evals one engine verdict per position
 * @param isBook whether a position is a known opening position
 */
export function reviewGame(
  fens: string[],
  moves: { san: string; uci: string }[],
  evals: PositionEval[],
  isBook: (fen: string) => boolean = () => false,
): GameReview {
  const whiteWin = fens.map((fen, i) => positionWin(fen, evals[i]))
  let inBook = true
  const reviewed: ReviewedMove[] = moves.map((move, i) => {
    const color = fens[i].split(' ')[1] as Color
    const pov = (w: number) => (color === 'w' ? w : 100 - w)
    const winBefore = pov(whiteWin[i])
    const winAfter = pov(whiteWin[i + 1])
    const loss = Math.max(0, winBefore - winAfter)
    const ev = evals[i]
    const chess = new Chess(fens[i])
    const legal = chess.moves({ verbose: true })

    let cls: MoveClass
    inBook &&= isBook(fens[i + 1])
    if (legal.length === 1) cls = 'forced'
    else if (inBook && loss < 10) cls = 'book'
    else if (move.uci === ev.best) cls = isOnlyMove(fens, moves, evals, i, winBefore) ? 'great' : 'best'
    else cls = classByLoss(loss)

    const bestMove = ev.best && ev.best !== move.uci ? legal.find((m) => m.lan === ev.best) : undefined
    return {
      index: i,
      color,
      san: move.san,
      uci: move.uci,
      cls,
      loss,
      accuracy: moveAccuracy(loss),
      winBefore,
      winAfter,
      bestUci: bestMove?.lan,
      bestSan: bestMove?.san,
      bestPv: bestMove ? ev.pv : undefined,
    }
  })

  // A miss: the opponent just erred and the reply handed the chance back
  // without going further down than before their error.
  for (const m of reviewed) {
    const prev = reviewed[m.index - 1]
    if (!prev || !(m.cls === 'mistake' || m.cls === 'blunder')) continue
    if (prev.cls !== 'mistake' && prev.cls !== 'blunder') continue
    if (m.winAfter >= 100 - prev.winBefore - 5) m.cls = 'miss'
  }

  const counts = { w: emptyCounts(), b: emptyCounts() }
  for (const m of reviewed) counts[m.color][m.cls]++
  return {
    moves: reviewed,
    whiteWin,
    accuracy: { w: gameAccuracy(whiteWin, reviewed, 'w'), b: gameAccuracy(whiteWin, reviewed, 'b') },
    counts,
  }
}

/**
 * The best move was the only good one: the second-best move would have cost a
 * lot, the game was still in the balance, and it was not a plain recapture.
 */
function isOnlyMove(
  fens: string[],
  moves: { uci: string }[],
  evals: PositionEval[],
  i: number,
  winBefore: number,
): boolean {
  const second = evals[i].second
  if (!second || winBefore > 90) return false
  const color = fens[i].split(' ')[1]
  const secondWin = color === 'w' ? winPercent(second) : 100 - winPercent(second)
  if (winBefore - secondWin < 15) return false
  const prev = moves[i - 1]
  const recapture = prev && prev.uci.slice(2, 4) === moves[i].uci.slice(2, 4) && isCapture(fens[i - 1], prev.uci)
  return !recapture
}

function isCapture(fen: string, uci: string): boolean {
  const square = uci.slice(2, 4)
  return new Chess(fen).get(square as never) !== undefined
}

function emptyCounts(): Record<MoveClass, number> {
  return Object.fromEntries(MOVE_CLASSES.map((c) => [c.cls, 0])) as Record<MoveClass, number>
}
