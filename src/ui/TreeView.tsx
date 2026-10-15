import { useEffect, useRef, type ReactNode } from 'react'
import { moveText, type MoveTree, type TreeNode } from '../core/tree'
import { CLASS_INFO, type MoveClass } from '../review/review'

interface Props {
  tree: MoveTree
  currentId: string
  onSelect: (id: string) => void
  /** Game Review classifications by node id; notable ones get a glyph. */
  classes?: Map<string, MoveClass>
}

const NOTABLE: ReadonlySet<MoveClass> = new Set(['great', 'inaccuracy', 'mistake', 'miss', 'blunder'])

/**
 * The move tree as text: the main line in bold, variations indented in
 * parentheses below the move they branch from (like lichess / chess.com).
 */
export function TreeView({ tree, currentId, onSelect, classes }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Scroll only the move list: scrollIntoView would also scroll the page
    // and push the board out of view on phones.
    const box = ref.current
    const el = box?.querySelector<HTMLElement>('.current')
    if (!box || !el) return
    const top = el.offsetTop
    if (top < box.scrollTop) box.scrollTop = top - 4
    else if (top + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + el.offsetHeight - box.clientHeight + 4
  }, [currentId])

  const move = (node: TreeNode, forceNumber: boolean, main: boolean) => {
    const cls = classes?.get(node.id)
    const info = cls && NOTABLE.has(cls) ? CLASS_INFO[cls] : undefined
    return (
      <button
        key={node.id}
        className={`tree-move${main ? ' main' : ''}${node.id === currentId ? ' current' : ''}`}
        onClick={() => onSelect(node.id)}
        style={info ? { color: info.color } : undefined}
      >
        {moveText(node, forceNumber)}
        {info && <span className="tree-glyph">{info.glyph}</span>}
      </button>
    )
  }

  /** Renders the line continuing after `start`. */
  const line = (start: TreeNode, main: boolean, forceFirstNumber: boolean): ReactNode[] => {
    const out: ReactNode[] = []
    let n = start
    let needNumber = forceFirstNumber
    while (n.children.length) {
      const [first, ...alts] = n.children.map((c) => tree.get(c))
      out.push(move(first, needNumber, main))
      if (first.comment) out.push(<span key={`c${first.id}`} className="tree-comment">{first.comment}</span>)
      for (const alt of alts) {
        out.push(
          <div key={`v${alt.id}`} className="variation">
            {move(alt, true, false)}
            {line(alt, false, false)}
          </div>,
        )
      }
      needNumber = alts.length > 0 || !!first.comment
      n = first
    }
    return out
  }

  const root = tree.root
  return (
    <div className="tree" ref={ref}>
      {root.children.length === 0 ? (
        <span className="muted">Move pieces on the board, or import a PGN.</span>
      ) : (
        line(root, true, true)
      )}
    </div>
  )
}
