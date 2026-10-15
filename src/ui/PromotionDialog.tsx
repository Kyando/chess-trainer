import type { Color, PromotionPiece } from '../core/types'

interface Props {
  color: Color
  onPick: (piece: PromotionPiece) => void
  onCancel: () => void
}

const PIECES: { piece: PromotionPiece; role: string }[] = [
  { piece: 'q', role: 'queen' },
  { piece: 'n', role: 'knight' },
  { piece: 'r', role: 'rook' },
  { piece: 'b', role: 'bishop' },
]

/** Promotion picker; reuses chessground's piece images via its CSS classes. */
export function PromotionDialog({ color, onPick, onCancel }: Props) {
  const colorName = color === 'w' ? 'white' : 'black'
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="promotion cg-wrap" onClick={(e) => e.stopPropagation()}>
        {PIECES.map(({ piece, role }) => (
          <button key={piece} className="promotion-choice" onClick={() => onPick(piece)} aria-label={`Promote to ${role}`}>
            <piece className={`${role} ${colorName}`} />
          </button>
        ))}
      </div>
    </div>
  )
}

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      piece: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
    }
  }
}
