import { Chess } from 'chess.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MoveTree } from '../core/tree'
import type { Color } from '../core/types'
import { db } from '../data/db'
import { pvToSan } from '../engine/eval'
import { StockfishEngine } from '../engine/stockfish'
import { THEME_LABELS, type Puzzle, type Theme } from '../puzzles/extract'
import { scanGame, unscannedGames } from '../puzzles/scan'
import { MASTERED_DAYS, schedule, type Grade } from '../puzzles/srs'
import { CLASS_INFO } from '../review/review'
import { REVIEW_NODES, winAfterMove } from '../review/runner'
import { useQuiz, type QuizOutcome } from '../review/useQuiz'
import { Board, type Arrow } from '../ui/Board'
import { useWakeLock } from '../ui/useWakeLock'
import { TacticsCard, TacticsSession, type TacticsChoice } from './TacticsTrainer'

/** Puzzles per training session. */
const SESSION = 15
/** Games per "scan" press. */
const SCAN_BATCH = 20

const GRADE: Record<QuizOutcome, Grade | null> = { clean: 'good', solved: 'hard', shown: 'again', skipped: null }

interface Props {
  active: boolean
  /** Scanning pauses between games while this is true (e.g. during a game vs the bot). */
  paused: boolean
  onOpenGame: (tree: MoveTree, orientation: Color, position: number) => void
}

interface ScanProgress {
  done: number
  total: number
  /** Progress through the current game, 0–1. */
  game: number
  label: string
  found: number
}

/** Puzzles made from my own mistakes, trained with spaced repetition. */
export function PuzzlesView({ active, paused, onOpenGame }: Props) {
  const [puzzles, setPuzzles] = useState<Puzzle[] | null>(null)
  const [unscanned, setUnscanned] = useState<number | null>(null)
  const [scan, setScan] = useState<ScanProgress | null>(null)
  const [scanResult, setScanResult] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [tactics, setTactics] = useState<TacticsChoice | null>(null)
  const engineRef = useRef<StockfishEngine | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const pausedRef = useRef(paused)
  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  const engine = () => (engineRef.current ??= new StockfishEngine())
  useEffect(() => () => engineRef.current?.terminate(), [])
  useWakeLock(scan !== null)

  const reload = useCallback(
    () =>
      Promise.all([db.puzzles.toArray(), unscannedGames(db)]).then(([all, pending]) => {
        setPuzzles(all)
        setUnscanned(pending.length)
        setNow(Date.now())
      }),
    [],
  )

  // Refresh when the tab is opened: games may have been imported meanwhile.
  useEffect(() => {
    if (!active) return
    void Promise.all([db.puzzles.toArray(), unscannedGames(db)]).then(([all, pending]) => {
      setPuzzles(all)
      setUnscanned(pending.length)
      setNow(Date.now())
    })
  }, [active])

  const quiz = useQuiz<Puzzle>(
    (fen, uci) => winAfterMove(engine(), fen, uci, REVIEW_NODES),
    (item, outcome) => {
      const grade = GRADE[outcome]
      if (!grade) return
      const { due, interval, ease, reps, lapses, lastReview } = schedule(item, grade, Date.now())
      void db.puzzles.update(item.id, { due, interval, ease, reps, lapses, lastReview })
    },
  )
  const drill = quiz.drill
  const item = quiz.item

  const startSession = (pick: (p: Puzzle) => boolean, order: (a: Puzzle, b: Puzzle) => number) => {
    const list = (puzzles ?? []).filter(pick).sort(order).slice(0, SESSION)
    quiz.begin(list)
  }

  const runScan = async () => {
    const games = (await unscannedGames(db)).slice(0, SCAN_BATCH)
    if (!games.length) return
    const abort = new AbortController()
    abortRef.current = abort
    setScanResult(null)
    let found = 0
    let done = 0
    try {
      for (const g of games) {
        while (pausedRef.current && !abort.signal.aborted) await new Promise((r) => setTimeout(r, 1000))
        if (abort.signal.aborted) break
        const opp = g.userColor === 'w' ? g.black.name : g.white.name
        const label = `vs ${opp} · ${new Date(g.endTime).toLocaleDateString()}`
        setScan({ done, total: games.length, game: 0, label, found })
        try {
          found += await scanGame(engine(), db, g, {
            signal: abort.signal,
            onProgress: (f) => setScan((s) => s && { ...s, game: f }),
          })
        } catch (e) {
          if (abort.signal.aborted) break
          await db.scans.put({ gameId: g.id, scannedAt: Date.now(), puzzles: 0, error: e instanceof Error ? e.message : String(e) })
        }
        done++
      }
    } finally {
      abortRef.current = null
      setScan(null)
      setScanResult(`Scanned ${done} game${done === 1 ? '' : 's'} · ${found} new puzzle${found === 1 ? '' : 's'}`)
      void reload()
    }
  }

  const stats = useMemo(() => {
    const list = puzzles ?? []
    const themes = new Map<Theme, number>()
    for (const p of list) for (const t of p.themes) themes.set(t, (themes.get(t) ?? 0) + 1)
    return {
      total: list.length,
      due: list.filter((p) => p.due <= now).length,
      fresh: list.filter(isNew).length,
      mastered: list.filter((p) => p.interval >= MASTERED_DAYS).length,
      nextDue: Math.min(...list.map((p) => p.due)),
      themes: [...themes].sort((a, b) => b[1] - a[1]),
    }
  }, [puzzles, now])

  if (tactics) return <TacticsSession choice={tactics} onExit={() => setTactics(null)} />

  if (drill) {
    const color = item?.color ?? drill.items[0].color
    const chess = new Chess(drill.fen)
    const dests = new Map<string, string[]>()
    if (drill.status === 'try') for (const m of chess.moves({ verbose: true })) dests.set(m.from, [...(dests.get(m.from) ?? []), m.to])
    const arrows: Arrow[] = quiz.hintSquare ? [{ from: quiz.hintSquare, brush: 'green' }] : []
    return (
      <main className="layout">
        <section className="board-column">
          <div className="board-frame">
            <Board
              fen={drill.fen}
              orientation={color === 'w' ? 'white' : 'black'}
              turnColor={chess.turn() === 'w' ? 'white' : 'black'}
              movableColor={drill.status === 'try' ? (color === 'w' ? 'white' : 'black') : undefined}
              dests={dests}
              lastMove={drill.lastMove}
              check={chess.inCheck()}
              arrows={arrows}
              onMove={(from, to) => void quiz.play(from + to)}
            />
          </div>
        </section>
        <aside className="side-panel">
          {item ? (
            <PuzzlePanel
              item={item}
              status={drill.status}
              message={drill.message}
              at={drill.at}
              total={drill.items.length}
              hint={drill.hint}
              onHint={quiz.showHint}
              onSolution={quiz.showSolution}
              onNext={quiz.next}
              onExit={() => {
                quiz.exit()
                void reload()
              }}
              onOpenGame={async () => {
                const stored = await db.pgns.get(item.gameId)
                if (!stored) return
                quiz.exit()
                void reload()
                // Land on my move, where the review shows what was better.
                onOpenGame(MoveTree.fromPgn(stored.pgn), item.color, item.index + 1)
              }}
            />
          ) : (
            <div className="review-panel">
              <div className="review-title">Session done</div>
              <p className="retry-score">
                {drill.outcomes.filter((o) => o === 'clean').length} of {drill.items.length} solved on the first try
              </p>
              <p className="muted">
                Missed ones come back in 10 minutes; solved ones in a day or more, spaced further each time.
              </p>
              <button
                className="btn primary"
                onClick={() => {
                  quiz.exit()
                  void reload()
                }}
              >
                Done
              </button>
            </div>
          )}
        </aside>
      </main>
    )
  }

  return (
    <div className="games-view puzzles-view">
      <section className="review-panel">
        <div className="review-title">🧩 Puzzles from your games</div>
        <p className="muted">
          Every mistake and blunder you made in a game you could still play for becomes a puzzle: find the move you missed.
          Solved puzzles come back after 1, 3, 8… days; missed ones sooner.
        </p>
        {puzzles && (
          <div className="puzzle-stats">
            <Stat value={stats.due} label="due now" accent />
            <Stat value={stats.fresh} label="new" />
            <Stat value={stats.total - stats.fresh - stats.mastered} label="learning" />
            <Stat value={stats.mastered} label="mastered" />
          </div>
        )}
        <button
          className="btn primary"
          disabled={stats.due === 0}
          onClick={() =>
            // Puzzles already seen first (oldest due first), then new ones from the latest games.
            startSession(
              (p) => p.due <= now,
              (a, b) => Number(isNew(a)) - Number(isNew(b)) || (isNew(a) ? b.gameEnd - a.gameEnd : a.due - b.due),
            )
          }
        >
          {stats.due > 0
            ? `Solve ${Math.min(stats.due, SESSION)} puzzle${stats.due === 1 ? '' : 's'}`
            : stats.total
              ? `Nothing due — next in ${formatWait(stats.nextDue - now)}`
              : 'No puzzles yet — scan your games below'}
        </button>
      </section>

      {stats.themes.length > 0 && (
        <section className="review-panel">
          <div className="review-title">Practice a theme</div>
          <div className="chip-row">
            {stats.themes.map(([theme, n]) => (
              <button
                key={theme}
                className="chip small"
                onClick={() => startSession((p) => p.themes.includes(theme), (a, b) => a.due - b.due)}
              >
                {THEME_LABELS[theme]} · {n}
              </button>
            ))}
          </div>
        </section>
      )}

      <TacticsCard ownThemes={stats.themes} onStart={setTactics} />

      <section className="review-panel">
        <div className="review-title">Find puzzles</div>
        <p className="muted">
          Runs Stockfish over your games, newest first (about 5 s per game on a laptop, longer on a phone; the screen stays
          on). Games you scan also open with their Game Review ready.
        </p>
        {scan ? (
          <>
            <div className="progress">
              <div className="progress-fill" style={{ width: `${((scan.done + scan.game) / scan.total) * 100}%` }} />
            </div>
            <div className="review-row">
              <span className="muted">
                {paused ? 'Paused while you play · ' : ''}Game {scan.done + 1}/{scan.total} {scan.label} · {scan.found} found
              </span>
              <button className="btn secondary small-text" onClick={() => abortRef.current?.abort()}>
                Stop
              </button>
            </div>
          </>
        ) : (
          <button className="btn secondary" disabled={!unscanned} onClick={() => void runScan()}>
            {unscanned === null
              ? '…'
              : unscanned === 0
                ? 'All games scanned — import more on the Games tab'
                : `Scan the next ${Math.min(SCAN_BATCH, unscanned)} games (${unscanned} left)`}
          </button>
        )}
        {scanResult && <div className="status">{scanResult}</div>}
      </section>
    </div>
  )
}

const isNew = (p: Puzzle) => !p.lastReview

function Stat({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  return (
    <div className={`puzzle-stat${accent ? ' accent' : ''}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function formatWait(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.round(min / 60)
  return h < 24 ? `${h} h` : `${Math.round(h / 24)} d`
}

interface PanelProps {
  item: Puzzle
  status: string
  message: string
  at: number
  total: number
  hint: boolean
  onHint: () => void
  onSolution: () => void
  onNext: () => void
  onExit: () => void
  onOpenGame: () => void
}

function PuzzlePanel(p: PanelProps) {
  const { item } = p
  const side = item.color === 'w' ? 'White' : 'Black'
  const done = p.status === 'right' || p.status === 'shown'
  const info = CLASS_INFO[item.cls]
  const line = done ? pvToSan(item.fen, item.pv, 8) : []
  return (
    <div className="review-panel">
      <div className="review-row">
        <span className="review-title">
          Puzzle {p.at + 1} / {p.total}
        </span>
        <span className="muted">{isNew(item) ? 'new' : item.interval ? `review · ${item.interval} d` : 'learning'}</span>
      </div>
      <p className="muted">
        Your game vs {item.opponent} · {new Date(item.gameEnd).toLocaleDateString()}
      </p>
      <p>
        <strong>Find the best move for {side}.</strong>
      </p>
      <div className={`retry-feedback ${p.status}`} aria-live="polite">
        {p.status === 'right' && '✓ '}
        {p.status === 'wrong' && '✗ '}
        {p.message || ' '}
      </div>
      {done && (
        <div className="move-feedback">
          <span className="cls-glyph large" style={{ background: info.color }}>
            {info.glyph}
          </span>
          <span>
            In the game you played <strong style={{ color: info.color }}>{item.playedSan}</strong> — a{' '}
            {info.label.toLowerCase()} (−{item.loss}% win chance).
            <br />
            <span className="muted">Line: {line.map((m) => m.san).join(' ')}</span>
            <br />
            <span className="muted">{item.themes.map((t) => THEME_LABELS[t]).join(' · ')}</span>
          </span>
        </div>
      )}
      <div className="action-row">
        {done ? (
          <>
            <button className="btn primary" onClick={p.onNext}>
              {p.at + 1 < p.total ? 'Next ▶' : 'Finish'}
            </button>
            <button className="btn secondary small-text" onClick={p.onOpenGame}>
              Open game
            </button>
          </>
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
        ✕ End session
      </button>
    </div>
  )
}
