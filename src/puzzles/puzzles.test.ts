import { describe, expect, it } from 'vitest'
import { MoveTree } from '../core/tree'
import { reviewGame, type PositionEval } from '../review/review'
import { extractPuzzles } from './extract'
import { newSrs, schedule } from './srs'

const DAY = 86_400_000

describe('schedule', () => {
  it('grows intervals 1 → 3 → ~8 days on success', () => {
    let s = newSrs(0)
    s = schedule(s, 'good', 0)
    expect(s.interval).toBe(1)
    s = schedule(s, 'good', s.due)
    expect(s.interval).toBe(3)
    s = schedule(s, 'good', s.due)
    expect(s.interval).toBe(8)
    expect(s.reps).toBe(3)
  })

  it('a failure resets to learning, due again in minutes, and lowers ease', () => {
    let s = schedule(schedule(newSrs(0), 'good', 0), 'good', DAY)
    s = schedule(s, 'again', 5 * DAY)
    expect(s.interval).toBe(0)
    expect(s.reps).toBe(0)
    expect(s.lapses).toBe(1)
    expect(s.ease).toBeCloseTo(2.3)
    expect(s.due - 5 * DAY).toBeLessThan(DAY / 24)
  })

  it('hard grows slowly', () => {
    const s = schedule({ ...newSrs(0), interval: 10, reps: 3 }, 'hard', 0)
    expect(s.interval).toBe(12)
    expect(s.ease).toBeCloseTo(2.35)
  })
})

describe('extractPuzzles', () => {
  // 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6?? 4.Qxf7#
  const tree = MoveTree.fromMoves(['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'])
  const nodes = tree.mainline()
  const fens = [tree.root.fen, ...nodes.map((n) => n.fen)]
  const moves = nodes.map((n) => ({ san: n.move!.san, uci: n.move!.uci }))
  const ev = (cp: number, best?: string): PositionEval => ({ eval: { cp }, best, pv: best ? [best] : undefined })
  const evals: PositionEval[] = [
    ev(30, 'e2e4'),
    ev(30, 'e7e5'),
    ev(30, 'g1f3'),
    ev(0, 'b8c6'),
    ev(20, 'f1c4'),
    ev(0, 'g7g6'),
    { eval: { mate: 1 }, best: 'h5f7', pv: ['h5f7'] },
    { eval: { cp: 0 }, terminal: 'checkmate' },
  ]
  const review = reviewGame(fens, moves, evals)
  const meta = { gameId: 'g1', opponent: 'someone', endTime: 1, userColor: 'b' as const }

  it("makes a puzzle of the user's blunder, with the opponent's last move and themes", () => {
    const [p, ...rest] = extractPuzzles(review, fens, evals, meta, 100)
    expect(rest).toEqual([])
    expect(p).toMatchObject({
      id: 'g1:5',
      fen: fens[5],
      lastMove: ['f1', 'c4'],
      bestSan: 'g6',
      playedSan: 'Nf6',
      cls: 'blunder',
      themes: ['allowed-mate'],
      due: 100,
      reps: 0,
    })
  })

  it("ignores the opponent's errors", () => {
    expect(extractPuzzles(review, fens, evals, { ...meta, userColor: 'w' }, 100)).toEqual([])
  })
})
