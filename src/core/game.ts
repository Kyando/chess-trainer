import { Chess, type Move } from 'chess.js'
import { ChessClock, type TimeControl } from './clock'
import { opposite, type Color, type GameResult, type MoveIntent } from './types'

export interface GameOptions {
  /** null = untimed game. */
  timeControl: TimeControl | null
  startFen?: string
  /** Injectable time source (tests). */
  now?: () => number
}

export type GameEvent =
  | { type: 'move'; move: Move }
  | { type: 'undo' }
  | { type: 'end'; result: GameResult }

type Listener = (event: GameEvent) => void

/**
 * Pure game logic: rules, clock and result. UI and engine are listeners, so
 * future output adapters (sounds, speech narration) can subscribe the same way.
 */
export class GameSession {
  readonly chess: Chess
  readonly clock: ChessClock | null
  readonly timeControl: TimeControl | null
  result: GameResult | null = null
  private listeners = new Set<Listener>()

  constructor(opts: GameOptions) {
    this.chess = new Chess(opts.startFen)
    this.timeControl = opts.timeControl
    this.clock = opts.timeControl ? new ChessClock(opts.timeControl, opts.now) : null
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get fen() {
    return this.chess.fen()
  }

  get turn(): Color {
    return this.chess.turn()
  }

  get history(): Move[] {
    return this.chess.history({ verbose: true })
  }

  get isOver() {
    return this.result !== null
  }

  /** Legal destinations per origin square, in the shape chessground expects. */
  legalDests(): Map<string, string[]> {
    const dests = new Map<string, string[]>()
    if (this.isOver) return dests
    for (const m of this.chess.moves({ verbose: true })) {
      const list = dests.get(m.from)
      if (list) list.push(m.to)
      else dests.set(m.from, [m.to])
    }
    return dests
  }

  isPromotion(from: string, to: string): boolean {
    return this.chess
      .moves({ square: from as never, verbose: true })
      .some((m) => m.to === to && m.isPromotion())
  }

  /** Plays a move. Returns null if the move is illegal or the game is over. */
  move(intent: MoveIntent): Move | null {
    if (this.isOver || this.checkFlag()) return null
    const color = this.turn
    let move: Move
    try {
      move = this.chess.move({ from: intent.from, to: intent.to, promotion: intent.promotion ?? 'q' })
    } catch {
      return null
    }
    if (this.clock) {
      // Like lichess, White's first move is free: clocks start once it is played.
      if (this.clock.activeColor === null) this.clock.start(opposite(color))
      else this.clock.press(color)
    }
    this.emit({ type: 'move', move })
    this.detectEnd()
    return move
  }

  /** Takes back `plies` half-moves (practice games only). */
  undo(plies: number) {
    if (this.isOver) return
    let undone = 0
    while (undone < plies && this.chess.undo()) undone++
    if (undone && this.clock?.activeColor) this.clock.start(this.turn)
    if (undone) this.emit({ type: 'undo' })
  }

  resign(color: Color) {
    if (this.isOver) return
    this.finish({ winner: opposite(color), reason: 'resign' })
  }

  /** Ends the game if the side to move has run out of time. Returns true if it did. */
  checkFlag(): boolean {
    if (this.isOver || !this.clock) return false
    const flagged = this.clock.flagged()
    if (!flagged) return false
    const winner = opposite(flagged)
    if (hasMatingMaterial(this.chess, winner)) this.finish({ winner, reason: 'timeout' })
    else this.finish({ winner: null, reason: 'timeout-vs-insufficient' })
    return true
  }

  pgn(headers: Record<string, string> = {}): string {
    const copy = new Chess()
    copy.loadPgn(this.chess.pgn())
    for (const [k, v] of Object.entries(headers)) copy.setHeader(k, v)
    copy.setHeader('Result', resultTag(this.result))
    if (this.timeControl) {
      copy.setHeader('TimeControl', `${this.timeControl.initial}+${this.timeControl.increment}`)
    }
    return copy.pgn()
  }

  private detectEnd() {
    const c = this.chess
    if (c.isCheckmate()) this.finish({ winner: opposite(c.turn()), reason: 'checkmate' })
    else if (c.isStalemate()) this.finish({ winner: null, reason: 'stalemate' })
    else if (c.isInsufficientMaterial()) this.finish({ winner: null, reason: 'insufficient' })
    else if (c.isThreefoldRepetition()) this.finish({ winner: null, reason: 'threefold' })
    else if (c.isDrawByFiftyMoves()) this.finish({ winner: null, reason: 'fifty-move' })
  }

  private finish(result: GameResult) {
    this.result = result
    this.clock?.stop()
    this.emit({ type: 'end', result })
  }

  private emit(event: GameEvent) {
    for (const l of this.listeners) l(event)
  }
}

/** Whether `color` still has material that could deliver mate (for timeout rulings). */
export function hasMatingMaterial(chess: Chess, color: Color): boolean {
  let minors = 0
  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq || sq.color !== color || sq.type === 'k') continue
      if (sq.type === 'p' || sq.type === 'r' || sq.type === 'q') return true
      minors++
    }
  }
  return minors >= 2
}

export function resultTag(result: GameResult | null): string {
  if (!result) return '*'
  if (result.winner === 'w') return '1-0'
  if (result.winner === 'b') return '0-1'
  return '1/2-1/2'
}

export function describeResult(result: GameResult): string {
  const who = result.winner === 'w' ? 'White' : 'Black'
  switch (result.reason) {
    case 'checkmate':
      return `${who} wins by checkmate`
    case 'resign':
      return `${who} wins by resignation`
    case 'timeout':
      return `${who} wins on time`
    case 'timeout-vs-insufficient':
      return 'Draw — timeout vs insufficient material'
    case 'stalemate':
      return 'Draw by stalemate'
    case 'insufficient':
      return 'Draw — insufficient material'
    case 'threefold':
      return 'Draw by repetition'
    case 'fifty-move':
      return 'Draw — 50-move rule'
  }
}
