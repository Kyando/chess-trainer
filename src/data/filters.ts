import type { GameRecord, Outcome, TimeClass } from './db'

export interface GameFilters {
  timeClass: TimeClass | 'all'
  color: 'w' | 'b' | 'all'
  outcome: Outcome | 'all'
  source: 'chesscom' | 'bot' | 'all'
  /** Matches opponent name or opening, case-insensitive. */
  search: string
}

export const DEFAULT_FILTERS: GameFilters = { timeClass: 'all', color: 'all', outcome: 'all', source: 'all', search: '' }

export function opponentOf(g: GameRecord) {
  return g.userColor === 'w' ? g.black : g.white
}

export function userOf(g: GameRecord) {
  return g.userColor === 'w' ? g.white : g.black
}

export function filterGames(games: GameRecord[], f: GameFilters): GameRecord[] {
  const q = f.search.trim().toLowerCase()
  return games.filter(
    (g) =>
      (f.timeClass === 'all' || g.timeClass === f.timeClass) &&
      (f.color === 'all' || g.userColor === f.color) &&
      (f.outcome === 'all' || g.outcome === f.outcome) &&
      (f.source === 'all' || g.source === f.source) &&
      (!q || opponentOf(g).name.toLowerCase().includes(q) || (g.opening ?? '').toLowerCase().includes(q)),
  )
}

export interface GameStats {
  total: number
  wins: number
  draws: number
  losses: number
  /** Percentages, rounded. */
  winPct: number
  drawPct: number
  lossPct: number
}

export function gameStats(games: GameRecord[]): GameStats {
  const wins = games.filter((g) => g.outcome === 'win').length
  const draws = games.filter((g) => g.outcome === 'draw').length
  const total = games.length
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0)
  return { total, wins, draws, losses: total - wins - draws, winPct: pct(wins), drawPct: pct(draws), lossPct: pct(total - wins - draws) }
}

/** "5 min", "3 | 2", "Daily" — from a chess.com time control string. */
export function formatTimeControl(tc: string): string {
  if (tc === '-') return 'No clock'
  if (tc.includes('/')) return 'Daily'
  const [base, inc] = tc.split('+').map(Number)
  const minutes = base >= 60 ? `${base / 60}` : `${base}s`
  return inc ? `${minutes} | ${inc}` : base >= 60 ? `${minutes} min` : minutes
}
