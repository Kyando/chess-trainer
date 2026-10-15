import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadOpenings } from '../core/openings'
import { ChessDb } from '../data/db'
import { ChessComError, syncChessCom, toGameRecord, type ChessComGame } from './chesscom'

const PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[White "Me"]
[Black "Rival"]
[Result "1-0"]
[ECO "C50"]

1. e4 {[%clk 0:04:59.9]} 1... e5 {[%clk 0:04:58]} 2. Nf3 {[%clk 0:04:57]} 2... Nc6 {[%clk 0:04:55]} 3. Bc4 {[%clk 0:04:50]} 1-0`

function game(overrides: Partial<ChessComGame> = {}): ChessComGame {
  return {
    url: 'https://www.chess.com/game/live/1',
    uuid: 'u1',
    pgn: PGN,
    time_control: '300',
    time_class: 'blitz',
    end_time: 1_700_000_000,
    rated: true,
    rules: 'chess',
    white: { username: 'Me', rating: 840, result: 'win' },
    black: { username: 'Rival', rating: 830, result: 'resigned' },
    ...overrides,
  }
}

describe('toGameRecord', () => {
  beforeAll(async () => {
    await loadOpenings()
  })

  it('maps a game from the user’s point of view', () => {
    const r = toGameRecord(game(), 'me')!
    expect(r).toMatchObject({
      id: 'chesscom:u1',
      userColor: 'w',
      outcome: 'win',
      timeClass: 'blitz',
      plies: 5,
      endTime: 1_700_000_000_000,
    })
    expect(r.opening).toBe('Italian Game')
  })

  it('handles losses, draws and the black side', () => {
    const lost = toGameRecord(game({ white: { username: 'Rival', rating: 1, result: 'win' }, black: { username: 'ME', rating: 1, result: 'timeout' } }), 'me')!
    expect(lost).toMatchObject({ userColor: 'b', outcome: 'loss' })
    const drawn = toGameRecord(game({ white: { username: 'Me', rating: 1, result: 'repetition' } }), 'me')!
    expect(drawn.outcome).toBe('draw')
  })

  it('skips variants and other players’ games', () => {
    expect(toGameRecord(game({ rules: 'chess960' }), 'me')).toBeNull()
    expect(toGameRecord(game(), 'someone-else')).toBeNull()
  })
})

describe('syncChessCom', () => {
  function fakeFetch(calls: string[]) {
    const responses: Record<string, unknown> = {
      'https://api.chess.com/pub/player/me/games/archives': {
        archives: ['https://api.chess.com/pub/player/me/games/2026/09', 'https://api.chess.com/pub/player/me/games/2026/10'],
      },
      'https://api.chess.com/pub/player/me/games/2026/09': { games: [game({ uuid: 'a' }), game({ uuid: 'b' })] },
      'https://api.chess.com/pub/player/me/games/2026/10': { games: [game({ uuid: 'c' })] },
    }
    return (async (url: string) => {
      calls.push(url)
      const body = responses[url]
      return new Response(body ? JSON.stringify(body) : 'not found', { status: body ? 200 : 404 })
    }) as typeof fetch
  }

  it('imports all months, then only refetches the current one', async () => {
    const db = new ChessDb(`test-${Math.random()}`)
    const now = new Date('2026-10-15T12:00:00Z')
    const calls: string[] = []
    const first = await syncChessCom('Me', { db, fetchFn: fakeFetch(calls), now })
    expect(first).toMatchObject({ done: 2, total: 2, imported: 3 })
    expect(await db.games.count()).toBe(3)

    calls.length = 0
    const second = await syncChessCom('me', { db, fetchFn: fakeFetch(calls), now })
    expect(second.total).toBe(1)
    expect(calls.at(-1)).toContain('2026/10')
    expect(await db.games.count()).toBe(3)
  })

  it('reports unknown players', async () => {
    const db = new ChessDb(`test-${Math.random()}`)
    await expect(syncChessCom('nobody', { db, fetchFn: fakeFetch([]) })).rejects.toBeInstanceOf(ChessComError)
  })
})
