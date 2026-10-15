import { Chess } from 'chess.js'
import { useEffect, useRef, useState } from 'react'

/** A move this close to the best one (in winning chances) counts as solved. */
const ACCEPT_LOSS = 5

/** A position where a better move than the one played has to be found. */
export interface QuizItem {
  fen: string
  /** The move played in the game, which is never accepted. */
  playedUci: string
  bestUci?: string
  bestSan?: string
  /** Mover's winning chances with best play. */
  winBefore: number
  /** The move that led to `fen`, highlighted at the start. */
  lastMove?: [string, string]
}

export type QuizStatus = 'try' | 'checking' | 'right' | 'wrong' | 'shown' | 'finished'
/** clean: first try without a hint; solved: eventually; shown: gave up; skipped. */
export type QuizOutcome = 'clean' | 'solved' | 'shown' | 'skipped'

export interface Drill<T extends QuizItem> {
  items: T[]
  at: number
  /** Position on the board, and the move that led to it. */
  fen: string
  lastMove?: [string, string]
  status: QuizStatus
  message: string
  attempts: number
  hint: boolean
  outcomes: QuizOutcome[]
}

/**
 * "Find the better move" over a list of positions (retry a game's mistakes,
 * puzzles from past games), with moves checked against the engine.
 * `onOutcome` hears about each item when the user moves past it.
 */
export function useQuiz<T extends QuizItem>(
  judgeMove: (fen: string, uci: string) => Promise<number>,
  onOutcome?: (item: T, outcome: QuizOutcome) => void,
) {
  const [drill, setDrill] = useState<Drill<T> | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const item = drill && drill.status !== 'finished' ? drill.items[drill.at] : undefined
  const startFen = item?.fen ?? ''

  const begin = (items: T[]) => {
    if (!items.length) return
    window.clearTimeout(timer.current)
    setDrill(atItem({ items, at: 0, outcomes: [] }))
  }

  const play = async (uci: string) => {
    if (!drill || !item || drill.status !== 'try') return
    const chess = new Chess(startFen)
    let move: { san: string; lan: string }
    try {
      move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q' })
    } catch {
      return
    }
    const { san, lan } = move
    const shown = { ...drill, fen: chess.fen(), lastMove: [lan.slice(0, 2), lan.slice(2, 4)] as [string, string] }
    if (lan === item.playedUci) return wrong(() => true, shown, `${san} is the move from the game. Look for something better.`)
    if (lan === item.bestUci || chess.isCheckmate()) return setDrill({ ...shown, status: 'right', message: `${san} is the best move!` })
    setDrill({ ...shown, status: 'checking', message: 'Checking…' })
    const loss = item.winBefore - (await judgeMove(startFen, lan))
    // Drop the verdict if the user moved on meanwhile.
    const still = (cur: Drill<T>) => cur.status === 'checking' && cur.items[cur.at] === item
    if (loss < ACCEPT_LOSS) {
      const message = `${san} works! The engine's top choice was ${item.bestSan ?? san}.`
      setDrill((cur) => (cur && still(cur) ? { ...cur, status: 'right', message } : cur))
    } else {
      wrong(still, null, `${san} doesn't hold up (−${Math.round(loss)}% win chance). Try again.`)
    }
  }

  /** Shows the wrong attempt briefly, then puts the position back. */
  const wrong = (applies: (cur: Drill<T>) => boolean, shown: Drill<T> | null, message: string) => {
    setDrill((cur) => {
      const base = shown ?? cur
      if (!base || !cur || !applies(cur)) return cur
      return { ...base, status: 'wrong', message, attempts: base.attempts + 1 }
    })
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(
      () =>
        setDrill((cur) =>
          cur?.status === 'wrong' ? { ...cur, status: 'try', fen: cur.items[cur.at].fen, lastMove: cur.items[cur.at].lastMove } : cur,
        ),
      1400,
    )
  }

  const showHint = () => drill && setDrill({ ...drill, hint: true })

  const showSolution = () => {
    if (!drill || !item?.bestUci) return
    window.clearTimeout(timer.current)
    const chess = new Chess(startFen)
    chess.move({ from: item.bestUci.slice(0, 2), to: item.bestUci.slice(2, 4), promotion: item.bestUci[4] })
    setDrill({
      ...drill,
      fen: chess.fen(),
      lastMove: [item.bestUci.slice(0, 2), item.bestUci.slice(2, 4)],
      status: 'shown',
      message: `The best move was ${item.bestSan}.`,
    })
  }

  /** Records how the current item went (once). */
  const settle = (d: Drill<T>): Drill<T> => {
    if (d.status === 'finished') return d
    const outcome: QuizOutcome =
      d.status === 'right' ? (d.attempts === 0 && !d.hint ? 'clean' : 'solved') : d.status === 'shown' ? 'shown' : 'skipped'
    onOutcome?.(d.items[d.at], outcome)
    return { ...d, outcomes: [...d.outcomes, outcome] }
  }

  const next = () => {
    if (!drill || drill.status === 'finished') return
    window.clearTimeout(timer.current)
    const d = settle(drill)
    if (d.at + 1 >= d.items.length) setDrill({ ...d, status: 'finished', message: '' })
    else setDrill(atItem({ items: d.items, at: d.at + 1, outcomes: d.outcomes }))
  }

  const exit = () => {
    window.clearTimeout(timer.current)
    // Solved or revealed items still count when leaving without "Next".
    if (drill && (drill.status === 'right' || drill.status === 'shown')) settle(drill)
    setDrill(null)
  }

  return {
    active: drill !== null,
    drill,
    item,
    /** Square of the piece to move, once a hint was asked for. */
    hintSquare: drill?.hint && item?.bestUci ? item.bestUci.slice(0, 2) : undefined,
    begin,
    play,
    showHint,
    showSolution,
    next,
    exit,
  }
}

function atItem<T extends QuizItem>(d: Pick<Drill<T>, 'items' | 'at' | 'outcomes'>): Drill<T> {
  const item = d.items[d.at]
  return { ...d, fen: item.fen, lastMove: item.lastMove, status: 'try', message: '', attempts: 0, hint: false }
}
