import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import { drillColor, judgeDrill, playDrillMove, STANDARD_DRILLS } from './endgames'

const drill = (id: string) => STANDARD_DRILLS.find((d) => d.id === id)!

describe('standard drills', () => {
  it('are legal positions with the trainee to move and not already over', () => {
    for (const d of STANDARD_DRILLS) {
      const chess = new Chess(d.fen)
      expect(chess.isGameOver(), d.id).toBe(false)
      expect(chess.moves().length, d.id).toBeGreaterThan(0)
    }
    expect(drillColor(drill('kpk-draw'))).toBe('b')
  })
})

describe('judgeDrill', () => {
  it('rewards checkmate and punishes stalemate when winning', () => {
    const kqk = drill('kqk')
    expect(judgeDrill(kqk, '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', 'w', 5)).toMatchObject({ done: true, success: false })
    expect(judgeDrill(kqk, '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1', 'w', 5)).toMatchObject({ done: true, success: true })
  })

  it('counts a stalemate as success when holding a draw', () => {
    expect(judgeDrill(drill('kpk-draw'), '4k3/4P3/4K3/8/8/8/8/8 b - - 0 1', 'b', 8)).toMatchObject({ done: true, success: true })
  })

  it('ends on the move limit, a lost win, or a safe promotion', () => {
    const krk = drill('krk')
    const quiet = '8/8/8/4k3/8/8/8/R3K3 w - - 0 1'
    expect(judgeDrill(krk, quiet, 'w', 30)).toMatchObject({ done: true, success: false })
    expect(judgeDrill(krk, quiet, 'w', 3, { myWin: 50 })).toMatchObject({ done: true, success: false })
    expect(judgeDrill(krk, quiet, 'w', 3, { myWin: 99 })).toEqual({ done: false })
    expect(judgeDrill(drill('kpk-win'), '4Q3/8/4K3/8/8/8/8/2k5 b - - 0 1', 'w', 4, { myWin: 100, promoted: true })).toMatchObject({ success: true })
    expect(judgeDrill(drill('philidor'), '3k4/8/7r/3PK3/8/8/8/R7 b - - 0 1', 'b', 20)).toMatchObject({ done: true, success: true })
  })
})

describe('playDrillMove', () => {
  const kqk = STANDARD_DRILLS.find((d) => d.id === 'kqk')!
  const engine = (bestmove: string, score: { cp?: number; mate?: number }) => ({
    search: async () => ({ bestmove, lines: [{ multipv: 1, depth: 10, pv: [bestmove], ...score }] }),
  })

  it('rejects illegal moves', async () => {
    expect(await playDrillMove(engine('e5e6', { mate: -7 }), kqk, kqk.fen, 0, 'd1', 'h4')).toBeNull()
  })

  it("plays the engine's reply and keeps going while winning", async () => {
    const step = await playDrillMove(engine('e5e6', { mate: -7 }), kqk, kqk.fen, 0, 'd1', 'd3')
    expect(step).toMatchObject({ myWin: 100, reply: { from: 'e5', to: 'e6' }, verdict: { done: false } })
  })

  it('ends on a stalemate without asking the engine', async () => {
    const fen = '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1'
    const step = await playDrillMove(engine('zzzz', {}), kqk, fen, 3, 'f1', 'f7')
    expect(step?.verdict).toMatchObject({ done: true, success: false })
    expect(step?.reply).toBeUndefined()
  })

  it('fails when the engine sees the win is gone', async () => {
    const step = await playDrillMove(engine('e5e4', { cp: 0 }), kqk, kqk.fen, 0, 'd1', 'd3')
    expect(step?.verdict).toMatchObject({ done: true, success: false })
  })
})
