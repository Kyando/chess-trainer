import { materialBalance as balance } from '../core/material'
import type { Color } from '../core/types'
import type { TimeClass } from '../data/db'
import { ERRORS, type GameReview, type MoveClass, type PositionEval } from '../review/review'
import { detectMotifs, type Motif } from './motifs'
import { newSrs, type SrsState } from './srs'

export type Theme =
  | 'missed-mate'
  | 'allowed-mate'
  | 'hanging-piece'
  | 'missed-material'
  | 'missed-punish'
  | Motif
  | 'positional'

export const THEME_LABELS: Record<Theme, string> = {
  'missed-mate': 'Missed mate',
  'allowed-mate': 'Allowed mate',
  'hanging-piece': 'Hung material',
  'missed-material': 'Missed material win',
  'missed-punish': "Didn't punish a blunder",
  fork: 'Fork',
  pin: 'Pin',
  skewer: 'Skewer',
  'discovered-attack': 'Discovered attack',
  'back-rank': 'Back-rank mate',
  positional: 'Deeper / positional',
}

/** A position from one of my games where I went wrong; solved by finding a better move. */
export interface Puzzle extends SrsState {
  /** "<gameId>:<move index>". */
  id: string
  gameId: string
  /** Index of the erring move in the game's main line. */
  index: number
  fen: string
  /** The opponent's move just before, highlighted at the start. */
  lastMove?: [string, string]
  color: Color
  bestUci: string
  bestSan: string
  pv: string[]
  playedUci: string
  playedSan: string
  cls: MoveClass
  loss: number
  winBefore: number
  themes: Theme[]
  opponent: string
  gameEnd: number
  timeClass?: TimeClass
  createdAt: number
}

export interface GameMeta {
  gameId: string
  userColor: Color
  opponent: string
  endTime: number
  timeClass?: TimeClass
}

/** Errors worth drilling: not when the game was already lost anyway. */
const MIN_WIN_BEFORE = 30

/** Turns my mistakes, misses and blunders in a reviewed game into puzzles. */
export function extractPuzzles(
  review: GameReview,
  fens: string[],
  evals: PositionEval[],
  meta: GameMeta,
  now: number,
): Puzzle[] {
  const out: Puzzle[] = []
  for (const m of review.moves) {
    if (m.color !== meta.userColor || !ERRORS.has(m.cls) || !m.bestUci || !m.bestSan) continue
    if (m.winBefore < MIN_WIN_BEFORE) continue
    const prev = review.moves[m.index - 1]
    const pv = evals[m.index].pv ?? [m.bestUci]
    out.push({
      ...newSrs(now),
      id: `${meta.gameId}:${m.index}`,
      gameId: meta.gameId,
      index: m.index,
      fen: fens[m.index],
      lastMove: prev ? [prev.uci.slice(0, 2), prev.uci.slice(2, 4)] : undefined,
      color: m.color,
      bestUci: m.bestUci,
      bestSan: m.bestSan,
      pv,
      playedUci: m.uci,
      playedSan: m.san,
      cls: m.cls,
      loss: Math.round(m.loss),
      winBefore: m.winBefore,
      themes: themesOf(fens[m.index], m.uci, pv, evals[m.index], evals[m.index + 1], m.cls, m.color),
      opponent: meta.opponent,
      gameEnd: meta.endTime,
      timeClass: meta.timeClass,
      createdAt: now,
    })
  }
  return out
}

function themesOf(
  fen: string,
  played: string,
  pv: string[],
  before: PositionEval,
  after: PositionEval | undefined,
  cls: MoveClass,
  color: Color,
): Theme[] {
  const sign = color === 'w' ? 1 : -1
  const themes: Theme[] = []
  if (before.eval.mate !== undefined && before.eval.mate * sign > 0) themes.push('missed-mate')
  if (after && !after.terminal && after.eval.mate !== undefined && after.eval.mate * sign < 0) themes.push('allowed-mate')
  if (cls === 'miss') themes.push('missed-punish')
  const start = balance(fen, [], color)
  // Material two plies on: my move and the opponent's best reply, vs. the best line.
  if (start - balance(fen, [played, ...(after?.pv?.slice(0, 1) ?? [])], color) >= 2) themes.push('hanging-piece')
  if (balance(fen, pv.slice(0, 3), color) - start >= 2) themes.push('missed-material')
  themes.push(...detectMotifs(fen, pv, color))
  return themes.length ? themes : ['positional']
}
