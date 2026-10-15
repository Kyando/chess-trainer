import type { StockfishEngine } from './stockfish'
import { scoreValue, type EngineLine } from './uci'

export interface BotLevel {
  id: number
  name: string
  /** Rough strength guess; to be calibrated against real games later. */
  approxElo: number
  depth: number
  /** How many candidate moves the bot considers. */
  multipv: number
  /** Softmax temperature in centipawns: higher = more willing to pick worse moves. */
  temperature: number
  /** Chance of picking any candidate uniformly at random (a human-like "blunder"). */
  blunderChance: number
}

// Stockfish's own UCI_Elo floor is ~1320, so weak levels are made by searching
// shallowly and sampling among the top candidate moves instead of always the best.
export const BOT_LEVELS: BotLevel[] = [
  { id: 1, name: 'Beginner', approxElo: 400, depth: 1, multipv: 12, temperature: 400, blunderChance: 0.25 },
  { id: 2, name: 'Novice', approxElo: 600, depth: 2, multipv: 10, temperature: 250, blunderChance: 0.15 },
  { id: 3, name: 'Casual', approxElo: 800, depth: 3, multipv: 8, temperature: 160, blunderChance: 0.08 },
  { id: 4, name: 'Improver', approxElo: 1000, depth: 4, multipv: 6, temperature: 110, blunderChance: 0.04 },
  { id: 5, name: 'Club', approxElo: 1200, depth: 6, multipv: 5, temperature: 70, blunderChance: 0.02 },
  { id: 6, name: 'Strong club', approxElo: 1500, depth: 8, multipv: 4, temperature: 40, blunderChance: 0.005 },
  { id: 7, name: 'Expert', approxElo: 1800, depth: 10, multipv: 3, temperature: 20, blunderChance: 0 },
  { id: 8, name: 'Master', approxElo: 2200, depth: 14, multipv: 2, temperature: 8, blunderChance: 0 },
  { id: 9, name: 'Maximum', approxElo: 3000, depth: 20, multipv: 1, temperature: 0, blunderChance: 0 },
]

export function botLevel(id: number): BotLevel {
  return BOT_LEVELS.find((l) => l.id === id) ?? BOT_LEVELS[3]
}

/** Picks a move from engine candidate lines according to the level's weakness. */
export function pickMove(lines: EngineLine[], level: BotLevel, random: () => number = Math.random): string | null {
  const candidates = lines.filter((l) => l.pv.length > 0)
  if (candidates.length === 0) return null
  if (candidates.length === 1 || level.temperature === 0) return candidates[0].pv[0]

  // Never throw away a forced mate the bot has found; that looks inhuman.
  const best = candidates[0]
  if (best.mate !== undefined && best.mate > 0 && best.mate <= 2) return best.pv[0]

  if (random() < level.blunderChance) {
    return candidates[Math.floor(random() * candidates.length)].pv[0]
  }

  const top = scoreValue(best)
  const weights = candidates.map((c) => Math.exp((scoreValue(c) - top) / level.temperature))
  const total = weights.reduce((a, b) => a + b, 0)
  let r = random() * total
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i]
    if (r <= 0) return candidates[i].pv[0]
  }
  return best.pv[0]
}

export async function chooseBotMove(engine: StockfishEngine, fen: string, level: BotLevel): Promise<string | null> {
  const { bestmove, lines } = await engine.search(fen, { depth: level.depth, multipv: level.multipv })
  return pickMove(lines, level) ?? (bestmove && bestmove !== '(none)' ? bestmove : null)
}

/**
 * A human-feeling pause before the bot moves: quick in the opening, longer in
 * the middlegame, and shorter as its clock runs low.
 */
export function thinkDelayMs(timeLeftMs: number | null, ply: number, random: () => number = Math.random): number {
  const phase = ply < 10 ? 0.35 : 1
  if (timeLeftMs === null) return (300 + random() * 900) * phase
  const budget = Math.min(timeLeftMs / 60, 2500) * phase
  return Math.max(150, budget * (0.4 + random() * 0.8))
}
