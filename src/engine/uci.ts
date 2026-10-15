import type { MoveIntent, PromotionPiece } from '../core/types'

/** One principal variation reported by the engine. */
export interface EngineLine {
  multipv: number
  depth: number
  /** Centipawns from the side to move's point of view (undefined when mate). */
  cp?: number
  /** Moves to mate; positive = side to move mates, negative = gets mated. */
  mate?: number
  /** Moves in UCI notation (e2e4, e7e8q). */
  pv: string[]
}

/** Parses a UCI `info ...` line; returns null for lines without a scored PV. */
export function parseInfo(line: string): EngineLine | null {
  if (!line.startsWith('info ') || !line.includes(' pv ')) return null
  const tokens = line.split(' ')
  const line_: EngineLine = { multipv: 1, depth: 0, pv: [] }
  for (let i = 1; i < tokens.length; i++) {
    switch (tokens[i]) {
      case 'depth':
        line_.depth = Number(tokens[++i])
        break
      case 'multipv':
        line_.multipv = Number(tokens[++i])
        break
      case 'score': {
        const kind = tokens[++i]
        const value = Number(tokens[++i])
        if (kind === 'cp') line_.cp = value
        else if (kind === 'mate') line_.mate = value
        break
      }
      case 'pv':
        line_.pv = tokens.slice(i + 1)
        i = tokens.length
        break
    }
  }
  if (line_.cp === undefined && line_.mate === undefined) return null
  return line_
}

/** A single comparable score: mates map to large values, faster mates rank higher. */
export function scoreValue(line: Pick<EngineLine, 'cp' | 'mate'>): number {
  if (line.mate !== undefined) {
    if (line.mate > 0) return 100_000 - line.mate
    return -100_000 - line.mate
  }
  return line.cp ?? 0
}

export function uciToIntent(uci: string): MoveIntent {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci[4] as PromotionPiece | undefined,
  }
}
