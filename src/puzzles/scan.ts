import { isBookPosition, loadOpenings } from '../core/openings'
import { MoveTree } from '../core/tree'
import type { ChessDb, GameRecord } from '../data/db'
import { opponentOf } from '../data/filters'
import type { StockfishEngine } from '../engine/stockfish'
import { reviewGame } from '../review/review'
import { evaluatePositions, reviewKey } from '../review/runner'
import { extractPuzzles } from './extract'

/**
 * Engine work per position when scanning many games: half a full review, still
 * far more than needed to spot an 800-level blunder. Answers are re-checked at
 * full strength while solving.
 */
export const SCAN_NODES = 100_000

/** Shortest games worth scanning (in half-moves). */
const MIN_PLIES = 10

/** Games not scanned yet, newest first. */
export async function unscannedGames(database: ChessDb): Promise<GameRecord[]> {
  const scanned = new Set(await database.scans.toCollection().primaryKeys())
  const games = await database.games.orderBy('endTime').reverse().toArray()
  return games.filter((g) => !scanned.has(g.id) && g.plies >= MIN_PLIES)
}

/**
 * Reviews one game (reusing a cached Game Review when there is one), stores
 * the review, and adds puzzles for my errors. Returns how many were new.
 */
export async function scanGame(
  engine: StockfishEngine,
  database: ChessDb,
  game: GameRecord,
  opts: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<number> {
  const stored = await database.pgns.get(game.id)
  if (!stored) throw new Error('PGN missing')
  const tree = MoveTree.fromPgn(stored.pgn)
  const line = tree.mainline()
  const fens = [tree.root.fen, ...line.map((n) => n.fen)]
  const moves = line.map((n) => ({ san: n.move!.san, uci: n.move!.uci }))
  const key = reviewKey(tree.root.fen, moves.map((m) => m.uci))

  let evals = (await database.reviews.get(key))?.evals
  if (!evals || evals.length !== fens.length) {
    evals = await evaluatePositions(engine, fens, {
      nodes: SCAN_NODES,
      signal: opts.signal,
      onProgress: (done, total) => opts.onProgress?.(done / total),
    })
    await database.reviews.put({ key, nodes: SCAN_NODES, evals, createdAt: Date.now() })
  }

  await loadOpenings()
  const review = reviewGame(fens, moves, evals, isBookPosition)
  const puzzles = extractPuzzles(
    review,
    fens,
    evals,
    { gameId: game.id, userColor: game.userColor, opponent: opponentOf(game).name, endTime: game.endTime, timeClass: game.timeClass },
    Date.now(),
  )
  let added = 0
  await database.transaction('rw', database.puzzles, database.scans, async () => {
    // Re-scanning never resets the schedule of puzzles already being learned.
    const existing = new Set(await database.puzzles.where('gameId').equals(game.id).primaryKeys())
    const fresh = puzzles.filter((p) => !existing.has(p.id))
    added = fresh.length
    await database.puzzles.bulkPut(fresh)
    await database.scans.put({ gameId: game.id, scannedAt: Date.now(), puzzles: puzzles.length })
  })
  return added
}
