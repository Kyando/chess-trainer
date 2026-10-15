import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import { ChessClock, formatClock } from './clock'
import { GameSession, hasMatingMaterial } from './game'
import { materialSummary } from './material'

function fakeTime() {
  let t = 0
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

describe('ChessClock', () => {
  it('only runs the active side and adds increment on press', () => {
    const time = fakeTime()
    const clock = new ChessClock({ initial: 60, increment: 2 }, time.now)
    clock.start('w')
    time.advance(5000)
    clock.press('w')
    expect(clock.timeLeft('w')).toBe(57_000)
    time.advance(1000)
    expect(clock.timeLeft('b')).toBe(59_000)
    expect(clock.timeLeft('w')).toBe(57_000)
  })

  it('flags at zero', () => {
    const time = fakeTime()
    const clock = new ChessClock({ initial: 1, increment: 0 }, time.now)
    clock.start('b')
    time.advance(1500)
    expect(clock.flagged()).toBe('b')
    expect(clock.timeLeft('b')).toBe(0)
  })

  it('formats like chess.com', () => {
    expect(formatClock(300_000)).toBe('5:00')
    expect(formatClock(65_400)).toBe('1:05')
    expect(formatClock(9_870)).toBe('0:09.8')
  })
})

describe('GameSession', () => {
  it('detects checkmate (fool’s mate)', () => {
    const g = new GameSession({ timeControl: null })
    for (const [from, to] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) g.move({ from, to })
    expect(g.result).toEqual({ winner: 'b', reason: 'checkmate' })
    expect(g.move({ from: 'e2', to: 'e4' })).toBeNull()
  })

  it('rejects illegal moves', () => {
    const g = new GameSession({ timeControl: null })
    expect(g.move({ from: 'e2', to: 'e5' })).toBeNull()
    expect(g.history).toHaveLength(0)
  })

  it('starts the clock after White’s first move', () => {
    const time = fakeTime()
    const g = new GameSession({ timeControl: { initial: 60, increment: 0 }, now: time.now })
    time.advance(10_000)
    g.move({ from: 'e2', to: 'e4' })
    expect(g.clock!.timeLeft('w')).toBe(60_000)
    time.advance(3000)
    expect(g.clock!.timeLeft('b')).toBe(57_000)
  })

  it('wins on time, or draws when the winner cannot mate', () => {
    const time = fakeTime()
    const g = new GameSession({ timeControl: { initial: 1, increment: 0 }, now: time.now })
    g.move({ from: 'e2', to: 'e4' })
    time.advance(2000)
    expect(g.checkFlag()).toBe(true)
    expect(g.result).toEqual({ winner: 'w', reason: 'timeout' })

    // Black flags, but White has a lone king: draw.
    const bare = new GameSession({ timeControl: { initial: 1, increment: 0 }, now: time.now, startFen: '7r/8/8/4k3/8/8/8/4K3 w - - 0 1' })
    bare.move({ from: 'e1', to: 'e2' })
    time.advance(2000)
    bare.checkFlag()
    expect(bare.result).toEqual({ winner: null, reason: 'timeout-vs-insufficient' })
  })

  it('promotes with the chosen piece and undoes moves', () => {
    const g = new GameSession({ timeControl: null, startFen: '8/P6p/8/8/8/8/8/k6K w - - 0 1' })
    expect(g.isPromotion('a7', 'a8')).toBe(true)
    g.move({ from: 'a7', to: 'a8', promotion: 'n' })
    expect(g.chess.get('a8')).toEqual({ type: 'n', color: 'w' })
    g.undo(1)
    expect(g.history).toHaveLength(0)
  })

  it('resignation ends the game', () => {
    const g = new GameSession({ timeControl: null })
    g.resign('w')
    expect(g.result).toEqual({ winner: 'b', reason: 'resign' })
    expect(g.pgn()).toContain('0-1')
  })
})

describe('material', () => {
  it('knows when a side cannot mate', () => {
    expect(hasMatingMaterial(new Chess('8/8/8/4k3/8/8/8/4K2N w - - 0 1'), 'w')).toBe(false)
    expect(hasMatingMaterial(new Chess('8/8/8/4k3/8/8/8/4KB1N w - - 0 1'), 'w')).toBe(true)
  })

  it('summarizes captures and the material lead', () => {
    const c = new Chess()
    for (const m of ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5']) c.move(m)
    const s = materialSummary(c)
    expect(s.captured.w).toBe('♟')
    expect(s.captured.b).toBe('♙')
    expect(s.lead).toEqual({ w: 0, b: 0 })
  })
})
