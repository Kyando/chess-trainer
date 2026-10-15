import { Chess, type Square } from 'chess.js'
import { isBookPosition, loadOpenings } from '../core/openings'
import { MoveTree } from '../core/tree'
import { opposite, type Color } from '../core/types'
import type { ChessDb, GameRecord } from '../data/db'
import { opponentOf } from '../data/filters'
import { toWhiteEval, winPercent } from '../engine/eval'
import type { StockfishEngine } from '../engine/stockfish'
import { phaseOf } from '../insights/insights'
import { reviewGame } from '../review/review'
import { reviewKey } from '../review/runner'

/** mate: deliver checkmate; promote: queen a pawn safely; win: mate or reach a forced mate; draw: hold. */
export type Goal = 'mate' | 'promote' | 'win' | 'draw'

export interface EndgameDrill {
  id: string
  title: string
  fen: string
  goal: Goal
  /** My moves allowed (for a draw: moves to survive). */
  moveLimit: number
  tip: string
  /** Set for positions from my own games. */
  source?: string
}

/** Classic endings every club player should be able to play against perfect defence. */
export const STANDARD_DRILLS: EndgameDrill[] = [
  {
    id: 'kqk',
    title: 'Queen mate',
    fen: '8/8/8/4k3/8/8/8/3QK3 w - - 0 1',
    goal: 'mate',
    moveLimit: 15,
    tip: 'Keep the queen a knight’s move from the king to shrink its box, bring your own king up, and mate on the edge. Each move, check for stalemate.',
  },
  {
    id: 'krrk',
    title: 'Two-rook ladder',
    fen: '8/8/8/4k3/8/8/8/R3K2R w - - 0 1',
    goal: 'mate',
    moveLimit: 8,
    tip: 'Rooks take turns checking and cutting off a rank, walking the king to the edge. If the king attacks a rook, swing it to the far side.',
  },
  {
    id: 'krk',
    title: 'Rook mate',
    fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1',
    goal: 'mate',
    moveLimit: 30,
    tip: 'Cut the king off with the rook, bring your king opposite theirs, then check. When they step away, make a waiting rook move along the line.',
  },
  {
    id: 'kpk-win',
    title: 'King and pawn: escort',
    fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1',
    goal: 'promote',
    moveLimit: 12,
    tip: 'Your king in front of the pawn on the 6th rank wins: keep the opposition and let the pawn follow, never push it into a stalemate.',
  },
  {
    id: 'kpk-draw',
    title: 'King vs pawn: hold the draw',
    fen: '8/4k3/8/8/4P3/8/4K3/8 b - - 0 1',
    goal: 'draw',
    moveLimit: 20,
    tip: 'Stand in front of the pawn. When their king comes level with yours, step straight back and take the opposition.',
  },
  {
    id: 'lucena',
    title: 'Lucena: build a bridge',
    fen: '1K6/1P1k4/8/8/8/8/r7/2R5 w - - 0 1',
    goal: 'promote',
    moveLimit: 15,
    tip: 'Check the king away from the pawn, lift your rook to the 4th rank, then walk your king out; block the checks with the rook (the "bridge").',
  },
  {
    id: 'philidor',
    title: 'Philidor: rook on the 6th',
    fen: '3k4/8/7r/3PK3/8/8/8/R7 b - - 0 1',
    goal: 'draw',
    moveLimit: 20,
    tip: 'Keep your rook on your 6th rank so their king can’t advance. Once the pawn reaches it, go behind and check from far away.',
  },
]

export const GOAL_TEXT: Record<Goal, string> = {
  mate: 'Checkmate',
  promote: 'Promote the pawn',
  win: 'Win it',
  draw: 'Hold the draw',
}

/** The side I play: the side to move at the start. */
export const drillColor = (d: EndgameDrill): Color => new Chess(d.fen).turn()

export type DrillVerdict = { done: boolean; success?: boolean; message?: string }

/**
 * Judges the position after a move (mine or the engine's). `myWin` is my win %
 * by the engine (undefined when not evaluated yet), `myMoves` my moves so far,
 * `promoted` whether my last move promoted a pawn.
 */
export function judgeDrill(
  drill: EndgameDrill,
  fen: string,
  me: Color,
  myMoves: number,
  opts: { myWin?: number; myMate?: boolean; promoted?: boolean } = {},
): DrillVerdict {
  const chess = new Chess(fen)
  if (chess.isCheckmate()) {
    const iMated = chess.turn() !== me
    if (!iMated) return { done: true, success: false, message: 'You got mated.' }
    return { done: true, success: drill.goal !== 'draw', message: 'Checkmate — well done!' }
  }
  if (chess.isDraw() || chess.isStalemate()) {
    const why = chess.isStalemate() ? 'Stalemate' : chess.isThreefoldRepetition() ? 'Draw by repetition' : 'Draw'
    return drill.goal === 'draw'
      ? { done: true, success: true, message: `${why} — draw held!` }
      : { done: true, success: false, message: `${why}. The win got away.` }
  }
  const { myWin } = opts
  if (drill.goal === 'promote' && opts.promoted && myWin !== undefined && myWin >= 75) {
    return { done: true, success: true, message: 'Promoted, and the position is won.' }
  }
  if (drill.goal === 'win' && opts.myMate) return { done: true, success: true, message: 'Forced mate on the board — converted!' }
  if (drill.goal !== 'draw' && myWin !== undefined && myWin < 60) {
    return { done: true, success: false, message: 'The win slipped away — the engine now holds.' }
  }
  if (drill.goal === 'draw' && myWin !== undefined && myWin < 12) {
    return { done: true, success: false, message: 'That loses — the engine is winning now.' }
  }
  if (myMoves >= drill.moveLimit && chess.turn() === me) {
    return drill.goal === 'draw'
      ? { done: true, success: true, message: `Held for ${drill.moveLimit} moves — draw!` }
      : { done: true, success: false, message: `Out of moves (${drill.moveLimit}). Try a faster plan.` }
  }
  return { done: false }
}

/**
 * Endgames I should have won: from my reviewed games, the first endgame
 * position where I stood clearly winning (85–99%) but didn't win the game.
 */
export async function wonEndgamesFromGames(database: ChessDb, limit = 12): Promise<EndgameDrill[]> {
  await loadOpenings()
  const scanned = new Set(await database.scans.toCollection().primaryKeys())
  const games = (await database.games.orderBy('endTime').reverse().toArray()).filter(
    (g: GameRecord) => scanned.has(g.id) && g.outcome !== 'win',
  )
  const out: EndgameDrill[] = []
  for (const g of games) {
    if (out.length >= limit) break
    const stored = await database.pgns.get(g.id)
    if (!stored) continue
    try {
      const tree = MoveTree.fromPgn(stored.pgn)
      const line = tree.mainline()
      const fens = [tree.root.fen, ...line.map((n) => n.fen)]
      const moves = line.map((n) => ({ san: n.move!.san, uci: n.move!.uci }))
      const review = await database.reviews.get(reviewKey(tree.root.fen, moves.map((m) => m.uci)))
      if (!review || review.evals.length !== fens.length) continue
      const reviewed = reviewGame(fens, moves, review.evals, isBookPosition)
      const spot = reviewed.moves.find(
        (m) => m.color === g.userColor && m.winBefore >= 85 && m.winBefore <= 99 && phaseOf(fens[m.index], m.index) === 'endgame',
      )
      if (!spot) continue
      const date = new Date(g.endTime).toLocaleDateString()
      out.push({
        id: `game:${g.id}:${spot.index}`,
        title: `vs ${opponentOf(g).name}`,
        fen: fens[spot.index],
        goal: 'win',
        moveLimit: 40,
        tip: `You were winning here (${Math.round(spot.winBefore)}%) but the game ended in a ${g.outcome}. Convert it against the engine.`,
        source: date,
      })
    } catch {
      /* skip unreadable games */
    }
  }
  return out
}

// ---------- Progress ----------

const PROGRESS_KEY = 'chess-trainer.endgames'

export interface DrillRecord {
  tries: number
  solved: number
  /** Fewest moves to solve. */
  best?: number
}

export function readDrillProgress(): Record<string, DrillRecord> {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function saveDrillResult(id: string, success: boolean, moves: number) {
  const all = readDrillProgress()
  const r = all[id] ?? { tries: 0, solved: 0 }
  all[id] = {
    tries: r.tries + 1,
    solved: r.solved + (success ? 1 : 0),
    best: success ? Math.min(r.best ?? Infinity, moves) : r.best,
  }
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(all))
  } catch {
    /* ignore */
  }
}

// ---------- One move of a drill ----------

/** Engine strength for the defending side: plenty for these endings. */
export const DRILL_NODES = 300_000

export interface DrillStep {
  /** Position after my move. */
  afterMine: string
  promoted: boolean
  captured: boolean
  /** The engine's answer, unless the drill ended first. */
  reply?: { uci: string; from: string; to: string; fen: string; captured: boolean }
  /** My winning chances after my move, by the engine. */
  myWin?: number
  verdict: DrillVerdict
}

/**
 * Plays my move (auto-queening), lets the engine judge and answer it, and
 * says whether the drill is over. Null for an illegal move.
 */
export async function playDrillMove(
  engine: Pick<StockfishEngine, 'search'>,
  drill: EndgameDrill,
  fen: string,
  myMoves: number,
  from: string,
  to: string,
): Promise<DrillStep | null> {
  const me = new Chess(fen).turn()
  const chess = new Chess(fen)
  const piece = chess.get(from as Square)
  const promotion = piece?.type === 'p' && (to[1] === '8' || to[1] === '1') ? 'q' : undefined
  let move
  try {
    move = chess.move({ from, to, promotion })
  } catch {
    return null
  }
  const afterMine = chess.fen()
  const base = { afterMine, promoted: !!move.promotion, captured: !!move.captured }
  const mine = myMoves + 1
  const quick = judgeDrill(drill, afterMine, me, mine)
  if (quick.done) return { ...base, verdict: quick }

  // The engine defends; its score also says how my position stands.
  const { bestmove, lines } = await engine.search(afterMine, { nodes: DRILL_NODES, multipv: 1 })
  const line = lines[0]
  const oppWhite = line ? winPercent(toWhiteEval(line, opposite(me))) : 50
  const myWin = me === 'w' ? oppWhite : 100 - oppWhite
  const verdict = judgeDrill(drill, afterMine, me, mine, { myWin, myMate: line?.mate !== undefined && line.mate < 0, promoted: base.promoted })
  if (verdict.done) return { ...base, myWin, verdict }

  const reply = new Chess(afterMine)
  const m = reply.move({ from: bestmove.slice(0, 2), to: bestmove.slice(2, 4), promotion: bestmove[4] })
  return {
    ...base,
    myWin,
    reply: { uci: bestmove, from: m.from, to: m.to, fen: reply.fen(), captured: !!m.captured },
    verdict: judgeDrill(drill, reply.fen(), me, mine),
  }
}
