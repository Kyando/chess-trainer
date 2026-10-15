import type { Color } from './types'

export interface TimeControl {
  /** Initial time per side, in seconds. */
  initial: number
  /** Increment added after each move, in seconds. */
  increment: number
}

/**
 * Chess clock driven by an injected time source, so it is deterministic in tests.
 * Only the side to move consumes time; `press` hands the turn to the other side.
 */
export class ChessClock {
  private remaining: Record<Color, number>
  private running: Color | null = null
  private startedAt = 0
  private readonly incrementMs: number
  private readonly now: () => number

  constructor(tc: TimeControl, now: () => number = () => performance.now()) {
    this.remaining = { w: tc.initial * 1000, b: tc.initial * 1000 }
    this.incrementMs = tc.increment * 1000
    this.now = now
  }

  /** Starts (or resumes) the clock for `color`. */
  start(color: Color) {
    this.settle()
    this.running = color
    this.startedAt = this.now()
  }

  /** The side to move finished its move: add increment and start the opponent's clock. */
  press(color: Color) {
    this.settle()
    this.remaining[color] += this.incrementMs
    this.running = color === 'w' ? 'b' : 'w'
    this.startedAt = this.now()
  }

  stop() {
    this.settle()
    this.running = null
  }

  /** Remaining milliseconds for `color`, never below zero. */
  timeLeft(color: Color): number {
    let ms = this.remaining[color]
    if (this.running === color) ms -= this.now() - this.startedAt
    return Math.max(0, ms)
  }

  /** The color whose time ran out, if any. */
  flagged(): Color | null {
    if (this.running && this.timeLeft(this.running) <= 0) return this.running
    return null
  }

  get activeColor(): Color | null {
    return this.running
  }

  private settle() {
    if (!this.running) return
    const t = this.now()
    this.remaining[this.running] -= t - this.startedAt
    this.startedAt = t
  }
}

export function formatClock(ms: number): string {
  const totalTenths = Math.floor(ms / 100)
  const totalSeconds = Math.floor(totalTenths / 10)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  // chess.com shows tenths of a second under 20s.
  if (ms < 20_000) return `${minutes}:${String(seconds).padStart(2, '0')}.${totalTenths % 10}`
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
