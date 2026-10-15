import { Chess, type Move } from 'chess.js'
import { parseClock, stripCommands } from './pgn'
import type { MoveIntent } from './types'

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export interface TreeNode {
  id: string
  /** Half-moves from the start position (root = 0, or the FEN's ply). */
  ply: number
  fen: string
  /** The move leading to this node (absent on the root). */
  move?: Pick<Move, 'san' | 'from' | 'to' | 'promotion' | 'flags'> & { uci: string }
  parentId: string | null
  /** children[0] continues the main line; the rest are variations. */
  children: string[]
  comment?: string
  /** Clock time left after this move, in ms (from PGN [%clk] annotations). */
  clock?: number
}

/**
 * A game as a tree of positions, so analysis can explore variations without
 * losing the main line. Mutable; callers re-render on their own.
 */
export class MoveTree {
  readonly nodes = new Map<string, TreeNode>()
  readonly rootId = 'root'
  readonly headers: Record<string, string>
  private nextId = 1

  constructor(startFen: string = START_FEN, headers: Record<string, string> = {}) {
    const fullmove = Number(startFen.split(' ')[5] ?? 1)
    const blackToMove = startFen.split(' ')[1] === 'b'
    this.nodes.set(this.rootId, {
      id: this.rootId,
      ply: (fullmove - 1) * 2 + (blackToMove ? 1 : 0),
      fen: startFen,
      parentId: null,
      children: [],
    })
    this.headers = headers
  }

  get root(): TreeNode {
    return this.nodes.get(this.rootId)!
  }

  get(id: string): TreeNode {
    const node = this.nodes.get(id)
    if (!node) throw new Error(`unknown node ${id}`)
    return node
  }

  /**
   * Plays a move (SAN or from/to) after `parentId`. Reuses an existing child
   * with the same move; otherwise appends a new variation. Null if illegal.
   */
  addMove(parentId: string, move: string | MoveIntent): TreeNode | null {
    const parent = this.get(parentId)
    const chess = new Chess(parent.fen)
    let played: Move
    try {
      played = chess.move(typeof move === 'string' ? move : { ...move, promotion: move.promotion ?? 'q' })
    } catch {
      return null
    }
    const uci = played.from + played.to + (played.promotion ?? '')
    const existing = parent.children.map((c) => this.get(c)).find((c) => c.move?.uci === uci)
    if (existing) return existing
    const node: TreeNode = {
      id: String(this.nextId++),
      ply: parent.ply + 1,
      fen: played.after,
      move: { san: played.san, from: played.from, to: played.to, promotion: played.promotion, flags: played.flags, uci },
      parentId,
      children: [],
    }
    this.nodes.set(node.id, node)
    parent.children.push(node.id)
    return node
  }

  /** Nodes from the root to `id`, inclusive. */
  path(id: string): TreeNode[] {
    const out: TreeNode[] = []
    for (let n: TreeNode | undefined = this.get(id); n; n = n.parentId ? this.get(n.parentId) : undefined) out.push(n)
    return out.reverse()
  }

  /** Follows first children from `id` to the end of its line (excluding `id`). */
  continuation(id: string): TreeNode[] {
    const out: TreeNode[] = []
    let n = this.get(id)
    while (n.children.length) {
      n = this.get(n.children[0])
      out.push(n)
    }
    return out
  }

  mainline(): TreeNode[] {
    return this.continuation(this.rootId)
  }

  isMainline(id: string): boolean {
    return this.path(id).every((n) => !n.parentId || this.get(n.parentId).children[0] === n.id)
  }

  /** Removes `id` and everything after it. */
  delete(id: string) {
    const node = this.get(id)
    if (!node.parentId) return
    const parent = this.get(node.parentId)
    parent.children = parent.children.filter((c) => c !== id)
    const drop = (n: TreeNode) => {
      this.nodes.delete(n.id)
      n.children.forEach((c) => drop(this.get(c)))
    }
    drop(node)
  }

  /** Makes the variation containing `id` the main continuation at each fork. */
  promote(id: string) {
    for (const n of this.path(id)) {
      if (!n.parentId) continue
      const parent = this.get(n.parentId)
      parent.children = [n.id, ...parent.children.filter((c) => c !== n.id)]
    }
  }

  // ---------- PGN ----------

  static fromPgn(pgn: string): MoveTree {
    const headers: Record<string, string> = {}
    const headerRe = /^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm
    let m: RegExpExecArray | null
    while ((m = headerRe.exec(pgn))) headers[m[1]] = m[2].replace(/\\"/g, '"')
    const movetext = pgn.replace(headerRe, '')

    const tree = new MoveTree(headers.FEN ?? START_FEN, headers)
    let current = tree.rootId
    const stack: string[] = []
    const tokens = movetext.match(/\{[^}]*\}|;[^\n]*|\$\d+|\(|\)|[^\s(){}]+/g) ?? []

    for (const token of tokens) {
      if (token.startsWith('{')) {
        const raw = token.slice(1, -1)
        const node = tree.get(current)
        const clock = parseClock(raw)
        if (clock !== undefined) node.clock = clock
        const comment = stripCommands(raw)
        if (comment) node.comment = comment
      } else if (token === '(') {
        stack.push(current)
        // A variation replaces the last move: branch from its parent.
        current = tree.get(current).parentId ?? current
      } else if (token === ')') {
        current = stack.pop() ?? current
      } else if (token.startsWith(';') || token.startsWith('$') || /^(1-0|0-1|1\/2-1\/2|\*)$/.test(token)) {
        continue
      } else {
        const san = token.replace(/^\d+\.(\.\.)?/, '').replace(/[!?]+$/, '')
        if (!san) continue // a bare move number like "12." or "12..."
        const node = tree.addMove(current, san)
        if (!node) throw new Error(`Illegal move "${san}" after ${tree.get(current).fen}`)
        current = node.id
      }
    }
    return tree
  }

  static fromMoves(sans: string[], startFen: string = START_FEN, headers: Record<string, string> = {}): MoveTree {
    const tree = new MoveTree(startFen, headers)
    let current = tree.rootId
    for (const san of sans) current = tree.addMove(current, san)!.id
    return tree
  }

  toPgn(): string {
    const headers = { Event: '?', Site: '?', Date: '????.??.??', White: '?', Black: '?', Result: '*', ...this.headers }
    if (this.root.fen !== START_FEN) Object.assign(headers, { SetUp: '1', FEN: this.root.fen })
    const headerText = Object.entries(headers)
      .map(([k, v]) => `[${k} "${v.replace(/"/g, '\\"')}"]`)
      .join('\n')
    const parts: string[] = []
    if (this.root.comment) parts.push(`{${this.root.comment}}`)
    this.writeLine(this.root, parts, true)
    parts.push(headers.Result)
    return `${headerText}\n\n${wrap(parts.join(' '))}\n`
  }

  /** Writes the continuation after `node`, with variations in parentheses. */
  private writeLine(node: TreeNode, out: string[], forceNumber: boolean) {
    let n = node
    let needNumber = forceNumber
    while (n.children.length) {
      const [main, ...alts] = n.children.map((c) => this.get(c))
      out.push(moveText(main, needNumber))
      if (main.comment) out.push(`{${main.comment}}`)
      for (const alt of alts) {
        const sub = [moveText(alt, true)]
        if (alt.comment) sub.push(`{${alt.comment}}`)
        this.writeLine(alt, sub, !!alt.comment)
        out.push(`(${sub.join(' ')})`)
      }
      needNumber = alts.length > 0 || !!main.comment
      n = main
    }
  }
}

/** "12. e4" / "12... e5" / "e5", given the node's ply. */
export function moveText(node: TreeNode, forceNumber = false): string {
  const moveNo = Math.floor((node.ply - 1) / 2) + 1
  const whiteMoved = node.ply % 2 === 1
  if (whiteMoved) return `${moveNo}. ${node.move!.san}`
  return forceNumber ? `${moveNo}... ${node.move!.san}` : node.move!.san
}

function wrap(text: string, width = 80): string {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  return lines.join('\n')
}
