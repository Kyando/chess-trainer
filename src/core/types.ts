export type Color = 'w' | 'b'

export type PromotionPiece = 'q' | 'r' | 'b' | 'n'

/**
 * A request to play a move, independent of where it came from (board drag,
 * keyboard, and later voice). Every input adapter produces one of these.
 */
export interface MoveIntent {
  from: string
  to: string
  promotion?: PromotionPiece
}

export type GameEndReason =
  | 'checkmate'
  | 'stalemate'
  | 'insufficient'
  | 'threefold'
  | 'fifty-move'
  | 'timeout'
  | 'timeout-vs-insufficient'
  | 'resign'

export interface GameResult {
  /** Winner color, or null for a draw. */
  winner: Color | null
  reason: GameEndReason
}

export const opposite = (c: Color): Color => (c === 'w' ? 'b' : 'w')
