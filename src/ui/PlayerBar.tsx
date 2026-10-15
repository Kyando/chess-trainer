import { formatClock } from '../core/clock'

interface Props {
  name: string
  subtitle?: string
  /** Milliseconds left, or null for an untimed game. */
  timeLeft: number | null
  active: boolean
  captured: string
}

export function PlayerBar({ name, subtitle, timeLeft, active, captured }: Props) {
  const low = timeLeft !== null && timeLeft < 20_000
  return (
    <div className="player-bar">
      <div className="player-info">
        <div className="avatar" aria-hidden>
          {name.slice(0, 1)}
        </div>
        <div className="player-text">
          <span className="player-name">
            {name}
            {subtitle && <span className="player-sub"> {subtitle}</span>}
          </span>
          <span className="captured">{captured}</span>
        </div>
      </div>
      {timeLeft !== null && (
        <div className={`clock${active ? ' active' : ''}${low && active ? ' low' : ''}`}>{formatClock(timeLeft)}</div>
      )}
    </div>
  )
}
