import { Chess } from 'chess.js'
import raw from '../../public/puzzles/lichess.json?raw'
import { describe, expect, it } from 'vitest'
import type { TacticProgress } from '../data/db'
import { pickTactics, recordAttempt, TACTIC_THEMES, updateRating, type LichessPuzzle } from './lichess'
import { solutionSan } from './useLinePuzzle'

const puzzle = (id: string, rating: number, themes = ['fork']): LichessPuzzle => ({ id, fen: '', moves: [], rating, themes })

describe('tactics rating', () => {
  it('moves up on a solve and down on a miss, more against harder puzzles', () => {
    expect(updateRating(800, 800, 1)).toBe(812)
    expect(updateRating(800, 800, 0)).toBe(788)
    expect(updateRating(800, 1200, 1)).toBeGreaterThan(820)
  })
})

describe('pickTactics', () => {
  const all = [puzzle('a', 700), puzzle('b', 820), puzzle('c', 1500), puzzle('d', 900, ['pin'])]
  const noRandom = () => 0

  it('serves due reviews first, then unseen puzzles near my rating', () => {
    const progress = new Map([['c', { id: 'c', due: 5 } as TacticProgress]])
    const picked = pickTactics(all, progress, { themes: null, rating: 800, size: 3, now: 10, random: noRandom })
    expect(picked.map((p) => p.id)).toEqual(['c', 'b', 'a'])
  })

  it('filters by theme', () => {
    const picked = pickTactics(all, new Map(), { themes: ['pin'], rating: 800, size: 5, now: 0, random: noRandom })
    expect(picked.map((p) => p.id)).toEqual(['d'])
  })
})

describe('recordAttempt', () => {
  it('retires a clean first solve and brings failures back soon', () => {
    const p = puzzle('x', 900)
    expect(recordAttempt(undefined, p, 'clean', 0).interval).toBeGreaterThan(21)
    const failed = recordAttempt(undefined, p, 'shown', 0)
    expect(failed).toMatchObject({ attempts: 1, failures: 1, interval: 0 })
    expect(failed.due).toBe(10 * 60_000)
  })
})

describe('bundled lichess puzzles', () => {
  const rows: [string, string, string, number, string][] = JSON.parse(raw)

  it('covers every theme with legal solution lines', () => {
    for (const { tag } of TACTIC_THEMES) expect(rows.some((r) => r[4].split(' ').includes(tag)), tag).toBe(true)
    for (const [id, fen, moves] of rows.slice(0, 200)) {
      const chess = new Chess(fen)
      for (const u of moves.split(' ')) expect(() => chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }), id).not.toThrow()
    }
  })

  it('writes the solution in SAN', () => {
    expect(solutionSan({ fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 b - - 0 1', moves: ['g8h8', 'a1a8'] }, 1)).toBe('Ra8#')
  })
})
