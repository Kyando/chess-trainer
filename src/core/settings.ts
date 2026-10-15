import type { TimeControl } from './clock'

export interface GameSettings {
  timeControl: TimeControl | null
  /** 'random' is resolved to a color when the game starts. */
  color: 'w' | 'b' | 'random'
  botLevel: number
}

export const TIME_CONTROLS: { label: string; group: string; tc: TimeControl | null }[] = [
  { label: '1 min', group: 'Bullet', tc: { initial: 60, increment: 0 } },
  { label: '2 | 1', group: 'Bullet', tc: { initial: 120, increment: 1 } },
  { label: '3 min', group: 'Blitz', tc: { initial: 180, increment: 0 } },
  { label: '3 | 2', group: 'Blitz', tc: { initial: 180, increment: 2 } },
  { label: '5 min', group: 'Blitz', tc: { initial: 300, increment: 0 } },
  { label: '10 min', group: 'Rapid', tc: { initial: 600, increment: 0 } },
  { label: '15 | 10', group: 'Rapid', tc: { initial: 900, increment: 10 } },
  { label: 'No clock', group: 'Practice', tc: null },
]

export const sameTimeControl = (a: TimeControl | null, b: TimeControl | null) =>
  a === b || (!!a && !!b && a.initial === b.initial && a.increment === b.increment)
