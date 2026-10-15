import { useState } from 'react'
import type { MoveTree } from './core/tree'
import type { Color } from './core/types'
import { AnalysisView } from './views/AnalysisView'
import { GamesView } from './views/GamesView'
import { PlayView } from './views/PlayView'
import { PuzzlesView } from './views/PuzzlesView'

type View = 'play' | 'games' | 'analysis' | 'puzzles'

const VIEWS: { id: View; label: string; icon: string }[] = [
  { id: 'play', label: 'Play', icon: '♟' },
  { id: 'games', label: 'Games', icon: '☰' },
  { id: 'analysis', label: 'Analysis', icon: '🔍' },
  { id: 'puzzles', label: 'Train', icon: '🎯' },
]

/** App shell: all views stay mounted so a running game survives switching tabs. */
export default function App() {
  const [view, setView] = useState<View>('play')
  const [analysisTree, setAnalysisTree] = useState<MoveTree | null>(null)
  const [analysisOrientation, setAnalysisOrientation] = useState<Color>('w')
  const [analysisPosition, setAnalysisPosition] = useState(0)

  /** Opens a game in analysis, at main-line position `position` (0 = start). */
  const openInAnalysis = (tree: MoveTree, orientation: Color, position = 0) => {
    setAnalysisTree(tree)
    setAnalysisOrientation(orientation)
    setAnalysisPosition(position)
    setView('analysis')
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          ♞<span className="brand-text"> Chess Trainer</span>
        </span>
        <nav className="tabs">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={`tab${view === v.id ? ' active' : ''}`}
              onClick={() => setView(v.id)}
              aria-current={view === v.id ? 'page' : undefined}
            >
              <span aria-hidden>{v.icon}</span> {v.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="view" hidden={view !== 'play'}>
        <PlayView active={view === 'play'} onAnalyze={openInAnalysis} />
      </div>
      <div className="view" hidden={view !== 'games'}>
        <GamesView active={view === 'games'} onOpen={openInAnalysis} />
      </div>
      <div className="view" hidden={view !== 'analysis'}>
        <AnalysisView
          initialTree={analysisTree}
          initialOrientation={analysisOrientation}
          initialPosition={analysisPosition}
          active={view === 'analysis'}
        />
      </div>
      <div className="view" hidden={view !== 'puzzles'}>
        <PuzzlesView active={view === 'puzzles'} paused={view === 'play'} onOpenGame={openInAnalysis} />
      </div>
    </div>
  )
}
