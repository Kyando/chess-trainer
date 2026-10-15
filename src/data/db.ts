import Dexie, { type EntityTable } from 'dexie'
import type { Puzzle } from '../puzzles/extract'
import type { PositionEval } from '../review/review'

export type GameSource = 'chesscom' | 'bot'
export type Outcome = 'win' | 'loss' | 'draw'
export type TimeClass = 'bullet' | 'blitz' | 'rapid' | 'daily'

export interface PlayerInfo {
  name: string
  rating?: number
  /** Source-specific result code, e.g. chess.com's "checkmated", "timeout". */
  result: string
}

/** One finished game, from chess.com or played here vs the bot. */
export interface GameRecord {
  /** "chesscom:<uuid>" or "bot:<timestamp>". */
  id: string
  source: GameSource
  url?: string
  white: PlayerInfo
  black: PlayerInfo
  /** Which side the user played. */
  userColor: 'w' | 'b'
  /** Result from the user's point of view. */
  outcome: Outcome
  timeClass: TimeClass
  /** e.g. "300", "180+2", "1/86400" (daily). */
  timeControl: string
  rated: boolean
  /** Epoch milliseconds when the game ended. */
  endTime: number
  eco?: string
  /** Opening name from the lichess table (most specific match). */
  opening?: string
  /** Number of half-moves. */
  plies: number
  /** chess.com accuracies, present when the game was reviewed there. */
  accuracies?: { white: number; black: number }
}

/** Full PGN of a game (kept apart so listing games stays light). */
export interface GamePgn {
  id: string
  /** Full PGN, including clock comments. */
  pgn: string
}

/** Per-month import bookkeeping, so re-syncs only fetch what changed. */
export interface ArchiveState {
  /** "<username>/<YYYY>/<MM>". */
  key: string
  username: string
  /** Months in the past never change again once fetched. */
  complete: boolean
  gameCount: number
  fetchedAt: number
}

/** Cached engine verdicts for a game's main line (Game Review). */
export interface StoredReview {
  /** Start FEN + main-line moves, see `reviewKey`. */
  key: string
  /** Engine node budget used per position. */
  nodes: number
  evals: PositionEval[]
  createdAt: number
}

/** Which games were already searched for puzzles. */
export interface ScanState {
  gameId: string
  scannedAt: number
  puzzles: number
  /** Set when the game could not be analysed (e.g. a broken PGN). */
  error?: string
}

export class ChessDb extends Dexie {
  games!: EntityTable<GameRecord, 'id'>
  pgns!: EntityTable<GamePgn, 'id'>
  archives!: EntityTable<ArchiveState, 'key'>
  reviews!: EntityTable<StoredReview, 'key'>
  puzzles!: EntityTable<Puzzle, 'id'>
  scans!: EntityTable<ScanState, 'gameId'>

  constructor(name = 'chess-trainer') {
    super(name)
    this.version(1).stores({
      games: 'id, source, endTime, timeClass, outcome, userColor, eco',
      pgns: 'id',
      archives: 'key, username',
    })
    this.version(2).stores({ reviews: 'key' })
    this.version(3).stores({ puzzles: 'id, gameId, due', scans: 'gameId' })
  }
}

export const db = new ChessDb()

/** Saves a game and its PGN together. */
export async function saveGames(database: ChessDb, games: { record: GameRecord; pgn: string }[]) {
  await database.transaction('rw', database.games, database.pgns, async () => {
    await database.games.bulkPut(games.map((g) => g.record))
    await database.pgns.bulkPut(games.map((g) => ({ id: g.record.id, pgn: g.pgn })))
  })
}
