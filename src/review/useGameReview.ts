import { useEffect, useMemo, useRef, useState } from 'react'
import { isBookPosition, loadOpenings } from '../core/openings'
import type { MoveTree } from '../core/tree'
import { db } from '../data/db'
import { StockfishEngine } from '../engine/stockfish'
import { reviewGame, type GameReview, type PositionEval } from './review'
import { evaluatePositions, REVIEW_NODES, reviewKey, winAfterMove } from './runner'

export type ReviewStatus = 'idle' | 'running' | 'done' | 'error'

interface State {
  /** The main line this state belongs to; anything else counts as idle. */
  key: string
  status: ReviewStatus
  progress: number
  evals?: PositionEval[]
  error?: string
}

/**
 * Game Review for a tree's main line: runs the engine over every position
 * (in its own worker), caches the result in IndexedDB and classifies moves.
 * `version` must change whenever the tree is mutated.
 */
export function useGameReview(tree: MoveTree, version: number) {
  const { key, fens, moves } = useMemo(() => {
    void version
    const line = tree.mainline()
    return {
      key: reviewKey(tree.root.fen, line.map((n) => n.move!.uci)),
      fens: [tree.root.fen, ...line.map((n) => n.fen)],
      moves: line.map((n) => ({ san: n.move!.san, uci: n.move!.uci, id: n.id })),
    }
  }, [tree, version])

  const [state, setState] = useState<State>({ key: '', status: 'idle', progress: 0 })
  const current: State = state.key === key ? state : { key, status: 'idle', progress: 0 }
  const engineRef = useRef<StockfishEngine | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [openingsReady, setOpeningsReady] = useState(false)

  useEffect(() => {
    void loadOpenings().then(() => setOpeningsReady(true))
  }, [])

  // Show a cached review as soon as the game is opened.
  useEffect(() => {
    if (moves.length === 0) return
    let stale = false
    void db.reviews.get(key).then((stored) => {
      if (stale || !stored) return
      setState((s) => (s.key === key && s.status === 'running' ? s : { key, status: 'done', progress: 1, evals: stored.evals }))
    })
    return () => {
      stale = true
    }
  }, [key, moves.length])

  // Stop a running review when the main line changes or the view goes away.
  useEffect(() => () => abortRef.current?.abort(), [key])
  useEffect(
    () => () => {
      engineRef.current?.terminate()
      engineRef.current = null
    },
    [],
  )

  const engine = () => (engineRef.current ??= new StockfishEngine())

  const start = async () => {
    abortRef.current?.abort()
    const abort = new AbortController()
    abortRef.current = abort
    setState({ key, status: 'running', progress: 0 })
    try {
      const evals = await evaluatePositions(engine(), fens, {
        nodes: REVIEW_NODES,
        signal: abort.signal,
        onProgress: (done, total) => setState((s) => (s.key === key ? { ...s, progress: done / total } : s)),
      })
      await db.reviews.put({ key, nodes: REVIEW_NODES, evals, createdAt: Date.now() })
      setState({ key, status: 'done', progress: 1, evals })
    } catch (e) {
      if (abort.signal.aborted) setState((s) => (s.key === key ? { key, status: 'idle', progress: 0 } : s))
      else setState({ key, status: 'error', progress: 0, error: e instanceof Error ? e.message : String(e) })
    }
  }

  const cancel = () => abortRef.current?.abort()

  const review: GameReview | null = useMemo(() => {
    void openingsReady
    if (!current.evals || current.evals.length !== fens.length) return null
    return reviewGame(fens, moves, current.evals, isBookPosition)
  }, [current.evals, fens, moves, openingsReady])

  /** Mover's winning chances after `uci` in `fen` (for "retry the mistake"). */
  const judgeMove = (fen: string, uci: string) => winAfterMove(engine(), fen, uci, REVIEW_NODES)

  return {
    status: current.status,
    progress: current.progress,
    error: current.error,
    review,
    /** Main-line positions, aligned with `review.whiteWin`. */
    fens,
    /** Main-line node ids, aligned with `review.moves`. */
    nodeIds: moves.map((m) => m.id),
    start,
    cancel,
    judgeMove,
  }
}
