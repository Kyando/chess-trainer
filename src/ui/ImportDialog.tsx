import { Chess } from 'chess.js'
import { useState } from 'react'
import { MoveTree } from '../core/tree'

interface Props {
  onImport: (tree: MoveTree) => void
  onCancel: () => void
}

/** Paste a PGN (with variations) or a FEN to analyse. */
export function ImportDialog({ onImport, onCancel }: Props) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    const input = text.trim()
    if (!input) return
    try {
      if (looksLikeFen(input)) {
        new Chess(input) // throws on an invalid FEN
        onImport(new MoveTree(input))
      } else {
        onImport(MoveTree.fromPgn(input))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal aria-labelledby="import-title">
      <div className="dialog">
        <h2 id="import-title">Import PGN or FEN</h2>
        <textarea
          className="import-text"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
          placeholder={'1. e4 e5 2. Nf3 Nc6 …\n\nor a FEN like\nrnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'}
          rows={9}
          autoFocus
        />
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          <button className="btn secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={!text.trim()}>
            Load
          </button>
        </div>
      </div>
    </div>
  )
}

const looksLikeFen = (s: string) => /^[pnbrqkPNBRQK1-8]+(\/[pnbrqkPNBRQK1-8]+){7}\s+[wb]\b/.test(s)
