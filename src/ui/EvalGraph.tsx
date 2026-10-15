import { CLASS_INFO, ERRORS, type GameReview } from '../review/review'

interface Props {
  review: GameReview
  /** Index of the position shown on the board (0 = start), or null off the main line. */
  current: number | null
  onSelect: (position: number) => void
}

const W = 600
const H = 90

/** White's winning chances over the game; click to jump to a position. */
export function EvalGraph({ review, current, onSelect }: Props) {
  const n = review.whiteWin.length
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : 0)
  const y = (win: number) => H - (win / 100) * H
  const points = review.whiteWin.map((w, i) => `${x(i).toFixed(1)},${y(w).toFixed(1)}`)
  const area = `M0,${H} L${points.join(' L')} L${W},${H} Z`

  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const i = Math.round(((e.clientX - rect.left) / rect.width) * (n - 1))
    onSelect(Math.max(0, Math.min(n - 1, i)))
  }

  return (
    <svg
      className="eval-graph"
      viewBox={`0 0 ${W} ${H}`}
      onPointerDown={pick}
      role="img"
      aria-label="Evaluation graph"
    >
      <rect width={W} height={H} fill="#403d39" />
      <path d={area} fill="#fff" />
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="#8b8987" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {current !== null && (
        <line x1={x(current)} x2={x(current)} y1={0} y2={H} stroke="#81b64c" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      )}
      {review.moves
        .filter((m) => ERRORS.has(m.cls))
        .map((m) => (
          <circle
            key={m.index}
            cx={x(m.index + 1)}
            cy={y(review.whiteWin[m.index + 1])}
            r={4}
            fill={CLASS_INFO[m.cls].color}
            stroke="#262421"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
    </svg>
  )
}
