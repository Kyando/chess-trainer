import { describe, expect, it } from 'vitest'
import { detectMotifs } from './motifs'

describe('detectMotifs', () => {
  it('finds a knight fork of king and queen', () => {
    expect(detectMotifs('4k3/1q6/8/8/2N5/8/8/4K3 w - - 0 1', ['c4d6', 'e8d8', 'd6b7'], 'w')).toContain('fork')
  })

  it('finds a pin against the king', () => {
    expect(detectMotifs('4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1', ['f1b5'], 'w')).toEqual(['pin'])
  })

  it('finds a skewer that wins the queen behind the king', () => {
    expect(detectMotifs('4q3/8/8/8/4k3/8/8/K6R w - - 0 1', ['h1e1', 'e4d5', 'e1e8'], 'w')).toContain('skewer')
  })

  it('finds a back-rank mate', () => {
    expect(detectMotifs('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', ['a1a8'], 'w')).toContain('back-rank')
  })

  it('finds a discovered attack on the queen', () => {
    expect(detectMotifs('6k1/4q3/8/8/4N3/8/8/4R1K1 w - - 0 1', ['e4f6', 'g8h8', 'e1e7'], 'w')).toContain('discovered-attack')
  })

  it('stays quiet on a plain developing move', () => {
    expect(detectMotifs('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', ['g8f6', 'b1c3'], 'b')).toEqual([])
  })
})
