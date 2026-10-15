import { Chess } from 'chess.js'
import { isBookPosition, positionKey } from '../core/openings'
import type { Color } from '../core/types'
import type { ChessDb, GameRecord, OpeningPosition, Outcome } from '../data/db'
import type { StockfishEngine } from '../engine/stockfish'
import { newSrs } from '../puzzles/srs'
import { winAfterMove } from '../review/runner'

/** How deep the repertoire goes, in half-moves (8 moves each). */
export const OPENING_PLIES = 16
/** A position must come up this often to be worth checking. */
export const MIN_COUNT = 4
/** Engine work per check. */
export const OPENING_NODES = 200_000

/** First `max` SAN moves of a PGN, without parsing the whole game. */
export function firstMoves(pgn: string, max = OPENING_PLIES): string[] {
  const body = pgn
    .replace(/^\[.*\]\s*$/gm, '')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\([^()]*\)/g, ' ')
    .replace(/\$\d+/g, ' ')
  const out: string[] = []
  for (const token of body.split(/\s+/)) {
    if (!token || /^\d+\.+$/.test(token) || /^(1-0|0-1|1\/2-1\/2|\*)$/.test(token)) continue
    out.push(token.replace(/^\d+\.+/, ''))
    if (out.length >= max) break
  }
  return out
}

export interface RepertoireMove {
  uci: string
  san: string
  count: number
  /** Points I scored in games with this move (win 1, draw ½). */
  points: number
}

export interface RepertoireNode {
  key: string
  fen: string
  /** Moves leading here, in SAN, from the first game that reached it. */
  line: string[]
  count: number
  moves: Map<string, RepertoireMove>
}

const POINTS: Record<Outcome, number> = { win: 1, draw: 0.5, loss: 0 }

/** Positions where it was my move, with what I played there and how it went. */
export function buildRepertoire(games: { sans: string[]; color: Color; outcome: Outcome }[], maxPlies = OPENING_PLIES) {
  const nodes = new Map<string, RepertoireNode>()
  for (const g of games) {
    const chess = new Chess()
    for (let i = 0; i < Math.min(maxPlies, g.sans.length); i++) {
      const mine = chess.turn() === g.color
      const fen = chess.fen()
      let move
      try {
        move = chess.move(g.sans[i])
      } catch {
        break
      }
      if (!mine) continue
      const key = `${g.color}|${positionKey(fen)}`
      let node = nodes.get(key)
      if (!node) nodes.set(key, (node = { key, fen, line: g.sans.slice(0, i), count: 0, moves: new Map() }))
      node.count++
      const uci = move.lan
      const m = node.moves.get(uci) ?? { uci, san: move.san, count: 0, points: 0 }
      m.count++
      m.points += POINTS[g.outcome]
      node.moves.set(uci, m)
    }
  }
  return nodes
}

/** The positions worth checking, most frequent first. */
export function frequentPositions(nodes: Map<string, RepertoireNode>, minCount = MIN_COUNT): RepertoireNode[] {
  return [...nodes.values()].filter((n) => n.count >= minCount).sort((a, b) => b.count - a.count)
}

/** Loads my games of one color (most recent first) and builds the repertoire. */
export async function loadRepertoire(database: ChessDb, color: Color, limit = 1000) {
  const games = (await database.games.orderBy('endTime').reverse().toArray()).filter((g: GameRecord) => g.userColor === color).slice(0, limit)
  const pgns = await database.pgns.bulkGet(games.map((g) => g.id))
  const list = games.flatMap((g, i) => (pgns[i] ? [{ sans: firstMoves(pgns[i]!.pgn), color, outcome: g.outcome }] : []))
  return { games: list.length, nodes: buildRepertoire(list) }
}

/** A position where my usual move gives away at least this much win chance is a leak. */
export const LEAK_LOSS = 6

/** My most played move in a checked position, and how much it loses vs the best. */
export function usualMove(p: Pick<OpeningPosition, 'moves' | 'bestWin'>) {
  const usual = [...p.moves].sort((a, b) => b.count - a.count)[0]
  return usual ? { ...usual, loss: Math.max(0, p.bestWin - usual.win) } : null
}

export function isLeak(p: OpeningPosition): boolean {
  const u = usualMove(p)
  return !!u && u.uci !== p.bestUci && u.loss >= LEAK_LOSS
}

/**
 * Checks one position with the engine: the best move, and each move I played
 * at least twice. Book moves that the engine dislikes only a little are fine.
 */
export async function analyzePosition(engine: StockfishEngine, node: RepertoireNode, color: Color, now: number): Promise<OpeningPosition> {
  const { bestmove } = await engine.search(node.fen, { nodes: OPENING_NODES, multipv: 1 })
  const chess = new Chess(node.fen)
  const best = chess.move({ from: bestmove.slice(0, 2), to: bestmove.slice(2, 4), promotion: bestmove[4] })
  const bestWin = await winAfterMove(engine, node.fen, best.lan, OPENING_NODES)
  const moves: OpeningPosition['moves'] = []
  for (const m of [...node.moves.values()].sort((a, b) => b.count - a.count).slice(0, 3)) {
    if (m.count < 2 && moves.length) continue
    let win = m.uci === best.lan ? bestWin : await winAfterMove(engine, node.fen, m.uci, OPENING_NODES)
    // Established theory: don't flag a book move over a few percent of engine noise.
    const after = new Chess(node.fen)
    after.move(m.san)
    if (isBookPosition(after.fen()) && bestWin - win < 12) win = Math.max(win, bestWin - LEAK_LOSS + 1)
    moves.push({ uci: m.uci, san: m.san, count: m.count, score: Math.round((m.points / m.count) * 100), win })
  }
  return {
    ...newSrs(now),
    key: node.key,
    color,
    fen: node.fen,
    line: node.line,
    count: node.count,
    bestUci: best.lan,
    bestSan: best.san,
    bestWin,
    moves,
    analyzedAt: now,
  }
}

/** "1.e4 e5 2.Nf3" style text for a SAN line. */
export function formatLine(sans: string[]): string {
  return sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}.${s}` : s)).join(' ')
}
