import { describeThreat, VERDICT_OK } from '../engine/threat'
import type { ThreatCheck, ThreatScore } from '../play/useThreatCheck'

interface Props {
  check: ThreatCheck | null
  score: ThreatScore
  opponentName: string
  onNoThreat: () => void
}

/** The blunder-check question above the move list, and its verdict. */
export function ThreatCheckPanel({ check, score, opponentName, onNoThreat }: Props) {
  const tally = score.asked > 0 && (
    <span className="threat-score">
      {score.right}/{score.asked}
    </span>
  )

  if (!check) {
    return (
      <div className="threat-check">
        <div className="threat-title">🛡 Blunder check {tally}</div>
      </div>
    )
  }

  if (check.phase === 'ask') {
    return (
      <div className="threat-check asking">
        <div className="threat-title">🛡 What does {opponentName} threaten? {tally}</div>
        <p className="muted hint">Move one of their pieces to show the threat.</p>
        <button className="btn secondary" onClick={onNoThreat}>
          No threat
        </button>
      </div>
    )
  }

  if (check.phase === 'judging') {
    return (
      <div className="threat-check">
        <div className="threat-title">🛡 Checking {check.answerSan ?? '“no threat”'}… {tally}</div>
      </div>
    )
  }

  const { verdict, analysis, answerSan } = check
  const [main] = analysis?.threats ?? []
  const ok = verdict ? VERDICT_OK[verdict] : false
  let text: string
  switch (verdict) {
    case 'spotted':
      text =
        main && main.san === answerSan
          ? `Right: ${describeThreat(main)}.`
          : `Right, ${answerSan} is dangerous.${main ? ` The biggest threat: ${describeThreat(main)}.` : ''}`
      break
    case 'calm':
      text = 'Right, nothing big is threatened.'
      break
    case 'missed':
      text = main ? `Missed: ${describeThreat(main)}.` : 'Missed the threat.'
      break
    default:
      text = `${answerSan} isn't a real threat; nothing big is threatened.`
  }
  return (
    <div className={`threat-check ${ok ? 'right' : 'wrong'}`}>
      <div className="threat-title">
        {ok ? '✓' : '✗'} {text} {tally}
      </div>
      <p className="muted hint">Your move.</p>
    </div>
  )
}
