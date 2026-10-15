import type { TacticProgress } from '../data/db'
import type { Theme } from '../puzzles/extract'
import { MASTERED_DAYS, newSrs, schedule } from '../puzzles/srs'

/** A puzzle from the lichess database (CC0): `moves[0]` is the opponent's move, then my solution. */
export interface LichessPuzzle {
  id: string
  fen: string
  moves: string[]
  rating: number
  themes: string[]
}

export const TACTIC_THEMES: { tag: string; label: string }[] = [
  { tag: 'hangingPiece', label: 'Hanging piece' },
  { tag: 'fork', label: 'Fork' },
  { tag: 'pin', label: 'Pin' },
  { tag: 'skewer', label: 'Skewer' },
  { tag: 'discoveredAttack', label: 'Discovered attack' },
  { tag: 'mateIn1', label: 'Mate in 1' },
  { tag: 'mateIn2', label: 'Mate in 2' },
  { tag: 'mateIn3', label: 'Mate in 3' },
  { tag: 'backRankMate', label: 'Back-rank mate' },
  { tag: 'trappedPiece', label: 'Trapped piece' },
  { tag: 'deflection', label: 'Deflection' },
  { tag: 'attraction', label: 'Attraction' },
  { tag: 'defensiveMove', label: 'Defend' },
  { tag: 'opening', label: 'Opening tactics' },
  { tag: 'endgame', label: 'Endgame tactics' },
]
export const TACTIC_LABEL = Object.fromEntries(TACTIC_THEMES.map((t) => [t.tag, t.label]))

/** Which lichess themes train the weaknesses found in my own games. */
export const THEME_TO_TACTICS: Record<Theme, string[]> = {
  'hanging-piece': ['hangingPiece', 'defensiveMove'],
  'missed-material': ['hangingPiece', 'trappedPiece'],
  'missed-punish': ['hangingPiece'],
  'missed-mate': ['mateIn1', 'mateIn2'],
  'allowed-mate': ['defensiveMove', 'backRankMate'],
  fork: ['fork'],
  pin: ['pin'],
  skewer: ['skewer'],
  'discovered-attack': ['discoveredAttack'],
  'back-rank': ['backRankMate'],
  positional: [],
}

let cache: Promise<LichessPuzzle[]> | null = null

/** The bundled puzzle set (fetched once, cached offline by the service worker). */
export function loadLichessPuzzles(): Promise<LichessPuzzle[]> {
  cache ??= fetch(`${import.meta.env.BASE_URL}puzzles/lichess.json`)
    .then((r) => r.json() as Promise<[string, string, string, number, string][]>)
    .then((rows) => rows.map(([id, fen, moves, rating, themes]) => ({ id, fen, moves: moves.split(' '), rating, themes: themes.split(' ') })))
  cache.catch(() => (cache = null))
  return cache
}

// ---------- Tactics rating ----------

const RATING_KEY = 'chess-trainer.tactics-rating'
export const START_RATING = 800

export function readTacticsRating(): number {
  try {
    return Number(localStorage.getItem(RATING_KEY)) || START_RATING
  } catch {
    return START_RATING
  }
}

/** Elo update: 1 = solved cleanly, 0.5 = solved after a mistake or hint, 0 = failed. */
export function updateRating(rating: number, puzzleRating: number, result: number, k = 24): number {
  const expected = 1 / (1 + 10 ** ((puzzleRating - rating) / 400))
  return Math.round(rating + k * (result - expected))
}

export function saveTacticsRating(r: number) {
  try {
    localStorage.setItem(RATING_KEY, String(r))
  } catch {
    /* ignore */
  }
}

// ---------- Choosing puzzles ----------

/**
 * A session: failed puzzles that are due again first, then unseen ones closest
 * to my rating (shuffled a little so sessions differ).
 */
export function pickTactics(
  all: LichessPuzzle[],
  progress: Map<string, TacticProgress>,
  opts: { themes: string[] | null; rating: number; size: number; now: number; random?: () => number },
): LichessPuzzle[] {
  const random = opts.random ?? Math.random
  const matches = (p: LichessPuzzle) => !opts.themes || p.themes.some((t) => opts.themes!.includes(t))
  const due = all
    .filter((p) => matches(p) && (progress.get(p.id)?.due ?? Infinity) <= opts.now)
    .sort((a, b) => progress.get(a.id)!.due - progress.get(b.id)!.due)
  const fresh = all
    .filter((p) => matches(p) && !progress.has(p.id))
    .map((p) => ({ p, d: Math.abs(p.rating - opts.rating) + random() * 120 }))
    .sort((a, b) => a.d - b.d)
    .map((x) => x.p)
  return [...due, ...fresh].slice(0, opts.size)
}

export type LineOutcome = 'clean' | 'solved' | 'shown' | 'skipped'

/** New progress after an attempt; a clean first solve is not asked again. */
export function recordAttempt(prev: TacticProgress | undefined, puzzle: LichessPuzzle, outcome: LineOutcome, now: number): TacticProgress {
  const base: TacticProgress = prev ?? { ...newSrs(now), id: puzzle.id, rating: puzzle.rating, themes: puzzle.themes, attempts: 0, failures: 0 }
  const failed = outcome !== 'clean'
  const srs =
    !prev && !failed
      ? { ...base, due: now + MASTERED_DAYS * 3 * 86_400_000, interval: MASTERED_DAYS * 3, reps: 1, lastReview: now }
      : schedule(base, outcome === 'clean' ? 'good' : outcome === 'solved' ? 'hard' : 'again', now)
  return { ...base, ...srs, attempts: base.attempts + 1, failures: base.failures + (failed ? 1 : 0) }
}
