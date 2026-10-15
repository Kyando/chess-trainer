import { Chess } from 'chess.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LineOutcome } from './lichess'

/** A puzzle solved by playing a fixed line: `moves[0]` is the opponent's, then mine, theirs, … */
export interface LineItem {
  fen: string
  moves: string[]
}

export type LineStatus = 'intro' | 'try' | 'wrong' | 'reply' | 'right' | 'shown' | 'finished'

export interface LineState<T extends LineItem> {
  items: T[]
  at: number
  fen: string
  lastMove?: [string, string]
  /** Index in `moves` of the next move to be played. */
  step: number
  status: LineStatus
  message: string
  mistakes: number
  hint: boolean
  outcomes: LineOutcome[]
}

const OPPONENT_DELAY = 450
const WRONG_DELAY = 1200

const pair = (uci: string): [string, string] => [uci.slice(0, 2), uci.slice(2, 4)]

function apply(fen: string, uci: string) {
  const chess = new Chess(fen)
  const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
  return { fen: chess.fen(), san: move.san, mate: chess.isCheckmate() }
}

/**
 * Multi-move puzzles in the lichess style: the opponent's move is played for
 * me, then I must find each move of the solution; any mating move counts too.
 * `onOutcome` hears about each puzzle when I move past it.
 */
export function useLinePuzzle<T extends LineItem>(onOutcome?: (item: T, outcome: LineOutcome) => void) {
  const [state, setState] = useState<LineState<T> | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const later = (fn: () => void, ms: number) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(fn, ms)
  }

  const item = state && state.status !== 'finished' ? state.items[state.at] : undefined

  /** Shows a puzzle's start, then plays the opponent's first move. */
  const open = useCallback((items: T[], at: number, outcomes: LineOutcome[]) => {
    if (at >= items.length) {
      setState((s) => (s ? { ...s, status: 'finished', outcomes } : s))
      return
    }
    const it = items[at]
    setState({ items, at, fen: it.fen, step: 0, status: 'intro', message: '', mistakes: 0, hint: false, outcomes })
    later(() => {
      const first = apply(it.fen, it.moves[0])
      setState((s) => (s && s.items[s.at] === it ? { ...s, fen: first.fen, lastMove: pair(it.moves[0]), step: 1, status: 'try' } : s))
    }, 600)
  }, [])

  const begin = (items: T[]) => {
    if (items.length) open(items, 0, [])
  }

  /** Plays the opponent's reply at `step`, if any, else marks the puzzle solved. */
  const advance = (s: LineState<T>, fen: string, lastMove: [string, string], step: number, message: string) => {
    const it = s.items[s.at]
    if (step >= it.moves.length) {
      setState({ ...s, fen, lastMove, step, status: 'right', message })
      return
    }
    setState({ ...s, fen, lastMove, step, status: 'reply', message })
    later(() => {
      const reply = apply(fen, it.moves[step])
      setState((cur) => (cur && cur.items[cur.at] === it ? { ...cur, fen: reply.fen, lastMove: pair(it.moves[step]), step: step + 1, status: 'try', hint: false } : cur))
    }, OPPONENT_DELAY)
  }

  const play = (uci: string) => {
    if (!state || !item || state.status !== 'try') return
    const expected = item.moves[state.step]
    const right = uci.slice(0, 4) === expected.slice(0, 4)
    let result
    try {
      // Board drags carry no promotion piece: take the solution's, else a queen.
      result = apply(state.fen, right ? expected : uci.length === 4 && isPromotion(state.fen, uci) ? uci + 'q' : uci)
    } catch {
      return
    }
    const isLast = state.step === item.moves.length - 1
    if (right || result.mate) {
      const message = isLast || result.mate ? `${result.san} — solved!` : `${result.san} ✓ keep going`
      // A mate ends the puzzle even if the stored line is longer.
      if (result.mate) setState({ ...state, fen: result.fen, lastMove: pair(uci), step: item.moves.length, status: 'right', message })
      else advance(state, result.fen, pair(uci), state.step + 1, message)
      return
    }
    const before = { fen: state.fen, lastMove: state.lastMove }
    setState({ ...state, fen: result.fen, lastMove: pair(uci), status: 'wrong', mistakes: state.mistakes + 1, message: `${result.san} isn't it. Try again.` })
    later(() => setState((cur) => (cur && cur.status === 'wrong' && cur.items[cur.at] === item ? { ...cur, ...before, status: 'try' } : cur)), WRONG_DELAY)
  }

  const showHint = () => setState((s) => s && s.status === 'try' ? { ...s, hint: true } : s)

  /** Plays out the rest of the solution, one move at a time. */
  const showSolution = () => {
    if (!state || !item || (state.status !== 'try' && state.status !== 'wrong')) return
    const it = item
    const run = (fen: string, step: number) => {
      if (step >= it.moves.length) return
      later(() => {
        const r = apply(fen, it.moves[step])
        setState((cur) => (cur && cur.items[cur.at] === it ? { ...cur, fen: r.fen, lastMove: pair(it.moves[step]), step: step + 1 } : cur))
        run(r.fen, step + 1)
      }, 650)
    }
    // From the position before my move (the board may still show a wrong one).
    const restart = replayTo(it, state.step)
    setState({ ...state, fen: restart, status: 'shown', message: `Solution: ${solutionSan(it, state.step)}` })
    run(restart, state.step)
  }

  const outcomeOf = (s: LineState<T>): LineOutcome =>
    s.status === 'shown' ? 'shown' : s.status === 'right' ? (s.mistakes || s.hint ? 'solved' : 'clean') : 'skipped'

  const next = () => {
    if (!state || !item) return
    const outcome = outcomeOf(state)
    onOutcome?.(item, outcome)
    open(state.items, state.at + 1, [...state.outcomes, outcome])
  }

  const exit = () => {
    window.clearTimeout(timer.current)
    if (state && item && (state.status === 'right' || state.status === 'shown')) onOutcome?.(item, outcomeOf(state))
    setState(null)
  }

  const hintSquare = state?.hint && item ? item.moves[state.step]?.slice(0, 2) : undefined
  return { state, item, begin, play, showHint, showSolution, next, exit, hintSquare }
}

function isPromotion(fen: string, uci: string): boolean {
  const piece = new Chess(fen).get(uci.slice(0, 2) as never)
  return piece?.type === 'p' && (uci[3] === '8' || uci[3] === '1')
}

/** Position after the first `step` moves of the line. */
function replayTo(item: LineItem, step: number): string {
  let fen = item.fen
  for (const u of item.moves.slice(0, step)) fen = apply(fen, u).fen
  return fen
}

/** The remaining solution from `step`, in SAN. */
export function solutionSan(item: LineItem, step: number): string {
  let fen = replayTo(item, step)
  const out: string[] = []
  for (const u of item.moves.slice(step)) {
    const r = apply(fen, u)
    out.push(r.san)
    fen = r.fen
  }
  return out.join(' ')
}
