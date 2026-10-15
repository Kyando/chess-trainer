import { Chess } from 'chess.js'
import { useEffect, useState } from 'react'
import { db, type TacticProgress } from '../data/db'
import { THEME_LABELS, type Theme } from '../puzzles/extract'
import {
  loadLichessPuzzles,
  pickTactics,
  readTacticsRating,
  recordAttempt,
  saveTacticsRating,
  TACTIC_LABEL,
  TACTIC_THEMES,
  THEME_TO_TACTICS,
  updateRating,
  type LichessPuzzle,
  type LineOutcome,
} from '../train/lichess'
import { useLinePuzzle } from '../train/useLinePuzzle'
import { Board, type Arrow } from '../ui/Board'

const SESSION = 10
const RESULT: Record<LineOutcome, number | null> = { clean: 1, solved: 0.5, shown: 0, skipped: null }

export interface TacticsChoice {
  themes: string[] | null
  label: string
}

/** Home card: tactics rating, reviews due, themes recommended from my own errors. */
export function TacticsCard({ ownThemes, onStart }: { ownThemes: [Theme, number][]; onStart: (c: TacticsChoice) => void }) {
  const [due, setDue] = useState<number | null>(null)
  const [rating] = useState(readTacticsRating)
  useEffect(() => {
    void db.tactics.where('due').belowOrEqual(Date.now()).count().then(setDue)
  }, [])

  // My most frequent error themes that have matching lichess drills.
  const recommended = ownThemes
    .filter(([t]) => THEME_TO_TACTICS[t].length)
    .slice(0, 3)
    .map(([t, n]) => ({ label: THEME_LABELS[t], n, tags: THEME_TO_TACTICS[t] }))

  return (
    <section className="review-panel">
      <div className="review-row">
        <span className="review-title">⚔ Tactics</span>
        <span className="muted">
          Rating {rating}
          {due ? ` · ${due} to review` : ''}
        </span>
      </div>
      <p className="muted">
        Puzzles from the lichess database (CC0), picked near your tactics rating. Missed ones come back for review.
      </p>
      <button className="btn primary" onClick={() => onStart({ themes: null, label: 'Mixed tactics' })}>
        Solve {SESSION} mixed puzzles
      </button>
      {recommended.length > 0 && (
        <>
          <div className="muted hint">For the errors in your games:</div>
          <div className="chip-row">
            {recommended.map((r) => (
              <button key={r.label} className="chip small selected" onClick={() => onStart({ themes: r.tags, label: r.label })}>
                {r.label} · {r.n} in your games
              </button>
            ))}
          </div>
        </>
      )}
      <div className="chip-row">
        {TACTIC_THEMES.map((t) => (
          <button key={t.tag} className="chip small" onClick={() => onStart({ themes: [t.tag], label: t.label })}>
            {t.label}
          </button>
        ))}
      </div>
    </section>
  )
}

/** A session of lichess puzzles, solved move by move. */
export function TacticsSession({ choice, onExit }: { choice: TacticsChoice; onExit: () => void }) {
  const [rating, setRating] = useState(readTacticsRating)
  const [startRating] = useState(rating)
  const [error, setError] = useState<string | null>(null)
  const line = useLinePuzzle<LichessPuzzle>((puzzle, outcome) => {
    const result = RESULT[outcome]
    if (result === null) return
    setRating((r) => {
      const next = updateRating(r, puzzle.rating, result)
      saveTacticsRating(next)
      return next
    })
    void db.tactics.get(puzzle.id).then((prev) => db.tactics.put(recordAttempt(prev, puzzle, outcome, Date.now())))
  })
  const { state, item } = line

  // Load the set and pick a session once.
  const begin = line.begin
  useEffect(() => {
    let cancelled = false
    Promise.all([loadLichessPuzzles(), db.tactics.toArray()])
      .then(([all, progress]) => {
        if (cancelled) return
        const map = new Map<string, TacticProgress>(progress.map((p) => [p.id, p]))
        const picked = pickTactics(all, map, { themes: choice.themes, rating: readTacticsRating(), size: SESSION, now: Date.now() })
        if (picked.length) begin(picked)
        else setError('No puzzles left for this theme.')
      })
      .catch(() => !cancelled && setError('Could not load the puzzle set (offline before first load?).'))
    return () => {
      cancelled = true
    }
    // begin is recreated each render; the session starts once per choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice])

  if (error || !state) {
    return (
      <div className="games-view">
        <section className="review-panel">
          <div className="review-title">{choice.label}</div>
          <p className="muted">{error ?? 'Loading puzzles…'}</p>
          <button className="btn secondary" onClick={onExit}>
            Back
          </button>
        </section>
      </div>
    )
  }

  const puzzle = item ?? state.items[0]
  const myColor = puzzle.fen.split(' ')[1] === 'w' ? 'b' : 'w'
  const chess = new Chess(state.fen)
  const dests = new Map<string, string[]>()
  if (state.status === 'try') for (const m of chess.moves({ verbose: true })) dests.set(m.from, [...(dests.get(m.from) ?? []), m.to])
  const arrows: Arrow[] = line.hintSquare ? [{ from: line.hintSquare, brush: 'green' }] : []
  const done = state.status === 'right' || state.status === 'shown'
  const exit = () => {
    line.exit()
    onExit()
  }

  return (
    <main className="layout">
      <section className="board-column">
        <div className="board-frame">
          <Board
            fen={state.fen}
            orientation={myColor === 'w' ? 'white' : 'black'}
            turnColor={chess.turn() === 'w' ? 'white' : 'black'}
            movableColor={state.status === 'try' ? (myColor === 'w' ? 'white' : 'black') : undefined}
            dests={dests}
            lastMove={state.lastMove}
            check={chess.inCheck()}
            arrows={arrows}
            onMove={(from, to) => line.play(from + to)}
          />
        </div>
      </section>
      <aside className="side-panel">
        {item ? (
          <div className="review-panel">
            <div className="review-row">
              <span className="review-title">
                {choice.label} · {state.at + 1} / {state.items.length}
              </span>
              <span className="muted">Rating {rating}</span>
            </div>
            <p>
              <strong>{state.status === 'intro' ? 'Watch the opponent’s move…' : `Find the best move for ${myColor === 'w' ? 'White' : 'Black'}.`}</strong>
            </p>
            <div className={`retry-feedback ${state.status === 'right' ? 'right' : state.status === 'wrong' ? 'wrong' : 'shown'}`} aria-live="polite">
              {state.message || ' '}
            </div>
            {done && (
              <p className="muted">
                Puzzle rated {puzzle.rating} · {puzzle.themes.map((t) => TACTIC_LABEL[t]).filter(Boolean).join(' · ')} ·{' '}
                <a href={`https://lichess.org/training/${puzzle.id}`} target="_blank" rel="noreferrer">
                  lichess
                </a>
              </p>
            )}
            <div className="action-row">
              {done ? (
                <button className="btn primary" onClick={line.next}>
                  {state.at + 1 < state.items.length ? 'Next ▶' : 'Finish'}
                </button>
              ) : (
                <>
                  <button className="btn secondary small-text" onClick={line.showHint} disabled={state.hint || state.status !== 'try'}>
                    Hint
                  </button>
                  <button className="btn secondary small-text" onClick={line.showSolution} disabled={state.status !== 'try' && state.status !== 'wrong'}>
                    Show solution
                  </button>
                  <button className="btn secondary small-text" onClick={line.next}>
                    Skip
                  </button>
                </>
              )}
            </div>
            <button className="btn secondary small-text" onClick={exit}>
              ✕ End session
            </button>
          </div>
        ) : (
          <div className="review-panel">
            <div className="review-title">Session done</div>
            <p className="retry-score">
              {state.outcomes.filter((o) => o === 'clean').length} of {state.items.length} solved on the first try
            </p>
            <p className="muted">
              Tactics rating {startRating} → <strong>{rating}</strong>. Missed puzzles come back in 10 minutes, then spaced out.
            </p>
            <button className="btn primary" onClick={exit}>
              Done
            </button>
          </div>
        )}
      </aside>
    </main>
  )
}
