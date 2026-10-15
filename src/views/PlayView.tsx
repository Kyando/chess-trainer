import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { describeResult, GameSession, resultTag } from '../core/game'
import { materialSummary } from '../core/material'
import { opposite, type Color, type PromotionPiece } from '../core/types'
import { botLevel, chooseBotMove, thinkDelayMs } from '../engine/bot'
import { StockfishEngine } from '../engine/stockfish'
import { uciToIntent } from '../engine/uci'
import { Board, type Arrow } from '../ui/Board'
import { MoveList } from '../ui/MoveList'
import type { GameSettings } from '../core/settings'
import { NewGameDialog } from '../ui/NewGameDialog'
import { PlayerBar } from '../ui/PlayerBar'
import { PromotionDialog } from '../ui/PromotionDialog'
import { playSound, soundForMove } from '../ui/sounds'
import { useWakeLock } from '../ui/useWakeLock'
import { MoveTree, START_FEN } from '../core/tree'
import { db, saveGames, type TimeClass } from '../data/db'
import { detectOpening, loadOpenings } from '../core/openings'
import { threatDests } from '../engine/threat'
import { useThreatCheck } from '../play/useThreatCheck'
import { ThreatCheckPanel } from '../ui/ThreatCheckPanel'

const SETTINGS_KEY = 'chess-trainer.settings'
const DEFAULT_SETTINGS: GameSettings = { timeControl: { initial: 300, increment: 0 }, color: 'w', botLevel: 3 }
const LOW_TIME_MS = 10_000

function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    /* storage unavailable: use defaults */
  }
  return DEFAULT_SETTINGS
}

function saveSettings(s: GameSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

/** chess.com's buckets by estimated game length (base + 40 × increment). */
function timeClassOf(tc: { initial: number; increment: number } | null): TimeClass {
  if (!tc) return 'rapid'
  const estimate = tc.initial + 40 * tc.increment
  return estimate < 180 ? 'bullet' : estimate < 600 ? 'blitz' : 'rapid'
}

const colorName = (c: Color) => (c === 'w' ? 'white' : 'black')

interface Props {
  /** Whether this view is on screen (keyboard shortcuts only apply then). */
  active: boolean
  /** Opens a finished game in the analysis board. */
  onAnalyze: (tree: MoveTree, orientation: Color) => void
}

export function PlayView({ active, onAnalyze }: Props) {
  const [settings, setSettings] = useState(loadSettings)
  const [session, setSession] = useState(() => new GameSession({ timeControl: settings.timeControl }))
  const [playerColor, setPlayerColor] = useState<Color>('w')
  const [orientation, setOrientation] = useState<Color>('w')
  const [showNewGame, setShowNewGame] = useState(true)
  const [viewPly, setViewPly] = useState<number | null>(null) // null = following the live game
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(null)
  const [showResult, setShowResult] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [started, setStarted] = useState(false)
  const [confirmResign, setConfirmResign] = useState(false)
  const [, rerender] = useReducer((x: number) => x + 1, 0)
  const [boardSync, resyncBoard] = useReducer((x: number) => x + 1, 0)

  const engineRef = useRef<StockfishEngine | null>(null)
  const botToken = useRef(0) // bumps to invalidate an in-flight bot move
  const lowTimeWarned = useRef(false)
  const { check: threatCheck, score: threatScore, ask: askThreat, answer: answerThreat, clear: clearThreat, reset: resetThreat } =
    useThreatCheck(engineRef)
  const blunderCheck = !!settings.blunderCheck

  useEffect(() => {
    const engine = new StockfishEngine()
    engineRef.current = engine
    return () => engine.terminate()
  }, [])

  // React to game events: sounds, result dialog, re-render.
  useEffect(() => {
    return session.subscribe((event) => {
      if (event.type === 'move') playSound(soundForMove(event.move))
      if (event.type === 'end') {
        playSound('end')
        setShowResult(true)
      }
      setViewPly(null)
      rerender()
    })
  }, [session])

  const history = session.history
  const level = botLevel(settings.botLevel)
  const botColor = opposite(playerColor)
  const gameActive = started && !session.isOver
  const clockRunning = gameActive && session.clock?.activeColor != null

  useWakeLock(gameActive)

  // Clock tick: re-render ~10x/s, detect flags and warn on low time.
  useEffect(() => {
    if (!clockRunning) return
    const id = setInterval(() => {
      if (session.checkFlag()) return
      const mine = session.clock!.timeLeft(playerColor)
      if (mine < LOW_TIME_MS && !lowTimeWarned.current && session.turn === playerColor) {
        lowTimeWarned.current = true
        playSound('lowtime')
      }
      rerender()
    }, 100)
    return () => clearInterval(id)
  }, [clockRunning, session, playerColor])

  // Bot moves whenever it is its turn.
  const ply = history.length
  useEffect(() => {
    const engine = engineRef.current
    if (!started || !engine || session.isOver || session.turn !== botColor) return
    const token = ++botToken.current
    setThinking(true)
    const fen = session.fen
    const delay = thinkDelayMs(session.clock ? session.clock.timeLeft(botColor) : null, ply)
    const startedAt = performance.now()
    chooseBotMove(engine, fen, level).then((uci) => {
      const wait = Math.max(0, delay - (performance.now() - startedAt))
      setTimeout(() => {
        if (token !== botToken.current) return
        setThinking(false)
        if (!uci || session.fen !== fen) return
        const move = session.move(uciToIntent(uci))
        // Blunder check: ask about the threat, except after a capture (recapturing
        // comes first) or a check (the threat is obvious).
        if (move && blunderCheck && !session.isOver && !move.captured && !session.chess.inCheck()) askThreat(session.fen)
      }, wait)
    })
    // askThreat is stable; blunderCheck only changes when a new game starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ply, session, botColor, level, started])

  const startGame = useCallback((s: GameSettings) => {
    saveSettings(s)
    setSettings(s)
    const color: Color = s.color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : s.color
    botToken.current++
    setStarted(true)
    lowTimeWarned.current = false
    setThinking(false)
    setPlayerColor(color)
    setOrientation(color)
    setViewPly(null)
    setShowResult(false)
    setShowNewGame(false)
    setPendingPromotion(null)
    resetThreat()
    setSession(new GameSession({ timeControl: s.timeControl }))
    void engineRef.current?.newGame()
    playSound('start')
  }, [resetThreat])

  const playMove = useCallback(
    (from: string, to: string, promotion?: PromotionPiece) => {
      if (!session.move({ from, to, promotion })) {
        playSound('illegal')
        resyncBoard() // snap the board back
      } else clearThreat()
    },
    [session, clearThreat],
  )

  const onBoardMove = useCallback(
    (from: string, to: string, premove: boolean) => {
      if (threatCheck?.phase === 'ask') {
        void answerThreat(from + to)
        resyncBoard() // put their piece back
        return
      }
      if (session.isPromotion(from, to) && !premove) setPendingPromotion({ from, to })
      else playMove(from, to)
    },
    [session, playMove, threatCheck, answerThreat],
  )

  // Resigning takes two taps, so a stray touch on a phone can't end the game.
  const resign = () => {
    if (!confirmResign) {
      setConfirmResign(true)
      setTimeout(() => setConfirmResign(false), 3000)
      return
    }
    setConfirmResign(false)
    clearThreat()
    session.resign(playerColor)
  }

  const takeback = () => {
    if (!gameActive) return
    botToken.current++
    setThinking(false)
    clearThreat()
    // Undo the bot's reply too, so it is the player's turn again.
    const plies = session.turn === playerColor ? 2 : 1
    session.undo(Math.min(plies, history.length))
  }

  // Board position: the live game, or an earlier move while browsing.
  const shownPly = viewPly ?? ply
  const browsing = shownPly !== ply
  const shownMove = shownPly > 0 ? history[shownPly - 1] : undefined
  const shownFen = shownMove ? shownMove.after : START_FEN
  const shownTurn: Color = shownFen.split(' ')[1] as Color
  const isOver = session.isOver
  // Memoized on the live FEN (`session` itself is mutable) so the board is only
  // reconfigured when the position really changes.
  const liveFen = session.fen
  const dests = useMemo(
    () => (browsing || isOver || !liveFen ? new Map<string, string[]>() : session.legalDests()),
    [session, liveFen, browsing, isOver],
  )

  // While naming a threat I move the opponent's pieces, as if I had passed.
  const naming = threatCheck?.phase === 'ask' && !browsing
  const boardDests = useMemo(() => (naming ? threatDests(liveFen) : dests), [naming, liveFen, dests])
  const threatArrows: Arrow[] = []
  if (threatCheck?.phase === 'done' && !browsing) {
    const { analysis, answer } = threatCheck
    const main = analysis?.threats[0]
    if (answer && answer.slice(0, 4) !== main?.uci.slice(0, 4)) threatArrows.push({ from: answer.slice(0, 2), to: answer.slice(2, 4), brush: 'blue' })
    if (main) threatArrows.push({ from: main.uci.slice(0, 2), to: main.uci.slice(2, 4), brush: 'red' })
  }
  const waitingForThreat = threatCheck != null && threatCheck.phase !== 'done'

  const goTo = useCallback(
    (p: number) => {
      const clamped = Math.max(0, Math.min(ply, p))
      setViewPly(clamped === ply ? null : clamped)
    },
    [ply],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active || showNewGame || e.target instanceof HTMLInputElement) return
      if (e.key === 'ArrowLeft') goTo(shownPly - 1)
      else if (e.key === 'ArrowRight') goTo(shownPly + 1)
      else if (e.key === 'ArrowUp' || e.key === 'Home') goTo(0)
      else if (e.key === 'ArrowDown' || e.key === 'End') goTo(ply)
      else if (e.key === 'f') setOrientation((o) => opposite(o))
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, goTo, shownPly, ply, showNewGame])

  const material = materialSummary(session.chess)
  const timeLeft = (c: Color) => (session.clock ? session.clock.timeLeft(c) : null)
  const bar = (c: Color) => {
    const isPlayer = c === playerColor
    const lead = material.lead[c]
    return (
      <PlayerBar
        name={isPlayer ? 'You' : `Stockfish · ${level.name}`}
        subtitle={isPlayer ? undefined : `(≈${level.approxElo})`}
        timeLeft={timeLeft(c)}
        active={gameActive && session.clock?.activeColor === c}
        captured={material.captured[c] + (lead ? ` +${lead}` : '')}
      />
    )
  }

  const botName = `Stockfish ${level.name}`
  const pgnHeaders = () => ({
    Event: 'Casual game vs computer',
    Site: 'Chess Trainer',
    Date: new Date().toISOString().slice(0, 10).replaceAll('-', '.'),
    White: playerColor === 'w' ? 'You' : botName,
    Black: playerColor === 'b' ? 'You' : botName,
  })
  const pgnText = () => session.pgn(pgnHeaders())

  // Save finished games (with at least one move each) to the Games list.
  const saved = useRef(new WeakSet<GameSession>())
  const result = session.result
  useEffect(() => {
    if (!result || saved.current.has(session) || session.history.length < 2) return
    saved.current.add(session)
    const tc = session.timeControl
    const pgn = session.pgn(pgnHeaders())
    const me = { name: 'You', result: result.winner === playerColor ? 'win' : result.winner ? result.reason : 'draw' }
    const bot = { name: botName, rating: level.approxElo, result: result.winner === playerColor ? result.reason : result.winner ? 'win' : 'draw' }
    const sans = session.history.map((m) => m.san)
    const endTime = Date.now()
    void loadOpenings().then(() => {
      const opening = detectOpening(sans)
      const record = {
        id: `bot:${endTime}`,
        source: 'bot' as const,
        white: playerColor === 'w' ? me : bot,
        black: playerColor === 'b' ? me : bot,
        userColor: playerColor,
        outcome: result.winner === null ? ('draw' as const) : result.winner === playerColor ? ('win' as const) : ('loss' as const),
        timeClass: timeClassOf(tc),
        timeControl: tc ? (tc.increment ? `${tc.initial}+${tc.increment}` : String(tc.initial)) : '-',
        rated: false,
        endTime,
        plies: sans.length,
        eco: opening?.eco,
        opening: opening?.name,
      }
      return saveGames(db, [{ record, pgn }])
    })
    // pgnHeaders/botName only read current settings; the session identity guards re-saving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, session])

  const analyze = () => {
    setShowResult(false)
    const tree = MoveTree.fromMoves(
      history.map((m) => m.san),
      START_FEN,
      Object.fromEntries(Object.entries(pgnHeaders()).concat([['Result', resultTag(session.result)]])),
    )
    onAnalyze(tree, playerColor)
  }

  const downloadPgn = () => {
    const blob = new Blob([pgnText()], { type: 'application/x-chess-pgn' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `game-${new Date().toISOString().slice(0, 16).replace(':', '')}.pgn`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const statusText = session.result
    ? describeResult(session.result)
    : !started
      ? 'Choose a game to start'
      : thinking
        ? 'Stockfish is thinking…'
        : session.turn === playerColor
          ? threatCheck && threatCheck.phase !== 'done'
            ? 'Blunder check'
            : 'Your move'
          : ''

  return (
    <>
      <main className="layout">
        <section className="board-column">
          {bar(opposite(orientation))}
          <div className="board-frame">
            <Board
              fen={shownFen}
              orientation={colorName(orientation)}
              turnColor={colorName(naming ? botColor : shownTurn)}
              movableColor={
                naming ? colorName(botColor) : gameActive && !browsing && !waitingForThreat ? colorName(playerColor) : undefined
              }
              dests={boardDests}
              arrows={threatArrows}
              premoves={!blunderCheck}
              lastMove={shownMove ? [shownMove.from, shownMove.to] : undefined}
              check={(shownMove?.san.includes('+') || shownMove?.san.includes('#')) ?? false}
              onMove={onBoardMove}
              syncKey={boardSync}
            />
          </div>
          {bar(orientation)}
        </section>

        <aside className="side-panel">
          <div className="panel-header">
            <div className="status">{statusText}</div>
            <button className="btn small primary" onClick={() => setShowNewGame(true)}>
              New game
            </button>
          </div>
          {blunderCheck && started && (
            <ThreatCheckPanel
              check={browsing ? null : threatCheck}
              score={threatScore}
              opponentName={botColor === 'w' ? 'White' : 'Black'}
              onNoThreat={() => void answerThreat(null)}
            />
          )}
          <MoveList sans={history.map((m) => m.san)} viewPly={shownPly} onSelect={goTo} />
          <div className="nav-row">
            <button className="btn icon" onClick={() => goTo(0)} aria-label="First move">
              ⏮
            </button>
            <button className="btn icon" onClick={() => goTo(shownPly - 1)} aria-label="Previous move">
              ◀
            </button>
            <button className="btn icon" onClick={() => goTo(shownPly + 1)} aria-label="Next move">
              ▶
            </button>
            <button className="btn icon" onClick={() => goTo(ply)} aria-label="Last move">
              ⏭
            </button>
          </div>
          <div className="action-row">
            <button className="btn secondary" onClick={() => setOrientation((o) => opposite(o))}>
              ⇅ Flip
            </button>
            <button className="btn secondary" onClick={takeback} disabled={!gameActive || ply === 0}>
              ↶ Takeback
            </button>
            <button className={`btn ${confirmResign ? 'danger' : 'secondary'}`} onClick={resign} disabled={!gameActive}>
              {confirmResign ? 'Confirm?' : '⚑ Resign'}
            </button>
            {session.isOver && (
              <button className="btn secondary" onClick={analyze}>
                🔍 Analyze
              </button>
            )}
          </div>
        </aside>
      </main>

      {showNewGame && (
        <NewGameDialog
          initial={settings}
          onStart={startGame}
          onCancel={() => setShowNewGame(false)}
        />
      )}

      {pendingPromotion && (
        <PromotionDialog
          color={playerColor}
          onPick={(piece) => {
            playMove(pendingPromotion.from, pendingPromotion.to, piece)
            setPendingPromotion(null)
          }}
          onCancel={() => {
            setPendingPromotion(null)
            resyncBoard()
          }}
        />
      )}

      {showResult && session.result && (
        <div className="overlay" role="dialog" aria-modal>
          <div className="dialog result-dialog">
            <h2>
              {session.result.winner === null ? 'Draw' : session.result.winner === playerColor ? 'You won!' : 'You lost'}
            </h2>
            <p className="muted">{describeResult(session.result)}</p>
            {blunderCheck && threatScore.asked > 0 && (
              <p>
                🛡 Threats named right: {threatScore.right}/{threatScore.asked}
              </p>
            )}
            <div className="dialog-actions">
              <button className="btn secondary" onClick={downloadPgn}>
                Download PGN
              </button>
              <button className="btn secondary" onClick={analyze}>
                Analyze
              </button>
              <button className="btn primary" onClick={() => startGame(settings)}>
                Rematch
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
