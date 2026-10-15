import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { MoveTree } from '../core/tree'
import { ChessDb, saveGames, type GameRecord } from '../data/db'
import type { StockfishEngine } from '../engine/stockfish'
import { scanGame, unscannedGames } from './scan'

const PGN = '[White "Rival"]\n[Black "Me"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0'

/** Engine stub: level everywhere, except that Nf6 allows mate and g6 was best. */
function fakeEngine(): StockfishEngine {
  const fens = [MoveTree.fromPgn(PGN).root, ...MoveTree.fromPgn(PGN).mainline()].map((n) => n.fen)
  return {
    newGame: async () => {},
    search: async (fen: string) => {
      if (fen === fens[6]) return { bestmove: 'h5f7', lines: [{ multipv: 1, depth: 10, mate: 1, pv: ['h5f7'] }] }
      const best = fen === fens[5] ? 'g7g6' : 'a2a3'
      return { bestmove: best, lines: [{ multipv: 1, depth: 10, cp: 0, pv: [best] }] }
    },
  } as unknown as StockfishEngine
}

const record: GameRecord = {
  id: 'chesscom:1',
  source: 'chesscom',
  white: { name: 'Rival', result: 'win' },
  black: { name: 'Me', result: 'checkmated' },
  userColor: 'b',
  outcome: 'loss',
  timeClass: 'blitz',
  timeControl: '300',
  rated: true,
  endTime: 1,
  plies: 12,
}

describe('scanGame', () => {
  it('stores puzzles for my errors, marks the game scanned and keeps progress on rescans', async () => {
    const db = new ChessDb(`scan-${Math.random()}`)
    await saveGames(db, [{ record, pgn: PGN }])
    expect((await unscannedGames(db)).map((g) => g.id)).toEqual(['chesscom:1'])

    expect(await scanGame(fakeEngine(), db, record)).toBe(1)
    const [puzzle] = await db.puzzles.toArray()
    expect(puzzle).toMatchObject({ id: 'chesscom:1:5', playedSan: 'Nf6', bestSan: 'g6', opponent: 'Rival', color: 'b' })
    expect(await unscannedGames(db)).toEqual([])
    expect(await db.reviews.count()).toBe(1)

    await db.puzzles.update(puzzle.id, { reps: 2, interval: 3 })
    expect(await scanGame(fakeEngine(), db, record)).toBe(0)
    expect((await db.puzzles.get(puzzle.id))?.reps).toBe(2)
  })
})
