import { Chess } from 'chess.js'
import { useCallback, useRef, useState, type RefObject } from 'react'
import type { StockfishEngine } from '../engine/stockfish'
import { findThreats, isThreatMove, judgeThreat, nullMoveFen, VERDICT_OK, type ThreatAnalysis, type Verdict } from '../engine/threat'

export interface ThreatCheck {
  fen: string
  /** ask: waiting for my answer; judging: engine still working; done: verdict shown, my move. */
  phase: 'ask' | 'judging' | 'done'
  /** My answer: the opponent move I named (UCI), or null for "no threat". */
  answer?: string | null
  answerSan?: string
  analysis?: ThreatAnalysis
  verdict?: Verdict
}

export interface ThreatScore {
  asked: number
  right: number
}

/**
 * Blunder-check mode: before each of my moves I name what the opponent
 * threatens, and the engine grades it. The threat search starts as soon as the
 * question is asked, so it is usually ready by the time I answer.
 */
export function useThreatCheck(engineRef: RefObject<StockfishEngine | null>) {
  const [check, setCheck] = useState<ThreatCheck | null>(null)
  const [score, setScore] = useState<ThreatScore>({ asked: 0, right: 0 })
  const token = useRef(0)
  const pending = useRef<Promise<ThreatAnalysis> | null>(null)

  const ask = useCallback(
    (fen: string) => {
      const engine = engineRef.current
      if (!engine || !nullMoveFen(fen)) return
      token.current++
      pending.current = findThreats(engine, fen)
      pending.current.catch(() => undefined) // judged (or dropped) in `answer`
      setCheck({ fen, phase: 'ask' })
    },
    [engineRef],
  )

  const answer = useCallback(
    async (uci: string | null) => {
      const engine = engineRef.current
      const analysisPromise = pending.current
      if (!check || check.phase !== 'ask' || !engine || !analysisPromise) return
      const mine = token.current
      const answerSan = uci ? sanOf(check.fen, uci) : undefined
      setCheck({ ...check, phase: 'judging', answer: uci, answerSan })
      try {
        const analysis = await analysisPromise
        const named = uci && !analysis.threats.some((t) => t.uci.slice(0, 4) === uci.slice(0, 4))
        const answerIsThreat = named ? await isThreatMove(engine, analysis, uci) : false
        if (mine !== token.current) return
        const verdict = judgeThreat(analysis, uci, answerIsThreat)
        setCheck({ fen: check.fen, phase: 'done', answer: uci, answerSan, analysis, verdict })
        setScore((s) => ({ asked: s.asked + 1, right: s.right + (VERDICT_OK[verdict] ? 1 : 0) }))
      } catch (err) {
        console.error('Blunder check failed', err)
        if (mine === token.current) setCheck(null)
      }
    },
    [check, engineRef],
  )

  /** Ends the current question (I moved, took back, or the game ended). */
  const clear = useCallback(() => {
    token.current++
    pending.current = null
    setCheck(null)
  }, [])

  const reset = useCallback(() => {
    clear()
    setScore({ asked: 0, right: 0 })
  }, [clear])

  return { check, score, ask, answer, clear, reset }
}

function sanOf(fen: string, uci: string): string | undefined {
  const passed = nullMoveFen(fen)
  if (!passed) return undefined
  try {
    return new Chess(passed).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q' }).san
  } catch {
    return undefined
  }
}
