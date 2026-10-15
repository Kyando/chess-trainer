import { describe, expect, it } from 'vitest'
import { MoveTree } from '../core/tree'
import { gameAccuracy, moveAccuracy, reviewGame, type PositionEval } from './review'

/** Scholar's mate: 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6?? 4.Qxf7# */
function scholar(sans = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']) {
  const tree = MoveTree.fromMoves(sans)
  const nodes = tree.mainline()
  return {
    fens: [tree.root.fen, ...nodes.map((n) => n.fen)],
    moves: nodes.map((n) => ({ san: n.move!.san, uci: n.move!.uci })),
  }
}

const ev = (cp: number, best?: string, second?: number): PositionEval => ({
  eval: { cp },
  best,
  second: second === undefined ? undefined : { cp: second },
})

describe('reviewGame', () => {
  it('classifies book, best, good, blunder and the mating move', () => {
    const { fens, moves } = scholar()
    const evals = [
      ev(30, 'e2e4'),
      ev(30, 'e7e5'),
      ev(30, 'g1f3'),
      ev(0, 'b8c6'),
      ev(20, 'f1c4'),
      ev(0, 'g7g6'),
      { eval: { mate: 1 }, best: 'h5f7' },
      { eval: { cp: 0 }, terminal: 'checkmate' as const },
    ]
    const bookFens = new Set(fens.slice(1, 3))
    const r = reviewGame(fens, moves, evals, (f) => bookFens.has(f))
    expect(r.moves.map((m) => m.cls)).toEqual(['book', 'book', 'good', 'best', 'best', 'blunder', 'best'])
    expect(r.moves[5].bestSan).toBe('g6')
    expect(r.moves[6].bestSan).toBeUndefined()
    expect(r.whiteWin.at(-1)).toBe(100)
    expect(r.counts.b.blunder).toBe(1)
    expect(r.accuracy.w!).toBeGreaterThan(r.accuracy.b!)
  })

  it('marks an only move as great', () => {
    const { fens, moves } = scholar(['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'g6'])
    const evals = [ev(30), ev(30), ev(30), ev(0), ev(20), ev(0, 'g7g6', 500), ev(0)]
    expect(reviewGame(fens, moves, evals).moves[5].cls).toBe('great')
  })

  it('calls a reply that hands back an opponent blunder a miss', () => {
    const { fens, moves } = scholar(['e4', 'e5', 'Qh5', 'Nc6'])
    const evals = [ev(30), ev(30), ev(30, 'g1f3'), ev(-600, 'g7g6'), ev(30)]
    const r = reviewGame(fens, moves, evals)
    expect(r.moves[2].cls).toBe('blunder')
    expect(r.moves[3].cls).toBe('miss')
  })
})

describe('accuracy', () => {
  it('is 100 for a perfect move and drops steeply with loss', () => {
    expect(moveAccuracy(0)).toBeCloseTo(100, 0)
    expect(moveAccuracy(10)).toBeLessThan(70)
    expect(moveAccuracy(50)).toBeLessThan(10)
  })

  it('a single blunder pulls game accuracy well below the average', () => {
    const whiteWin = [50, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10]
    const moves = whiteWin.slice(1).map((_, i) => ({ color: i % 2 === 0 ? ('w' as const) : ('b' as const), accuracy: i === 8 ? 5 : 100 }))
    const acc = gameAccuracy(whiteWin, moves, 'w')!
    expect(acc).toBeLessThan(75)
    expect(gameAccuracy(whiteWin, moves, 'b')).toBeCloseTo(100, 0)
  })
})
