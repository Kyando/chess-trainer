import { Chess } from 'chess.js'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { loadOpenings, openingFor } from '../core/openings'
import { MoveTree } from '../core/tree'
import type { Color, PromotionPiece } from '../core/types'
import { toWhiteEval, type WhiteEval } from '../engine/eval'
import { StockfishEngine } from '../engine/stockfish'
import { uciToIntent, type EngineLine } from '../engine/uci'
import { Board, type Arrow } from '../ui/Board'
import { EngineLines } from '../ui/EngineLines'
import { EvalBar } from '../ui/EvalBar'
import { ImportDialog } from '../ui/ImportDialog'
import { PromotionDialog } from '../ui/PromotionDialog'
import { playSound, soundForMove } from '../ui/sounds'
import { TreeView } from '../ui/TreeView'

const ANALYSIS_DEPTH = 20
const MULTIPV = 3
const ENGINE_KEY = 'chess-trainer.analysis-engine'

interface Props {
  /** A tree to load (e.g. a just-finished game); a new object replaces the current tree. */
  initialTree: MoveTree | null
  /** Starting orientation for loaded games. */
  initialOrientation?: Color
  /** Only analyse while the view is visible. */
  active: boolean
}

function readEngineSetting(): boolean {
  try {
    return localStorage.getItem(ENGINE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function AnalysisView({ initialTree, initialOrientation = 'w', active }: Props) {
  const [tree, setTree] = useState(() => initialTree ?? new MoveTree())
  const [currentId, setCurrentId] = useState(() => tree.continuation(tree.rootId).at(-1)?.id ?? tree.rootId)
  const [orientation, setOrientation] = useState<Color>(initialOrientation)
  const [engineOn, setEngineOn] = useState(readEngineSetting)
  // Lines are tagged with their position so stale results never show on a new one.
  const [analysis, setAnalysis] = useState<{ fen: string; lines: EngineLine[] }>({ fen: '', lines: [] })
  const [showImport, setShowImport] = useState(false)
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [openingsReady, setOpeningsReady] = useState(false)
  const [, bump] = useReducer((x: number) => x + 1, 0)
  const [boardSync, resyncBoard] = useReducer((x: number) => x + 1, 0)
  const engineRef = useRef<StockfishEngine | null>(null)

  // Load a new tree when the parent passes one (e.g. "Analyze game").
  const [loadedFrom, setLoadedFrom] = useState(initialTree)
  if (initialTree && initialTree !== loadedFrom) {
    setLoadedFrom(initialTree)
    setTree(initialTree)
    setCurrentId(initialTree.rootId)
    setOrientation(initialOrientation)
  }

  useEffect(() => {
    void loadOpenings().then(() => setOpeningsReady(true))
  }, [])

  const node = tree.get(currentId)
  const fen = node.fen
  const chess = useMemo(() => new Chess(fen), [fen])
  const turn = chess.turn()
  const gameOver = chess.isGameOver()

  // Engine: (re)start analysis whenever the position changes.
  const analysing = active && engineOn && !gameOver
  useEffect(() => {
    if (!analysing) return
    engineRef.current ??= new StockfishEngine()
    return engineRef.current.analyze(fen, { depth: ANALYSIS_DEPTH, multipv: MULTIPV }, (lines) => setAnalysis({ fen, lines }))
  }, [fen, analysing])
  const lines = analysis.fen === fen ? analysis.lines : []

  useEffect(() => () => engineRef.current?.terminate(), [])

  // Game-ending positions get a fixed bar; otherwise the engine's top line.
  const evaluation: WhiteEval | null = chess.isCheckmate()
    ? { mate: turn === 'w' ? -1 : 1 }
    : gameOver
      ? { cp: 0 }
      : analysing && lines[0]
        ? toWhiteEval(lines[0], turn)
        : null
  const evalLabel = chess.isCheckmate() ? (turn === 'w' ? '0-1' : '1-0') : gameOver ? '½-½' : undefined

  const dests = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const m of chess.moves({ verbose: true })) map.set(m.from, [...(map.get(m.from) ?? []), m.to])
    return map
  }, [chess])

  const arrows: Arrow[] = analysing && lines[0]?.pv[0]
    ? [{ from: lines[0].pv[0].slice(0, 2), to: lines[0].pv[0].slice(2, 4), brush: 'paleBlue' }]
    : []

  const opening = openingsReady ? openingFor(tree.path(currentId).map((n) => n.fen)) : null

  const play = useCallback(
    (from: string, to: string, promotion?: PromotionPiece) => {
      const next = tree.addMove(currentId, { from, to, promotion })
      if (!next) {
        resyncBoard()
        return
      }
      playSound(soundForMove(next.move!))
      setCurrentId(next.id)
      bump()
    },
    [tree, currentId],
  )

  const onBoardMove = (from: string, to: string) => {
    const isPromotion = chess.moves({ square: from as never, verbose: true }).some((m) => m.to === to && m.isPromotion())
    if (isPromotion) setPendingPromotion({ from, to })
    else play(from, to)
  }

  const playLine = (ucis: string[]) => {
    let id = currentId
    for (const uci of ucis) {
      const next = tree.addMove(id, uciToIntent(uci))
      if (!next) break
      id = next.id
    }
    setCurrentId(id)
    bump()
  }

  const goParent = useCallback(() => node.parentId && setCurrentId(node.parentId), [node])
  const goChild = useCallback(() => node.children[0] && setCurrentId(node.children[0]), [node])
  const goStart = useCallback(() => setCurrentId(tree.rootId), [tree])
  const goEnd = useCallback(() => setCurrentId(tree.continuation(currentId).at(-1)?.id ?? currentId), [tree, currentId])

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (showImport || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return
      if (e.key === 'ArrowLeft') goParent()
      else if (e.key === 'ArrowRight') goChild()
      else if (e.key === 'ArrowUp' || e.key === 'Home') goStart()
      else if (e.key === 'ArrowDown' || e.key === 'End') goEnd()
      else if (e.key === 'f') setOrientation((o) => (o === 'w' ? 'b' : 'w'))
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, showImport, goParent, goChild, goStart, goEnd])

  const toggleEngine = () => {
    const next = !engineOn
    setEngineOn(next)
    try {
      localStorage.setItem(ENGINE_KEY, next ? 'on' : 'off')
    } catch {
      /* ignore */
    }
  }

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
    } catch {
      setCopied('Copy failed')
    }
    setTimeout(() => setCopied(null), 1500)
  }

  const isVariation = node.parentId !== null && !tree.isMainline(currentId)

  return (
    <main className="layout">
      <section className="board-column">
        <div className="board-with-eval">
          <EvalBar evaluation={evaluation} label={evalLabel} orientation={orientation === 'w' ? 'white' : 'black'} />
          <div className="board-frame">
            <Board
              fen={fen}
              orientation={orientation === 'w' ? 'white' : 'black'}
              turnColor={turn === 'w' ? 'white' : 'black'}
              movableColor="both"
              dests={dests}
              lastMove={node.move ? [node.move.from, node.move.to] : undefined}
              check={chess.inCheck()}
              arrows={arrows}
              onMove={onBoardMove}
              syncKey={boardSync}
            />
          </div>
        </div>
      </section>

      <aside className="side-panel analysis-panel">
        <EngineLines
          fen={fen}
          lines={analysing ? lines : []}
          enabled={engineOn}
          onToggle={toggleEngine}
          onPlayLine={playLine}
          status={gameOver ? (chess.isCheckmate() ? 'checkmate' : 'draw') : undefined}
        />
        <div className="opening-name">{opening ? `${opening.eco} · ${opening.name}` : ' '}</div>
        <TreeView tree={tree} currentId={currentId} onSelect={setCurrentId} />
        {isVariation && (
          <div className="action-row">
            <button className="btn secondary small-text" onClick={() => (tree.promote(currentId), bump())}>
              ↑ Make main line
            </button>
            <button
              className="btn secondary small-text"
              onClick={() => {
                // Delete the whole variation from where it leaves the main line.
                const branch = tree.path(currentId).find((n) => n.parentId && !tree.isMainline(n.id))!
                setCurrentId(branch.parentId!)
                tree.delete(branch.id)
                bump()
              }}
            >
              ✕ Delete variation
            </button>
          </div>
        )}
        <div className="nav-row">
          <button className="btn icon" onClick={goStart} aria-label="Start">
            ⏮
          </button>
          <button className="btn icon" onClick={goParent} aria-label="Previous move">
            ◀
          </button>
          <button className="btn icon" onClick={goChild} aria-label="Next move">
            ▶
          </button>
          <button className="btn icon" onClick={goEnd} aria-label="End of line">
            ⏭
          </button>
        </div>
        <div className="action-row">
          <button className="btn secondary" onClick={() => setOrientation((o) => (o === 'w' ? 'b' : 'w'))}>
            ⇅ Flip
          </button>
          <button className="btn secondary" onClick={() => setShowImport(true)}>
            ⤒ Import
          </button>
          <button className="btn secondary" onClick={() => copy('PGN copied', tree.toPgn())}>
            PGN
          </button>
          <button className="btn secondary" onClick={() => copy('FEN copied', fen)}>
            FEN
          </button>
        </div>
        <div className="status" aria-live="polite">
          {copied ?? ''}
        </div>
      </aside>

      {showImport && (
        <ImportDialog
          onCancel={() => setShowImport(false)}
          onImport={(t) => {
            setShowImport(false)
            setTree(t)
            setCurrentId(t.rootId)
            setOrientation(t.root.fen.split(' ')[1] === 'b' && t.root.children.length === 0 ? 'b' : 'w')
          }}
        />
      )}

      {pendingPromotion && (
        <PromotionDialog
          color={turn}
          onPick={(piece) => {
            play(pendingPromotion.from, pendingPromotion.to, piece)
            setPendingPromotion(null)
          }}
          onCancel={() => {
            setPendingPromotion(null)
            resyncBoard()
          }}
        />
      )}
    </main>
  )
}
