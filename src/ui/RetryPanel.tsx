import { CLASS_INFO, type ReviewedMove } from '../review/review'
import type { QuizStatus } from '../review/useQuiz'

interface Props {
  status: QuizStatus
  message: string
  item?: ReviewedMove
  at: number
  total: number
  clean: number
  hint: boolean
  onHint: () => void
  onSolution: () => void
  onNext: () => void
  onExit: () => void
}

/** Side panel while retrying mistakes: the task, feedback and controls. */
export function RetryPanel(p: Props) {
  if (p.status === 'finished' || !p.item) {
    return (
      <div className="review-panel retry-panel">
        <div className="review-title">Retry finished</div>
        <p className="retry-score">
          {p.clean} of {p.total} found on the first try
        </p>
        <button className="btn primary" onClick={p.onExit}>
          Back to the review
        </button>
      </div>
    )
  }

  const { item } = p
  const info = CLASS_INFO[item.cls]
  const side = item.color === 'w' ? 'White' : 'Black'
  const moveNo = `${Math.floor(item.index / 2) + 1}${item.color === 'w' ? '.' : '…'}`
  const done = p.status === 'right' || p.status === 'shown'

  return (
    <div className="review-panel retry-panel">
      <div className="review-row">
        <span className="review-title">Retry mistakes</span>
        <span className="muted">
          {p.at + 1} / {p.total}
        </span>
      </div>
      <p>
        In the game, {side} played{' '}
        <strong style={{ color: info.color }}>
          {moveNo} {item.san}
        </strong>{' '}
        — a {info.label.toLowerCase()}. Find a better move for {side}.
      </p>
      <div className={`retry-feedback ${p.status}`} aria-live="polite">
        {p.status === 'right' && '✓ '}
        {p.status === 'wrong' && '✗ '}
        {p.message || ' '}
      </div>
      <div className="action-row">
        {done ? (
          <button className="btn primary" onClick={p.onNext}>
            {p.at + 1 < p.total ? 'Next ▶' : 'Finish'}
          </button>
        ) : (
          <>
            <button className="btn secondary small-text" onClick={p.onHint} disabled={p.hint || p.status === 'checking'}>
              Hint
            </button>
            <button className="btn secondary small-text" onClick={p.onSolution} disabled={p.status === 'checking'}>
              Show solution
            </button>
            <button className="btn secondary small-text" onClick={p.onNext}>
              Skip
            </button>
          </>
        )}
      </div>
      <button className="btn secondary small-text" onClick={p.onExit}>
        ✕ Exit retry
      </button>
    </div>
  )
}
