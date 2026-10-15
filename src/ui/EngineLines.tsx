import { formatEval, pvToSan, toWhiteEval } from '../engine/eval'
import type { EngineLine } from '../engine/uci'
import type { Color } from '../core/types'

interface Props {
  fen: string
  lines: EngineLine[]
  enabled: boolean
  onToggle: () => void
  /** Plays the line up to and including the clicked move. */
  onPlayLine: (ucis: string[]) => void
  status?: string
}

/** Engine panel: on/off switch, depth, and the top lines with clickable moves. */
export function EngineLines({ fen, lines, enabled, onToggle, onPlayLine, status }: Props) {
  const turn = fen.split(' ')[1] as Color
  const depth = lines[0]?.depth
  return (
    <div className="engine-panel">
      <div className="engine-header">
        <label className="switch">
          <input type="checkbox" checked={enabled} onChange={onToggle} />
          <span className="switch-track" />
          <span>Stockfish 19</span>
        </label>
        <span className="muted engine-depth">{enabled && (status ?? (depth ? `depth ${depth}` : 'starting…'))}</span>
      </div>
      {enabled &&
        lines.map((line) => {
          const moves = pvToSan(fen, line.pv, 10)
          const ev = toWhiteEval(line, turn)
          const positive = ev.mate !== undefined ? ev.mate > 0 : (ev.cp ?? 0) >= 0
          return (
            <div key={line.multipv} className="engine-line">
              <span className={`engine-score ${positive ? 'white-better' : 'black-better'}`}>{formatEval(ev)}</span>
              <span className="engine-moves">
                {moves.map((m, i) => (
                  <button key={i} className="pv-move" onClick={() => onPlayLine(line.pv.slice(0, i + 1))}>
                    {m.ply % 2 === 1 ? `${Math.ceil(m.ply / 2)}. ` : i === 0 ? `${m.ply / 2}… ` : ''}
                    {m.san}
                  </button>
                ))}
              </span>
            </div>
          )
        })}
    </div>
  )
}
