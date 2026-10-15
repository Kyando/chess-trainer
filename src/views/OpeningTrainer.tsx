import { Chess } from 'chess.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Color } from '../core/types'
import { db, type OpeningPosition } from '../data/db'
import { StockfishEngine } from '../engine/stockfish'
import { schedule, type Grade } from '../puzzles/srs'
import { winAfterMove } from '../review/runner'
import { useQuiz, type QuizItem, type QuizOutcome } from '../review/useQuiz'
import {
  analyzePosition,
  formatLine,
  frequentPositions,
  isLeak,
  loadRepertoire,
  OPENING_NODES,
  usualMove,
  type RepertoireNode,
} from '../train/openings'
import { Board, type Arrow } from '../ui/Board'
import { useWakeLock } from '../ui/useWakeLock'

/** Positions checked per "analyse" press. */
const BATCH = 30
const GRADE: Record<QuizOutcome, Grade | null> = { clean: 'good', solved: 'hard', shown: 'again', skipped: null }

type Item = OpeningPosition & QuizItem

/** Home card for the opening trainer. */
export function OpeningsCard({ onOpen }: { onOpen: () => void }) {
  const [stats, setStats] = useState<{ checked: number; leaks: number } | null>(null)
  useEffect(() => {
    void db.openings.toArray().then((all) => setStats({ checked: all.length, leaks: all.filter(isLeak).length }))
  }, [])
  return (
    <section className="review-panel">
      <div className="review-row">
        <span className="review-title">📖 Openings</span>
        {stats && stats.checked > 0 && (
          <span className="muted">
            {stats.leaks} leak{stats.leaks === 1 ? '' : 's'} in {stats.checked} positions
          </span>
        )}
      </div>
      <p className="muted">
        Your repertoire from your own games: the positions you reach most often, what you usually play there, and where
        the engine finds a better move. Then drill those spots.
      </p>
      <button className="btn primary" onClick={onOpen}>
        Open the opening trainer
      </button>
    </section>
  )
}

/** Opening trainer: repertoire check against the engine and a drill of my leaks. */
export function OpeningTrainer({ onExit }: { onExit: () => void }) {
  const [color, setColor] = useState<Color>('w')
  const [rep, setRep] = useState<{ color: Color; games: number; frequent: RepertoireNode[] } | null>(null)
  const [checked, setChecked] = useState<OpeningPosition[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const engineRef = useRef<StockfishEngine | null>(null)
  const stopRef = useRef(false)
  const engine = () => (engineRef.current ??= new StockfishEngine())
  useEffect(() => () => engineRef.current?.terminate(), [])
  useWakeLock(progress !== null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([loadRepertoire(db, color), db.openings.where('color').equals(color).toArray()]).then(([r, saved]) => {
      if (cancelled) return
      setRep({ color, games: r.games, frequent: frequentPositions(r.nodes) })
      setChecked(saved)
      setNow(Date.now())
    })
    return () => {
      cancelled = true
    }
  }, [color])

  const quiz = useQuiz<Item>(
    (fen, uci) => winAfterMove(engine(), fen, uci, OPENING_NODES),
    (item, outcome) => {
      const grade = GRADE[outcome]
      if (!grade) return
      const { due, interval, ease, reps, lapses, lastReview } = schedule(item, grade, Date.now())
      void db.openings.update(item.key, { due, interval, ease, reps, lapses, lastReview })
    },
  )

  const current = rep?.color === color ? rep : null
  const checkedKeys = useMemo(() => new Set(checked.map((c) => c.key)), [checked])
  const unchecked = current ? current.frequent.filter((n) => !checkedKeys.has(n.key)) : []
  const byCount = useMemo(() => [...checked].sort((a, b) => b.count - a.count), [checked])
  const leaks = byCount.filter(isLeak)
  const due = leaks.filter((l) => l.due <= now)

  const analyze = async () => {
    const batch = unchecked.slice(0, BATCH)
    stopRef.current = false
    setProgress({ done: 0, total: batch.length })
    await engine().newGame()
    for (let i = 0; i < batch.length && !stopRef.current; i++) {
      const pos = await analyzePosition(engine(), batch[i], color, Date.now())
      await db.openings.put(pos)
      setChecked((c) => [...c, pos])
      setProgress({ done: i + 1, total: batch.length })
    }
    setProgress(null)
  }

  const drill = (list: OpeningPosition[]) =>
    quiz.begin(
      list.map((p) => {
        const u = usualMove(p)!
        const chess = new Chess()
        let last
        for (const san of p.line) last = chess.move(san)
        return { ...p, playedUci: u.uci, winBefore: p.bestWin, lastMove: last ? ([last.from, last.to] as [string, string]) : undefined }
      }),
    )

  if (quiz.drill) {
    const d = quiz.drill
    const item = quiz.item
    const chess = new Chess(d.fen)
    const dests = new Map<string, string[]>()
    if (d.status === 'try') for (const m of chess.moves({ verbose: true })) dests.set(m.from, [...(dests.get(m.from) ?? []), m.to])
    const arrows: Arrow[] = quiz.hintSquare ? [{ from: quiz.hintSquare, brush: 'green' }] : []
    const usual = item && usualMove(item)
    const finished = d.status === 'right' || d.status === 'shown'
    return (
      <main className="layout">
        <section className="board-column">
          <div className="board-frame">
            <Board
              fen={d.fen}
              orientation={color === 'w' ? 'white' : 'black'}
              turnColor={chess.turn() === 'w' ? 'white' : 'black'}
              movableColor={d.status === 'try' ? (color === 'w' ? 'white' : 'black') : undefined}
              dests={dests}
              lastMove={d.lastMove}
              check={chess.inCheck()}
              arrows={arrows}
              onMove={(from, to) => void quiz.play(from + to)}
            />
          </div>
        </section>
        <aside className="side-panel">
          <div className="review-panel">
            {item && usual ? (
              <>
                <div className="review-title">
                  Opening leak {d.at + 1} / {d.items.length}
                </div>
                <p className="muted">{formatLine(item.line)} …</p>
                <p>
                  You usually play <strong>{usual.san}</strong> here ({usual.count} of {item.count} games, score {usual.score}%), giving
                  away {Math.round(usual.loss)}% win chance. <strong>Find a better move.</strong>
                </p>
                <div className={`retry-feedback ${d.status}`} aria-live="polite">
                  {d.message || ' '}
                </div>
                <div className="action-row">
                  {finished ? (
                    <button className="btn primary" onClick={quiz.next}>
                      {d.at + 1 < d.items.length ? 'Next ▶' : 'Finish'}
                    </button>
                  ) : (
                    <>
                      <button className="btn secondary small-text" onClick={quiz.showHint} disabled={d.hint || d.status === 'checking'}>
                        Hint
                      </button>
                      <button className="btn secondary small-text" onClick={quiz.showSolution} disabled={d.status === 'checking'}>
                        Show solution
                      </button>
                      <button className="btn secondary small-text" onClick={quiz.next}>
                        Skip
                      </button>
                    </>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="review-title">Drill done</div>
                <p className="retry-score">
                  {d.outcomes.filter((o) => o === 'clean').length} of {d.items.length} found on the first try
                </p>
                <p className="muted">Each leak comes back on a spaced schedule until the better move is automatic.</p>
              </>
            )}
            <button
              className="btn secondary small-text"
              onClick={() => {
                quiz.exit()
                setNow(Date.now())
                void db.openings.where('color').equals(color).toArray().then(setChecked)
              }}
            >
              {item ? '✕ End drill' : 'Done'}
            </button>
          </div>
        </aside>
      </main>
    )
  }

  return (
    <div className="games-view">
      <section className="review-panel">
        <div className="review-row">
          <span className="review-title">📖 Opening trainer</span>
          <button className="btn secondary small-text" onClick={onExit}>
            ← Back
          </button>
        </div>
        <div className="chip-row">
          {(['w', 'b'] as const).map((c) => (
            <button key={c} className={`chip${color === c ? ' selected' : ''}`} onClick={() => setColor(c)} disabled={!!progress}>
              As {c === 'w' ? 'White' : 'Black'}
            </button>
          ))}
        </div>
        {!current ? (
          <p className="muted">Reading your games…</p>
        ) : (
          <>
            <p className="muted">
              {current.frequent.length} positions you reached at least 4 times in the first 8 moves of your last {current.games} games ·{' '}
              {checked.length} checked by the engine.
            </p>
            {progress ? (
              <>
                <div className="progress">
                  <div className="progress-fill" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                </div>
                <div className="review-row">
                  <span className="muted">
                    Checking position {progress.done + 1} of {progress.total}…
                  </span>
                  <button className="btn secondary small-text" onClick={() => (stopRef.current = true)}>
                    Stop
                  </button>
                </div>
              </>
            ) : (
              unchecked.length > 0 && (
                <button className="btn secondary" onClick={() => void analyze()}>
                  Check the next {Math.min(BATCH, unchecked.length)} most common positions (~{Math.ceil(Math.min(BATCH, unchecked.length) * 1.3)} s on a laptop)
                </button>
              )
            )}
            <button className="btn primary" disabled={!leaks.length || !!progress} onClick={() => drill(due.length ? due : leaks)}>
              {leaks.length ? `Drill ${due.length || leaks.length} leak${(due.length || leaks.length) === 1 ? '' : 's'}` : 'No leaks found yet'}
            </button>
          </>
        )}
      </section>

      {byCount.length > 0 && (
        <section className="review-panel">
          <div className="review-title">Your most common positions</div>
          <ul className="opening-list">
            {byCount.slice(0, 40).map((p) => {
              const u = usualMove(p)
              const leak = isLeak(p)
              return (
                <li key={p.key} className={leak ? 'leak' : ''}>
                  <span className="opening-line">{p.line.length ? formatLine(p.line) : 'Start'} …</span>
                  <span>
                    {leak ? '⚠' : '✓'} you play <strong>{u?.san}</strong> ({u?.count}/{p.count}, {u?.score}%)
                    {leak && (
                      <span className="muted">
                        {' '}
                        · −{Math.round(u!.loss)}% · better {p.bestSan}
                      </span>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
