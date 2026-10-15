import { Chess, type Square } from 'chess.js'
import { opposite, type Color } from '../core/types'

/** Tactical patterns recognised in a winning line. */
export type Motif = 'fork' | 'pin' | 'skewer' | 'discovered-attack' | 'back-rank'

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 }

const FILES = 'abcdefgh'
const sq = (f: number, r: number) => `${FILES[f]}${r + 1}` as Square
const coords = (s: string): [number, number] => [FILES.indexOf(s[0]), Number(s[1]) - 1]

const ROOK_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]
const BISHOP_DIRS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

function play(chess: Chess, uci: string) {
  return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
}

/**
 * Recognises the tactic behind the best line `pv` (UCI) for `color` in `fen`.
 * Heuristic, aimed at the clear-cut patterns club players miss; an empty list
 * means "no simple pattern".
 */
export function detectMotifs(fen: string, pv: string[], color: Color): Motif[] {
  if (!pv.length) return []
  const motifs = new Set<Motif>()
  const them = opposite(color)
  const before = new Chess(fen)
  const after = new Chess(fen)
  let first
  try {
    first = play(after, pv[0])
  } catch {
    return []
  }
  const to = first.to as Square
  const mover = first.piece
  // Does the line win something back right after (my capture two plies on)?
  const followUp = (() => {
    const c = new Chess(after.fen())
    try {
      if (!pv[1] || !pv[2]) return null
      play(c, pv[1])
      return play(c, pv[2])
    } catch {
      return null
    }
  })()
  const wins = !!followUp?.captured || after.isCheckmate()

  // Fork: the moved piece hits two targets worth more than it, or undefended.
  if (!after.isCheckmate()) {
    const targets = enemySquares(after, them).filter((s) => {
      if (!after.attackers(s, color).includes(to)) return false
      const piece = after.get(s)!
      return piece.type === 'k' || VALUE[piece.type] > VALUE[mover] || after.attackers(s, them).length === 0
    })
    if (targets.length >= 2 && wins) motifs.add('fork')
  }

  // Pin / skewer along the moved slider's lines.
  if (mover === 'b' || mover === 'r' || mover === 'q') {
    const dirs = mover === 'b' ? BISHOP_DIRS : mover === 'r' ? ROOK_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS]
    for (const [df, dr] of dirs) {
      const [front, back] = firstTwo(after, to, df, dr)
      if (!front || !back || front.color !== them || back.color !== them) continue
      if (VALUE[front.type] < VALUE[back.type] && back.type !== 'p') motifs.add('pin')
      else if (VALUE[front.type] > VALUE[back.type] && followUp?.captured && followUp.to === back.square) motifs.add('skewer')
    }
  }

  // Discovered attack: moving the piece opened a line for another of mine.
  for (const s of enemySquares(after, them)) {
    const piece = after.get(s)!
    if (piece.type !== 'k' && VALUE[piece.type] < 5) continue
    const was = new Set(before.attackers(s, color))
    const now = after.attackers(s, color).filter((a) => a !== to && !was.has(a))
    if (now.length && wins) motifs.add('discovered-attack')
  }

  // Back-rank mate: the line mates a king stuck on its first rank.
  const end = new Chess(fen)
  try {
    for (const u of pv.slice(0, 7)) play(end, u)
  } catch {
    /* use what was legal */
  }
  if (end.isCheckmate() && end.turn() === them) {
    const king = enemySquares(end, them).find((s) => end.get(s)!.type === 'k')!
    const homeRank = them === 'w' ? 0 : 7
    if (coords(king)[1] === homeRank) motifs.add('back-rank')
  }
  return [...motifs]
}

function enemySquares(chess: Chess, them: Color): Square[] {
  const out: Square[] = []
  for (const row of chess.board()) for (const p of row) if (p && p.color === them) out.push(p.square)
  return out
}

/** The first two pieces met walking from `from` in direction (df, dr). */
function firstTwo(chess: Chess, from: Square, df: number, dr: number) {
  const found: { square: Square; type: string; color: Color }[] = []
  let [f, r] = coords(from)
  for (;;) {
    f += df
    r += dr
    if (f < 0 || f > 7 || r < 0 || r > 7) break
    const p = chess.get(sq(f, r))
    if (p) {
      found.push({ square: sq(f, r), type: p.type, color: p.color })
      if (found.length === 2) break
    }
  }
  return found
}
