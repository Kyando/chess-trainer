import { describe, expect, it } from 'vitest'
import { MoveTree } from '../core/tree'
import type { StockfishEngine } from './stockfish'
import { describeThreat, findThreats, judgeThreat, nullMoveFen, threatDests, type ThreatAnalysis } from './threat'

// 1.e4 e5 2.Qh5 Nc6 3.Bc4 — Black to move, White threatens Qxf7#.
const FEN = MoveTree.fromMoves(['e4', 'e5', 'Qh5', 'Nc6', 'Bc4']).mainline().at(-1)!.fen
const PASSED = nullMoveFen(FEN)!

function fakeEngine(): StockfishEngine {
  return {
    search: async (fen: string) =>
      fen === PASSED
        ? {
            bestmove: 'h5f7',
            lines: [
              { multipv: 1, depth: 10, mate: 1, pv: ['h5f7'] },
              { multipv: 2, depth: 10, cp: 600, pv: ['h5e5', 'f8e7', 'e5g7'] },
              { multipv: 3, depth: 10, cp: 40, pv: ['g1f3'] },
            ],
          }
        : { bestmove: 'g7g6', lines: [{ multipv: 1, depth: 10, cp: -20, pv: ['g7g6'] }] },
  } as unknown as StockfishEngine
}

describe('nullMoveFen', () => {
  it('hands the move to the other side and clears en passant', () => {
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2'
    expect(nullMoveFen(fen)).toBe('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2')
  })

  it('is impossible in check', () => {
    expect(nullMoveFen('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3')).toBeNull()
  })

  it("gives the opponent's moves as dests", () => {
    expect(threatDests(FEN).get('h5')).toContain('f7')
  })
})

describe('findThreats', () => {
  it('finds the mate and the material threat, not the quiet move', async () => {
    const analysis = await findThreats(fakeEngine(), FEN)
    expect(analysis.threats.map((t) => t.san)).toEqual(['Qxf7#', 'Qxe5+'])
    expect(analysis.threats[0].mate).toBe(1)
    expect(analysis.threats[1].material).toBeGreaterThanOrEqual(1)
    expect(describeThreat(analysis.threats[0])).toBe('Qxf7# is checkmate')
  })

  it('still sees a piece threat when the game is already lopsided', async () => {
    const engine = {
      search: async (fen: string) =>
        fen === PASSED
          ? { bestmove: 'h5e5', lines: [{ multipv: 1, depth: 10, cp: 1200, pv: ['h5e5'] }] }
          : { bestmove: 'g7g6', lines: [{ multipv: 1, depth: 10, cp: -850, pv: ['g7g6'] }] },
    } as unknown as StockfishEngine
    const analysis = await findThreats(engine, FEN)
    expect(analysis.threats.map((t) => t.san)).toEqual(['Qxe5+'])
    expect(analysis.threats[0].gain).toBeLessThan(10)
  })
})

describe('judgeThreat', () => {
  const threat = { uci: 'h5f7', san: 'Qxf7#', gain: 50, mate: 1, material: 1 }
  const withThreat: ThreatAnalysis = { fen: FEN, threats: [threat], baseline: 50, baselineScore: 0 }
  const quiet: ThreatAnalysis = { fen: FEN, threats: [], baseline: 50, baselineScore: 0 }

  it('accepts the threat, or another capture on the same square', () => {
    expect(judgeThreat(withThreat, 'h5f7')).toBe('spotted')
    expect(judgeThreat(withThreat, 'c4f7')).toBe('spotted')
  })

  it('accepts another move the engine finds dangerous', () => {
    expect(judgeThreat(withThreat, 'h5e5', true)).toBe('spotted')
  })

  it('flags missed threats and false alarms', () => {
    expect(judgeThreat(withThreat, null)).toBe('missed')
    expect(judgeThreat(withThreat, 'g1f3', false)).toBe('missed')
    expect(judgeThreat(quiet, null)).toBe('calm')
    expect(judgeThreat(quiet, 'g1f3', false)).toBe('false-alarm')
  })
})
