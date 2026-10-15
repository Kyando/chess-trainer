import { formatEval, winPercent, type WhiteEval } from '../engine/eval'

interface Props {
  evaluation: WhiteEval | null
  orientation: 'white' | 'black'
  /** Overrides the score text, e.g. "1-0" at checkmate. */
  label?: string
}

/** Vertical evaluation bar; White's share grows from White's side of the board. */
export function EvalBar({ evaluation, orientation, label: labelOverride }: Props) {
  const white = evaluation ? winPercent(evaluation) : 50
  const label = labelOverride ?? (evaluation ? formatEval(evaluation).replace('+', '') : '')
  const whiteAhead = white >= 50
  return (
    <div className={`eval-bar ${orientation === 'black' ? 'flipped' : ''}`} aria-label={`Evaluation ${label}`}>
      <div className="eval-white" style={{ height: `${white}%` }} />
      <span className={`eval-label ${whiteAhead ? 'on-white' : 'on-black'}`}>{label}</span>
    </div>
  )
}
