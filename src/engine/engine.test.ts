import { describe, expect, it } from 'vitest'
import { BOT_LEVELS, botLevel, pickMove } from './bot'
import { parseInfo, scoreValue, uciToIntent, type EngineLine } from './uci'

describe('parseInfo', () => {
  it('parses a scored multipv line', () => {
    const l = parseInfo('info depth 12 seldepth 18 multipv 2 score cp -35 nodes 1000 nps 5000 pv e7e5 g1f3 b8c6')
    expect(l).toEqual({ depth: 12, multipv: 2, cp: -35, pv: ['e7e5', 'g1f3', 'b8c6'] })
  })

  it('parses mate scores and ignores non-pv lines', () => {
    expect(parseInfo('info depth 5 score mate -3 pv a1a2')?.mate).toBe(-3)
    expect(parseInfo('info string NNUE evaluation enabled')).toBeNull()
    expect(parseInfo('bestmove e2e4')).toBeNull()
  })
})

describe('scoreValue', () => {
  it('ranks faster mates above slower ones and above any cp', () => {
    expect(scoreValue({ mate: 1 })).toBeGreaterThan(scoreValue({ mate: 3 }))
    expect(scoreValue({ mate: 5 })).toBeGreaterThan(scoreValue({ cp: 2000 }))
    expect(scoreValue({ mate: -1 })).toBeLessThan(scoreValue({ mate: -4 }))
  })
})

describe('pickMove', () => {
  const lines: EngineLine[] = [
    { multipv: 1, depth: 4, cp: 50, pv: ['e2e4'] },
    { multipv: 2, depth: 4, cp: 30, pv: ['d2d4'] },
    { multipv: 3, depth: 4, cp: -400, pv: ['f2f3'] },
  ]

  it('the strongest level always plays the best move', () => {
    expect(pickMove(lines, botLevel(9))).toBe('e2e4')
  })

  it('weak levels sometimes play worse moves, strong ones rarely blunder', () => {
    let seed = 1
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const count = (level: number) => {
      let bad = 0
      for (let i = 0; i < 2000; i++) if (pickMove(lines, botLevel(level), rand) === 'f2f3') bad++
      return bad
    }
    expect(count(1)).toBeGreaterThan(count(5))
    expect(count(7)).toBe(0)
  })

  it('takes a short forced mate', () => {
    const mating: EngineLine[] = [
      { multipv: 1, depth: 2, mate: 1, pv: ['d8h4'] },
      { multipv: 2, depth: 2, cp: 0, pv: ['a7a6'] },
    ]
    expect(pickMove(mating, BOT_LEVELS[0], () => 0)).toBe('d8h4')
  })
})

it('converts UCI to move intents', () => {
  expect(uciToIntent('e7e8q')).toEqual({ from: 'e7', to: 'e8', promotion: 'q' })
  expect(uciToIntent('g1f3').promotion).toBeUndefined()
})
