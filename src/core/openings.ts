export interface Opening {
  eco: string
  name: string
}

type OpeningTable = Record<string, [string, string]>

let table: OpeningTable | null = null
let loading: Promise<OpeningTable> | null = null

/** Loads the opening table (~460 KB, lazily split into its own chunk). */
export function loadOpenings(): Promise<OpeningTable> {
  loading ??= import('../data/openings.json').then((m) => (table = m.default as unknown as OpeningTable))
  return loading
}

export const positionKey = (fen: string) => fen.split(' ').slice(0, 4).join(' ')

/**
 * The most specific named opening along a line of positions (start → current),
 * or null if the table is not loaded yet or nothing matches.
 */
export function openingFor(fens: string[]): Opening | null {
  if (!table) return null
  for (let i = fens.length - 1; i >= 0; i--) {
    const hit = table[positionKey(fens[i])]
    if (hit) return { eco: hit[0], name: hit[1] }
  }
  return null
}
