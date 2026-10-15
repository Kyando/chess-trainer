import { detectOpening, loadOpenings } from '../core/openings'
import { pgnHeaders, pgnMainlineSans } from '../core/pgn'
import { saveGames, type ChessDb, type GameRecord, type Outcome, type TimeClass } from '../data/db'

/** chess.com Published-Data API (no auth, CORS-enabled). */
const API = 'https://api.chess.com/pub/player'

/** The fields we use from a game in a monthly archive. */
export interface ChessComGame {
  url: string
  uuid: string
  pgn?: string
  time_control: string
  time_class: string
  end_time: number
  rated: boolean
  rules: string
  white: { username: string; rating: number; result: string }
  black: { username: string; rating: number; result: string }
  accuracies?: { white: number; black: number }
}

const DRAW_RESULTS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'])
const TIME_CLASSES = new Set<TimeClass>(['bullet', 'blitz', 'rapid', 'daily'])

/** Converts a chess.com game into our record; null for variants or games without moves. */
export function toGameRecord(g: ChessComGame, username: string): GameRecord | null {
  if (g.rules !== 'chess' || !g.pgn || !TIME_CLASSES.has(g.time_class as TimeClass)) return null
  const user = username.toLowerCase()
  const userColor = g.white.username.toLowerCase() === user ? 'w' : g.black.username.toLowerCase() === user ? 'b' : null
  if (!userColor) return null

  const me = userColor === 'w' ? g.white : g.black
  const outcome: Outcome = me.result === 'win' ? 'win' : DRAW_RESULTS.has(me.result) ? 'draw' : 'loss'
  const sans = pgnMainlineSans(g.pgn)
  const opening = detectOpening(sans)

  return {
    id: `chesscom:${g.uuid}`,
    source: 'chesscom',
    url: g.url,
    white: { name: g.white.username, rating: g.white.rating, result: g.white.result },
    black: { name: g.black.username, rating: g.black.rating, result: g.black.result },
    userColor,
    outcome,
    timeClass: g.time_class as TimeClass,
    timeControl: g.time_control,
    rated: g.rated,
    endTime: g.end_time * 1000,
    eco: opening?.eco ?? pgnHeaders(g.pgn).ECO,
    opening: opening?.name,
    plies: sans.length,
    accuracies: g.accuracies,
  }
}

export interface SyncProgress {
  /** Archive months processed so far / to process in this sync. */
  done: number
  total: number
  /** "YYYY/MM" being fetched. */
  month?: string
  imported: number
}

export interface SyncOptions {
  db: ChessDb
  onProgress?: (p: SyncProgress) => void
  signal?: AbortSignal
  fetchFn?: typeof fetch
  /** Injectable "now" for tests. */
  now?: Date
}

export class ChessComError extends Error {}

async function getJson<T>(url: string, fetchFn: typeof fetch, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(url, { signal })
    if (res.status === 429 && attempt < 3) {
      // Rate limited: back off and retry.
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
      continue
    }
    if (res.status === 404) throw new ChessComError('chess.com player not found')
    if (!res.ok) throw new ChessComError(`chess.com request failed (${res.status})`)
    return (await res.json()) as T
  }
}

const monthOf = (archiveUrl: string) => archiveUrl.split('/games/')[1] // "YYYY/MM"

/**
 * Imports all of a player's games into the local database. Months that ended
 * before the last sync are skipped, so re-syncing only fetches recent games.
 * Requests run one at a time, as chess.com asks.
 */
export async function syncChessCom(username: string, opts: SyncOptions): Promise<SyncProgress> {
  const { db, onProgress, signal } = opts
  const fetchFn = opts.fetchFn ?? fetch.bind(globalThis)
  const user = username.trim().toLowerCase()
  if (!user) throw new ChessComError('Enter a chess.com username')

  await loadOpenings()
  const { archives } = await getJson<{ archives: string[] }>(`${API}/${encodeURIComponent(user)}/games/archives`, fetchFn, signal)

  const known = new Map((await db.archives.where('username').equals(user).toArray()).map((a) => [a.key, a]))
  const todo = archives.filter((url) => !known.get(`${user}/${monthOf(url)}`)?.complete)
  const now = opts.now ?? new Date()
  const currentMonth = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`

  const progress: SyncProgress = { done: 0, total: todo.length, imported: 0 }
  onProgress?.({ ...progress })
  for (const url of todo) {
    signal?.throwIfAborted()
    const month = monthOf(url)
    onProgress?.({ ...progress, month })
    const { games } = await getJson<{ games: ChessComGame[] }>(url, fetchFn, signal)
    const records = games.flatMap((g) => {
      const record = toGameRecord(g, user)
      return record ? [{ record, pgn: g.pgn! }] : []
    })
    await db.transaction('rw', db.games, db.pgns, db.archives, async () => {
      await saveGames(db, records)
      await db.archives.put({
        key: `${user}/${month}`,
        username: user,
        complete: month < currentMonth,
        gameCount: records.length,
        fetchedAt: now.getTime(),
      })
    })
    progress.done++
    progress.imported += records.length
    onProgress?.({ ...progress })
  }
  return progress
}
