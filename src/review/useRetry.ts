import { Chess } from 'chess.js'
import { useEffect, useRef, useState } from 'react'
import type { Color } from '../core/types'
import { ERRORS, type GameReview, type ReviewedMove } from './review'

/** A move this close to the best one (in winning chances) counts as solved. */
const ACCEPT_LOSS = 5

export type RetryStatus = 'try' | 'checking' | 'right' | 'wrong' | 'shown' | 'finished'

interface Drill {
  items: ReviewedMove[]
  at: number
  /** Position on the board, and the move that led to it. */
  fen: string
  lastMove?: [string, string]
  status: RetryStatus
  message: string
  attempts: number
  hint: boolean
  /** Items solved without a wrong attempt, hint or solution. */
  clean: number
}

/**
 * "Retry the mistake": replays the positions where a side erred and lets the
 * user look for a better move, checked against the engine.
 */
export function useRetry(
  review: GameReview | null,
  fens: string[],
  judgeMove: (fen: string, uci: string) => Promise<number>,
) {
  const [drill, setDrill] = useState<Drill | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const item = drill && drill.status !== 'finished' ? drill.items[drill.at] : undefined
  const startFen = item ? fens[item.index] : ''

  const begin = (color: Color) => {
    const items = review?.moves.filter((m) => m.color === color && ERRORS.has(m.cls)) ?? []
    if (!items.length) return
    setDrill(atItem({ items, at: 0, clean: 0 }, fens))
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
    if (lan === item.uci) return wrong(() => true, shown, `${san} is the move you played in the game. Look for something better.`)
    if (lan === item.bestUci) return setDrill(toRight(shown, `${san} is the best move!`))
    setDrill({ ...shown, status: 'checking', message: 'Checking…' })
    const loss = item.winBefore - (await judgeMove(startFen, lan))
    // Drop the verdict if the user moved on meanwhile.
    const still = (cur: Drill) => cur.status === 'checking' && cur.items[cur.at] === item
    if (loss < ACCEPT_LOSS) {
      const message = `${san} works! The engine's top choice was ${item.bestSan ?? san}.`
      setDrill((cur) => (cur && still(cur) ? toRight(cur, message) : cur))
    } else {
      wrong(still, null, `${san} doesn't hold up (−${Math.round(loss)}% win chance). Try again.`)
    }
  }

  /** Shows the wrong attempt briefly, then puts the position back. */
  const wrong = (applies: (cur: Drill) => boolean, shown: Drill | null, message: string) => {
    setDrill((cur) => {
      const base = shown ?? cur
      if (!base || !cur || !applies(cur)) return cur
      return { ...base, status: 'wrong', message, attempts: base.attempts + 1 }
    })
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(
      () => setDrill((cur) => (cur?.status === 'wrong' ? { ...cur, status: 'try', fen: startFen, lastMove: undefined } : cur)),
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

  const next = () => {
    if (!drill) return
    window.clearTimeout(timer.current)
    if (drill.at + 1 >= drill.items.length) setDrill({ ...drill, status: 'finished', message: '' })
    else setDrill(atItem({ items: drill.items, at: drill.at + 1, clean: drill.clean }, fens))
  }

  const exit = () => {
    window.clearTimeout(timer.current)
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

function toRight(d: Drill, message: string): Drill {
  return { ...d, status: 'right', message, clean: d.clean + (d.attempts === 0 && !d.hint ? 1 : 0) }
}

function atItem(d: Pick<Drill, 'items' | 'at' | 'clean'>, fens: string[]): Drill {
  return { ...d, fen: fens[d.items[d.at].index], status: 'try', message: '', attempts: 0, hint: false }
}
