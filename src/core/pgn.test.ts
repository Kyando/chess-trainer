import { describe, expect, it } from 'vitest'
import { parseClock, pgnHeaders, pgnMainlineSans, stripCommands } from './pgn'

describe('pgn helpers', () => {
  const pgn = `[White "A"]
[Black "B \\"x\\""]

1. e4 {[%clk 0:04:59.9]} 1... e5 (1... c5 2. Nf3 (2. c3)) 2. Nf3! $1 Nc6?! ; comment
3. Bb5 1-0`

  it('extracts headers', () => {
    expect(pgnHeaders(pgn).White).toBe('A')
  })

  it('extracts main-line SAN moves', () => {
    expect(pgnMainlineSans(pgn)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'])
  })

  it('parses clocks and strips commands', () => {
    expect(parseClock('[%clk 0:04:59.9]')).toBe(299_900)
    expect(parseClock('[%clk 1:00:00]')).toBe(3_600_000)
    expect(parseClock('nothing')).toBeUndefined()
    expect(stripCommands('[%clk 0:01:00] good [%eval 0.3]')).toBe('good')
  })
})
