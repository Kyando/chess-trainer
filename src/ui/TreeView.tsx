import { useEffect, useRef, type ReactNode } from 'react'
import { moveText, type MoveTree, type TreeNode } from '../core/tree'

interface Props {
  tree: MoveTree
  currentId: string
  onSelect: (id: string) => void
}

/**
 * The move tree as text: the main line in bold, variations indented in
 * parentheses below the move they branch from (like lichess / chess.com).
 */
export function TreeView({ tree, currentId, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector('.current')?.scrollIntoView({ block: 'nearest' })
  }, [currentId])

  const move = (node: TreeNode, forceNumber: boolean, main: boolean) => (
    <button
      key={node.id}
      className={`tree-move${main ? ' main' : ''}${node.id === currentId ? ' current' : ''}`}
      onClick={() => onSelect(node.id)}
    >
      {moveText(node, forceNumber)}
    </button>
  )

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
