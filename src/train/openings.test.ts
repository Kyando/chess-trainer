import { describe, expect, it } from 'vitest'
import type { OpeningPosition } from '../data/db'
import { buildRepertoire, firstMoves, formatLine, frequentPositions, isLeak, usualMove } from './openings'

describe('firstMoves', () => {
  it('reads the first moves of a PGN, skipping headers, comments and variations', () => {
    const pgn = '[Event "x"]\n[White "a"]\n\n1. e4 {[%clk 0:05:00]} 1... e5 (1... c5 2. Nf3) 2. Nf3 $1 Nc6 3. Bb5 a6 1-0'
    expect(firstMoves(pgn, 5)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'])
    expect(firstMoves('1. d4 d5 *')).toEqual(['d4', 'd5'])
  })
})

describe('buildRepertoire', () => {
  const games = [
    { sans: ['e4', 'e5', 'Nf3', 'Nc6'], color: 'w' as const, outcome: 'win' as const },
    { sans: ['e4', 'e5', 'Bc4', 'Nf6'], color: 'w' as const, outcome: 'loss' as const },
    { sans: ['e4', 'c5', 'Nf3'], color: 'w' as const, outcome: 'draw' as const },
  ]

  it('counts my moves per position with my score', () => {
    const nodes = buildRepertoire(games)
    const [start, afterE5] = frequentPositions(nodes, 1)
    expect(start.count).toBe(3)
    expect(start.moves.get('e2e4')).toMatchObject({ san: 'e4', count: 3, points: 1.5 })
    expect(afterE5.line).toEqual(['e4', 'e5'])
    expect([...afterE5.moves.values()].map((m) => m.san).sort()).toEqual(['Bc4', 'Nf3'])
    // Only positions where it was my move.
    expect(nodes.size).toBe(3)
  })
})

describe('leaks', () => {
  const position = (moves: OpeningPosition['moves']) => ({ bestUci: 'g1f3', bestWin: 55, moves }) as OpeningPosition

  it('flags a usual move that loses enough win chance', () => {
    const leak = position([
      { uci: 'd1h5', san: 'Qh5', count: 9, score: 40, win: 44 },
      { uci: 'g1f3', san: 'Nf3', count: 2, score: 50, win: 55 },
    ])
    expect(isLeak(leak)).toBe(true)
    expect(usualMove(leak)?.loss).toBe(11)
    expect(isLeak(position([{ uci: 'b1c3', san: 'Nc3', count: 5, score: 60, win: 52 }]))).toBe(false)
  })

  it('formats lines with move numbers', () => {
    expect(formatLine(['e4', 'e5', 'Nf3'])).toBe('1.e4 e5 2.Nf3')
  })
})
