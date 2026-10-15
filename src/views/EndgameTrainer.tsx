import { Chess } from 'chess.js'
import { useEffect, useRef, useState } from 'react'
import { db } from '../data/db'
import { StockfishEngine } from '../engine/stockfish'
import {
  DRILL_NODES,
  drillColor,
  GOAL_TEXT,
  playDrillMove,
  readDrillProgress,
  saveDrillResult,
  STANDARD_DRILLS,
  wonEndgamesFromGames,
  type DrillVerdict,
  type EndgameDrill,
} from '../train/endgames'
import { Board, type Arrow } from '../ui/Board'
import { playSound } from '../ui/sounds'

/** Home card for endgame drills. */
export function EndgamesCard({ onOpen }: { onOpen: () => void }) {
  const progress = readDrillProgress()
  const solved = STANDARD_DRILLS.filter((d) => progress[d.id]?.solved).length
  return (
    <section className="review-panel">
      <div className="review-row">
        <span className="review-title">♔ Endgames</span>
        <span className="muted">
          {solved}/{STANDARD_DRILLS.length} classics solved
        </span>
      </div>
      <p className="muted">
        Play key endings against Stockfish’s best defence — basic mates, king and pawn, Lucena and Philidor — and replay
        won endgames from your own games that slipped away.
      </p>
      <button className="btn primary" onClick={onOpen}>
        Open endgame drills
      </button>
    </section>
  )
}

/** List of drills, and the drill board once one is picked. */
export function EndgameTrainer({ onExit }: { onExit: () => void }) {
  const [drill, setDrill] = useState<EndgameDrill | null>(null)
  const [mine, setMine] = useState<EndgameDrill[] | null>(null)
  const [progress, setProgress] = useState(readDrillProgress)

  useEffect(() => {
    void wonEndgamesFromGames(db).then(setMine)
  }, [])

  if (drill) {
    return (
      <DrillBoard
        drill={drill}
        onExit={() => {
          setDrill(null)
          setProgress(readDrillProgress())
        }}
      />
    )
  }

  const row = (d: EndgameDrill) => {
    const p = progress[d.id]
    return (
      <li key={d.id}>
        <button className="drill-row" onClick={() => setDrill(d)}>
          <span className="drill-status">{p?.solved ? '✓' : p?.tries ? '·' : ''}</span>
          <span className="drill-main">
            <strong>{d.title}</strong>
            <span className="muted">
              {GOAL_TEXT[d.goal]} · {d.goal === 'draw' ? `${d.moveLimit} moves` : `within ${d.moveLimit} moves`}
              {d.source ? ` · ${d.source}` : ''}
              {p?.best ? ` · best ${p.best}` : ''}
            </span>
          </span>
        </button>
      </li>
    )
  }

  return (
    <div className="games-view">
      <section className="review-panel">
        <div className="review-row">
          <span className="review-title">♔ Endgame drills</span>
          <button className="btn secondary small-text" onClick={onExit}>
            ← Back
          </button>
        </div>
        <ul className="drill-list">{STANDARD_DRILLS.map(row)}</ul>
      </section>
      <section className="review-panel">
        <div className="review-title">Won endgames from your games</div>
        {mine === null ? (
          <p className="muted">Looking through your reviewed games…</p>
        ) : mine.length === 0 ? (
          <p className="muted">None found yet — scan more games in “Your puzzles” to find endgames you let slip.</p>
        ) : (
          <ul className="drill-list">{mine.map(row)}</ul>
        )}
      </section>
    </div>
  )
}

interface Play {
  fen: string
  /** Positions before each of my moves, for takebacks. */
  history: string[]
  lastMove?: [string, string]
  myMoves: number
  thinking: boolean
  myWin?: number
  verdict?: DrillVerdict
}

function DrillBoard({ drill, onExit }: { drill: EndgameDrill; onExit: () => void }) {
  const me = drillColor(drill)
  const start = (): Play => ({ fen: drill.fen, history: [], myMoves: 0, thinking: false })
  const [play, setPlay] = useState<Play>(start)
  const [hint, setHint] = useState<string | null>(null)
  const engineRef = useRef<StockfishEngine | null>(null)
  const token = useRef(0)
  const engine = () => (engineRef.current ??= new StockfishEngine())
  useEffect(() => () => engineRef.current?.terminate(), [])

  const finish = (p: Play, verdict: DrillVerdict) => {
    saveDrillResult(drill.id, !!verdict.success, p.myMoves)
    playSound('end')
    setPlay({ ...p, thinking: false, verdict })
  }

  const onMove = async (from: string, to: string) => {
    if (play.thinking || play.verdict) return
    const mine = ++token.current
    setHint(null)
    setPlay((p) => ({ ...p, thinking: true }))
    const started = performance.now()
    const step = await playDrillMove(engine(), drill, play.fen, play.myMoves, from, to)
    if (mine !== token.current) return
    if (!step) return setPlay((p) => ({ ...p, thinking: false }))
    playSound(step.captured ? 'capture' : 'move')
    const after: Play = {
      ...play,
      fen: step.afterMine,
      history: [...play.history, play.fen],
      lastMove: [from, to],
      myMoves: play.myMoves + 1,
      thinking: !!step.reply,
      myWin: step.myWin ?? play.myWin,
    }
    if (!step.reply) return finish(after, step.verdict)
    setPlay(after)
    // Show my move for a moment before the engine's answer.
    await new Promise((r) => setTimeout(r, Math.max(0, 350 - (performance.now() - started))))
    if (mine !== token.current) return
    const { reply } = step
    playSound(reply.captured ? 'capture' : 'move')
    const next: Play = { ...after, fen: reply.fen, lastMove: [reply.from, reply.to], thinking: false }
    if (step.verdict.done) return finish(next, step.verdict)
    setPlay(next)
  }

  const takeback = () => {
    token.current++
    setHint(null)
    setPlay((p) => {
      if (!p.history.length) return p
      const fen = p.history[p.history.length - 1]
      return { ...p, fen, history: p.history.slice(0, -1), lastMove: undefined, myMoves: p.myMoves - 1, thinking: false, verdict: undefined }
    })
  }

  const retry = () => {
    token.current++
    setHint(null)
    setPlay(start())
  }

  const showHint = async () => {
    const mine = token.current
    const { bestmove } = await engine().search(play.fen, { nodes: DRILL_NODES, multipv: 1 })
    if (mine === token.current) setHint(bestmove)
  }

  const chess = new Chess(play.fen)
  const myTurn = chess.turn() === me && !play.thinking && !play.verdict
  const dests = new Map<string, string[]>()
  if (myTurn) for (const m of chess.moves({ verbose: true })) dests.set(m.from, [...(dests.get(m.from) ?? []), m.to])
  const arrows: Arrow[] = hint ? [{ from: hint.slice(0, 2), to: hint.slice(2, 4), brush: 'green' }] : []
  const side = me === 'w' ? 'White' : 'Black'
  const left = drill.moveLimit - play.myMoves

  return (
    <main className="layout">
      <section className="board-column">
        <div className="board-frame">
          <Board
            fen={play.fen}
            orientation={me === 'w' ? 'white' : 'black'}
            turnColor={chess.turn() === 'w' ? 'white' : 'black'}
            movableColor={myTurn ? (me === 'w' ? 'white' : 'black') : undefined}
            dests={dests}
            lastMove={play.lastMove}
            check={chess.inCheck()}
            arrows={arrows}
            premoves={false}
            onMove={(from, to) => void onMove(from, to)}
          />
        </div>
      </section>
      <aside className="side-panel">
        <div className="review-panel">
          <div className="review-row">
            <span className="review-title">{drill.title}</span>
            <span className="muted">
              {drill.goal === 'draw' ? `survive ${Math.max(0, left)} more` : `${Math.max(0, left)} moves left`}
            </span>
          </div>
          <p>
            <strong>
              {GOAL_TEXT[drill.goal]} as {side}
            </strong>{' '}
            <span className="muted">— Stockfish defends.</span>
          </p>
          <p className="muted hint">{drill.tip}</p>
          <div className={`retry-feedback ${play.verdict ? (play.verdict.success ? 'right' : 'wrong') : 'checking'}`} aria-live="polite">
            {play.verdict
              ? `${play.verdict.success ? '✓' : '✗'} ${play.verdict.message}`
              : play.thinking
                ? 'Stockfish is thinking…'
                : play.myWin !== undefined
                  ? `Your winning chances: ${Math.round(play.myWin)}%`
                  : 'Your move.'}
          </div>
          <div className="action-row">
            <button className="btn secondary small-text" onClick={() => void showHint()} disabled={!myTurn}>
              Hint
            </button>
            <button className="btn secondary small-text" onClick={takeback} disabled={!play.history.length}>
              ↶ Takeback
            </button>
            <button className={`btn ${play.verdict ? 'primary' : 'secondary'} small-text`} onClick={retry}>
              ⟲ Retry
            </button>
          </div>
          <button className="btn secondary small-text" onClick={onExit}>
            ← All drills
          </button>
        </div>
      </aside>
    </main>
  )
}
