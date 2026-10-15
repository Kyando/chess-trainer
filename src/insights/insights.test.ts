import { describe, expect, it } from 'vitest'
import { MoveTree, START_FEN } from '../core/tree'
import type { GameRecord, Outcome } from '../data/db'
import type { GameReview, ReviewedMove } from '../review/review'
import { errorsByClock, errorsByPhase, initialClockMs, moveSamples, openingFamily, openingStats, phaseOf, type MoveSample } from './insights'

const game = (opening: string, outcome: Outcome, userColor: 'w' | 'b' = 'w') =>
  ({ id: Math.random().toString(), opening, outcome, userColor }) as GameRecord

describe('openingStats', () => {
  it('groups by family and color and scores draws as half', () => {
    const rows = openingStats([
      game('Sicilian Defense: Najdorf Variation', 'win', 'b'),
      game('Sicilian Defense', 'draw', 'b'),
      game('Sicilian Defense', 'loss', 'w'),
      game('Italian Game', 'loss'),
    ])
    expect(rows[0]).toMatchObject({ name: 'Sicilian Defense', color: 'b', games: 2, wins: 1, draws: 1, score: 75 })
    expect(rows).toHaveLength(3)
    expect(openingFamily('Queen\'s Gambit Declined: Exchange')).toBe("Queen's Gambit Declined")
  })
})

describe('phaseOf', () => {
  it('splits opening, middlegame and endgame', () => {
    expect(phaseOf(START_FEN, 5)).toBe('opening')
    expect(phaseOf(START_FEN, 30)).toBe('middlegame')
    expect(phaseOf('4k3/8/8/8/8/8/4P3/R3K3 w - - 0 40', 80)).toBe('endgame')
    expect(phaseOf('r3k3/8/8/8/8/8/8/R3K3 w - - 0 5', 8)).toBe('endgame')
  })
})

describe('clocks', () => {
  it('reads the starting clock from the time control', () => {
    expect(initialClockMs('180+2')).toBe(180_000)
    expect(initialClockMs('1/86400')).toBeUndefined()
    expect(initialClockMs('-')).toBeUndefined()
  })

  it('takes the time I had before each of my moves from my previous clock comment', () => {
    const tree = MoveTree.fromPgn(
      '1. e4 {[%clk 0:02:59]} e5 {[%clk 0:02:58]} 2. Nf3 {[%clk 0:00:25]} Nc6 {[%clk 0:02:50]} 3. Bb5 {[%clk 0:00:08]} *',
    )
    const cls = (index: number): ReviewedMove => ({ index, color: index % 2 ? 'b' : 'w', cls: index === 4 ? 'blunder' : 'best' }) as ReviewedMove
    const review = { moves: [0, 1, 2, 3, 4].map(cls) } as GameReview
    const samples = moveSamples(tree, review, { userColor: 'w', timeControl: '180' })
    expect(samples.map((s) => s.clockMs)).toEqual([180_000, 179_000, 25_000])
    const byClock = errorsByClock(samples)
    expect(byClock.find((r) => r.label === '10–30 s')).toMatchObject({ moves: 1, blunders: 1, blunderRate: 100 })
    expect(byClock.find((r) => r.label === 'Over 2 min')?.moves).toBe(2)
  })
})

describe('errorsByPhase', () => {
  it('counts mistakes, misses and blunders per 100 moves', () => {
    const s = (cls: MoveSample['cls']): MoveSample => ({ phase: 'middlegame', cls })
    const [, middle] = errorsByPhase([s('best'), s('mistake'), s('miss'), s('blunder')])
    expect(middle).toMatchObject({ moves: 4, errors: 3, blunders: 1, errorRate: 75, blunderRate: 25 })
  })
})
