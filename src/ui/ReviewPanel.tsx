import type { Color } from '../core/types'
import { CLASS_INFO, ERRORS, MOVE_CLASSES, type GameReview, type MoveClass, type ReviewedMove } from '../review/review'
import type { ReviewStatus } from '../review/useGameReview'
import { EvalGraph } from './EvalGraph'

interface Props {
  status: ReviewStatus
  progress: number
  error?: string
  review: GameReview | null
  /** Number of moves in the main line. */
  moveCount: number
  names: Record<Color, string>
  /** Position index on the board (0 = start) when on the main line, else null. */
  current: number | null
  /** The side whose mistakes "Retry" drills (the side at the bottom of the board). */
  userColor: Color
  onStart: () => void
  onCancel: () => void
  onSelect: (position: number) => void
  onPlayLine: (position: number, ucis: string[]) => void
  onRetry: () => void
}

const PHRASE: Record<MoveClass, string> = {
  book: 'is a book move',
  forced: 'is forced',
  great: 'is a great move — the only good one',
  best: 'is the best move',
  excellent: 'is excellent',
  good: 'is good',
  inaccuracy: 'is an inaccuracy',
  mistake: 'is a mistake',
  miss: 'is a miss — you could have punished the last move',
  blunder: 'is a blunder',
}

/** Game Review: run it, then accuracy, move counts, eval graph and per-move feedback. */
export function ReviewPanel(props: Props) {
  const { status, review } = props

  if (status !== 'done' || !review) {
    return (
      <div className="review-panel">
        <div className="review-title">★ Game Review</div>
        {status === 'running' ? (
          <>
            <div className="progress">
              <div className="progress-fill" style={{ width: `${Math.round(props.progress * 100)}%` }} />
            </div>
            <div className="review-row">
              <span className="muted">Analysing… {Math.round(props.progress * 100)}%</span>
              <button className="btn secondary small-text" onClick={props.onCancel}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            {status === 'error' && <div className="error">Review failed: {props.error}</div>}
            <button className="btn primary" onClick={props.onStart} disabled={props.moveCount < 2}>
              Review this game
            </button>
          </>
        )}
      </div>
    )
  }

  const move = props.current ? review.moves[props.current - 1] : undefined
  const errors = review.moves.filter((m) => ERRORS.has(m.cls))
  const prevError = [...errors].reverse().find((m) => m.index + 1 < (props.current ?? 0))
  const nextError = errors.find((m) => m.index + 1 > (props.current ?? 0))
  const retryCount = errors.filter((m) => m.color === props.userColor).length

  return (
    <div className="review-panel">
      <EvalGraph review={review} current={props.current} onSelect={props.onSelect} />
      <table className="review-table">
        <thead>
          <tr>
            <th />
            <th>{props.names.w}</th>
            <th>{props.names.b}</th>
          </tr>
        </thead>
        <tbody>
          <tr className="accuracy-row">
            <td>Accuracy</td>
            <td>
              <span className="accuracy white">{fmt(review.accuracy.w)}</span>
            </td>
            <td>
              <span className="accuracy black">{fmt(review.accuracy.b)}</span>
            </td>
          </tr>
          {MOVE_CLASSES.map(({ cls, label, glyph, color }) =>
            review.counts.w[cls] + review.counts.b[cls] === 0 ? null : (
              <tr key={cls}>
                <td>
                  <span className="cls-glyph" style={{ background: color }}>
                    {glyph}
                  </span>
                  {label}
                </td>
                <td style={{ color }}>{review.counts.w[cls]}</td>
                <td style={{ color }}>{review.counts.b[cls]}</td>
              </tr>
            ),
          )}
        </tbody>
      </table>

      {move && <MoveFeedback move={move} onShowBest={(pv) => props.onPlayLine(move.index, pv)} />}

      <div className="action-row">
        <button className="btn secondary small-text" disabled={!prevError} onClick={() => prevError && props.onSelect(prevError.index + 1)}>
          ◀ Prev error
        </button>
        <button className="btn secondary small-text" disabled={!nextError} onClick={() => nextError && props.onSelect(nextError.index + 1)}>
          Next error ▶
        </button>
      </div>
      <button className="btn primary" disabled={retryCount === 0} onClick={props.onRetry}>
        {retryCount === 0 ? 'No mistakes to retry' : `Retry ${props.userColor === 'w' ? 'White' : 'Black'}'s mistakes (${retryCount})`}
      </button>
    </div>
  )
}

function MoveFeedback({ move, onShowBest }: { move: ReviewedMove; onShowBest: (pv: string[]) => void }) {
  const info = CLASS_INFO[move.cls]
  const showBest = move.bestSan && !['book', 'forced', 'best', 'great'].includes(move.cls)
  return (
    <div className="move-feedback">
      <span className="cls-glyph large" style={{ background: info.color }}>
        {info.glyph}
      </span>
      <span>
        <strong style={{ color: info.color }}>{move.san}</strong> {PHRASE[move.cls]}
        {move.loss >= 2 && <span className="muted"> (−{Math.round(move.loss)}% win chance)</span>}
        {showBest && (
          <>
            <br />
            Best was{' '}
            <button className="link-btn" onClick={() => onShowBest(move.bestPv ?? [move.bestUci!])}>
              {move.bestSan}
            </button>
          </>
        )}
      </span>
    </div>
  )
}

const fmt = (x: number | null) => (x === null ? '–' : x.toFixed(1))
