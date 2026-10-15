/** Spaced repetition, SM-2 style: intervals grow by an ease factor on success. */
export interface SrsState {
  /** Epoch ms when the item is next due. */
  due: number
  /** Current interval in days (0 = still learning). */
  interval: number
  ease: number
  /** Successful reviews in a row. */
  reps: number
  lapses: number
  lastReview?: number
}

export type Grade = 'again' | 'hard' | 'good'

const MINUTE = 60_000
const DAY = 86_400_000
/** Interval after which an item counts as learned. */
export const MASTERED_DAYS = 21

export function newSrs(now: number): SrsState {
  return { due: now, interval: 0, ease: 2.5, reps: 0, lapses: 0 }
}

export function schedule(s: SrsState, grade: Grade, now: number): SrsState {
  if (grade === 'again') {
    return { ...s, interval: 0, reps: 0, lapses: s.lapses + 1, ease: Math.max(1.3, s.ease - 0.2), due: now + 10 * MINUTE, lastReview: now }
  }
  const interval =
    grade === 'hard'
      ? Math.max(1, Math.round(s.interval * 1.2))
      : s.reps === 0
        ? 1
        : s.reps === 1
          ? 3
          : Math.round(Math.max(s.interval, 1) * s.ease)
  const ease = grade === 'hard' ? Math.max(1.3, s.ease - 0.15) : s.ease
  return { ...s, interval, ease, reps: s.reps + 1, due: now + interval * DAY, lastReview: now }
}
