/** Lightweight PGN helpers that avoid replaying moves (for bulk imports). */

/** Header tags of a PGN. */
export function pgnHeaders(pgn: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const m of pgn.matchAll(/^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm)) headers[m[1]] = m[2]
  return headers
}

/**
 * Main-line SAN moves of a PGN: drops headers, comments, variations, NAGs,
 * move numbers and the result token.
 */
export function pgnMainlineSans(pgn: string): string[] {
  let text = pgn.replace(/^\s*\[.*\]\s*$/gm, '').replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ')
  // Strip (possibly nested) variations from the inside out.
  let previous
  do {
    previous = text
    text = text.replace(/\([^()]*\)/g, ' ')
  } while (text !== previous)
  return text
    .split(/\s+/)
    .map((t) => t.replace(/^\d+\.(\.\.)?/, '').replace(/[!?]+$/, ''))
    .filter((t) => t && !t.startsWith('$') && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t))
}

/** Parses "[%clk 0:04:59.9]" inside a comment into milliseconds. */
export function parseClock(comment: string): number | undefined {
  const m = comment.match(/\[%clk\s+(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]/)
  if (!m) return undefined
  return Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000)
}

/** Removes embedded commands like [%clk …] / [%eval …], leaving human text. */
export function stripCommands(comment: string): string {
  return comment.replace(/\[%[^\]]*\]/g, '').trim()
}
