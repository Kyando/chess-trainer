import { isBookPosition, loadOpenings } from '../core/openings'
import { MoveTree } from '../core/tree'
import type { ChessDb, GameRecord } from '../data/db'
import { reviewGame } from '../review/review'
import { reviewKey } from '../review/runner'
import { moveSamples, type MoveSample } from './insights'

/** Samples per game id; reviews never change, so this lives for the session. */
const cache = new Map<string, MoveSample[] | null>()

/**
 * My reviewed moves across `games`, from the engine evaluations stored by the
 * puzzle scanner (and Game Review). Games without a stored review are skipped.
 */
export async function loadMoveSamples(
  database: ChessDb,
  games: GameRecord[],
): Promise<{ samples: MoveSample[]; reviewed: number }> {
  await loadOpenings()
  const scanned = new Set(await database.scans.toCollection().primaryKeys())
  const samples: MoveSample[] = []
  let reviewed = 0
  for (const game of games) {
    if (!scanned.has(game.id)) continue
    let mine = cache.get(game.id)
    if (mine === undefined) {
      mine = await samplesOf(database, game)
      cache.set(game.id, mine)
    }
    if (!mine) continue
    reviewed++
    samples.push(...mine)
  }
  return { samples, reviewed }
}

async function samplesOf(database: ChessDb, game: GameRecord): Promise<MoveSample[] | null> {
  const stored = await database.pgns.get(game.id)
  if (!stored) return null
  try {
    const tree = MoveTree.fromPgn(stored.pgn)
    const line = tree.mainline()
    const fens = [tree.root.fen, ...line.map((n) => n.fen)]
    const moves = line.map((n) => ({ san: n.move!.san, uci: n.move!.uci }))
    const review = await database.reviews.get(reviewKey(tree.root.fen, moves.map((m) => m.uci)))
    if (!review || review.evals.length !== fens.length) return null
    return moveSamples(tree, reviewGame(fens, moves, review.evals, isBookPosition), game)
  } catch {
    return null
  }
}
