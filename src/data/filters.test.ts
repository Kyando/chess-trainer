import { describe, expect, it } from 'vitest'
import type { GameRecord } from './db'
import { DEFAULT_FILTERS, filterGames, formatTimeControl, gameStats } from './filters'

const g = (o: Partial<GameRecord>): GameRecord => ({
  id: Math.random().toString(),
  source: 'chesscom',
  white: { name: 'Me', result: 'win' },
  black: { name: 'Rival', result: 'resigned' },
  userColor: 'w',
  outcome: 'win',
  timeClass: 'blitz',
  timeControl: '300',
  rated: true,
  endTime: 0,
  plies: 40,
  opening: 'Italian Game',
  ...o,
})

describe('filters', () => {
  const games = [
    g({}),
    g({ outcome: 'loss', userColor: 'b', white: { name: 'Magnus', result: 'win' }, opening: 'Sicilian Defense' }),
    g({ outcome: 'draw', timeClass: 'rapid' }),
    g({ outcome: 'win', source: 'bot' }),
  ]

  it('filters by fields and search text', () => {
    expect(filterGames(games, DEFAULT_FILTERS)).toHaveLength(4)
    expect(filterGames(games, { ...DEFAULT_FILTERS, timeClass: 'blitz', source: 'chesscom' })).toHaveLength(2)
    expect(filterGames(games, { ...DEFAULT_FILTERS, color: 'b' })).toHaveLength(1)
    expect(filterGames(games, { ...DEFAULT_FILTERS, search: 'magnus' })).toHaveLength(1)
    expect(filterGames(games, { ...DEFAULT_FILTERS, search: 'sicilian' })).toHaveLength(1)
  })

  it('computes win/draw/loss stats', () => {
    expect(gameStats(games)).toMatchObject({ total: 4, wins: 2, draws: 1, losses: 1, winPct: 50 })
    expect(gameStats([]).winPct).toBe(0)
  })

  it('formats time controls', () => {
    expect(formatTimeControl('300')).toBe('5 min')
    expect(formatTimeControl('180+2')).toBe('3 | 2')
    expect(formatTimeControl('30')).toBe('30s')
    expect(formatTimeControl('1/86400')).toBe('Daily')
  })
})
