import { useEffect, useRef } from 'react'

interface Props {
  sans: string[]
  /** Ply currently shown on the board (0 = start position). */
  viewPly: number
  onSelect: (ply: number) => void
}

/** Move list in numbered pairs; scrolls to the shown move. */
export function MoveList({ sans, viewPly, onSelect }: Props) {
  const listRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    listRef.current?.querySelector('.current')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [viewPly, sans.length])

  const rows: { n: number; white?: string; black?: string }[] = []
  for (let i = 0; i < sans.length; i += 2) rows.push({ n: i / 2 + 1, white: sans[i], black: sans[i + 1] })

  return (
    <ol className="move-list" ref={listRef}>
      {rows.length === 0 && <li className="move-empty">Make your first move</li>}
      {rows.map((row, i) => (
        <li key={row.n} className="move-row">
          <span className="move-num">{row.n}.</span>
          <MoveCell san={row.white} ply={i * 2 + 1} viewPly={viewPly} onSelect={onSelect} />
          <MoveCell san={row.black} ply={i * 2 + 2} viewPly={viewPly} onSelect={onSelect} />
        </li>
      ))}
    </ol>
  )
}

function MoveCell({ san, ply, viewPly, onSelect }: { san?: string; ply: number; viewPly: number; onSelect: (p: number) => void }) {
  if (!san) return <span className="move" />
  return (
    <button className={`move${ply === viewPly ? ' current' : ''}`} onClick={() => onSelect(ply)}>
      {san}
    </button>
  )
}
