import { useState } from 'react'
import type { MoveTree } from './core/tree'
import type { Color } from './core/types'
import { AnalysisView } from './views/AnalysisView'
import { GamesView } from './views/GamesView'
import { PlayView } from './views/PlayView'

type View = 'play' | 'games' | 'analysis'

const VIEWS: { id: View; label: string; icon: string }[] = [
  { id: 'play', label: 'Play', icon: '♟' },
  { id: 'games', label: 'Games', icon: '☰' },
  { id: 'analysis', label: 'Analysis', icon: '🔍' },
]

/** App shell: all views stay mounted so a running game survives switching tabs. */
export default function App() {
  const [view, setView] = useState<View>('play')
  const [analysisTree, setAnalysisTree] = useState<MoveTree | null>(null)
  const [analysisOrientation, setAnalysisOrientation] = useState<Color>('w')

  const openInAnalysis = (tree: MoveTree, orientation: Color) => {
    setAnalysisTree(tree)
    setAnalysisOrientation(orientation)
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
        <AnalysisView initialTree={analysisTree} initialOrientation={analysisOrientation} active={view === 'analysis'} />
      </div>
    </div>
  )
}
