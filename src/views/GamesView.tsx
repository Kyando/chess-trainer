import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MoveTree } from '../core/tree'
import type { Color } from '../core/types'
import { db, type GameRecord } from '../data/db'
import { DEFAULT_FILTERS, filterGames, formatTimeControl, gameStats, opponentOf, userOf, type GameFilters } from '../data/filters'
import { syncChessCom, type SyncProgress } from '../import/chesscom'
import { InsightsPanel } from '../ui/InsightsPanel'

const USER_KEY = 'chess-trainer.chesscom-user'
const PAGE = 60

const TIME_CLASS_ICON: Record<string, string> = { bullet: '•', blitz: '⚡', rapid: '⏱', daily: '☀' }

interface Props {
  active: boolean
  onOpen: (tree: MoveTree, orientation: Color) => void
}

function readUser(): string {
  try {
    return localStorage.getItem(USER_KEY) ?? ''
  } catch {
    return ''
  }
}

export function GamesView({ active, onOpen }: Props) {
  const [username, setUsername] = useState(readUser)
  const [games, setGames] = useState<GameRecord[] | null>(null)
  const [filters, setFilters] = useState<GameFilters>(DEFAULT_FILTERS)
  const [shown, setShown] = useState(PAGE)
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'list' | 'insights'>('list')
  const abortRef = useRef<AbortController | null>(null)

  const reload = useCallback(() => db.games.orderBy('endTime').reverse().toArray().then(setGames), [])

  // Refresh from IndexedDB when the tab is opened (new bot games may have been saved).
  useEffect(() => {
    if (active) db.games.orderBy('endTime').reverse().toArray().then(setGames)
  }, [active])

  const sync = async () => {
    const user = username.trim()
    if (!user) return
    try {
      localStorage.setItem(USER_KEY, user)
    } catch {
      /* ignore */
    }
    setError(null)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      await syncChessCom(user, {
        db,
        signal: controller.signal,
        onProgress: (p) => {
          setProgress(p)
          if (p.done > 0 && p.done % 6 === 0) void reload()
        },
      })
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e))
    } finally {
      abortRef.current = null
      setProgress(null)
      void reload()
    }
  }

  const filtered = useMemo(() => (games ? filterGames(games, filters) : []), [games, filters])
  const stats = gameStats(filtered)

  const open = async (g: GameRecord) => {
    const record = await db.pgns.get(g.id)
    if (!record) return
    try {
      onOpen(MoveTree.fromPgn(record.pgn), g.userColor)
    } catch (e) {
      setError(`Could not open game: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const setFilter = <K extends keyof GameFilters>(key: K, value: GameFilters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }))
    setShown(PAGE)
  }

  const chips = <K extends keyof GameFilters>(key: K, options: [GameFilters[K], string][]) => (
    <div className="chip-row">
      {options.map(([value, label]) => (
        <button key={String(value)} className={`chip small${filters[key] === value ? ' selected' : ''}`} onClick={() => setFilter(key, value)}>
          {label}
        </button>
      ))}
    </div>
  )

  return (
    <main className="games-view">
      <div className="segmented" role="tablist">
        {(
          [
            ['list', '☰ Games'],
            ['insights', '📊 Insights'],
          ] as const
        ).map(([m, label]) => (
          <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'selected' : ''} onClick={() => setMode(m)}>
            {label}
          </button>
        ))}
      </div>

      {mode === 'list' && (
        <section className="games-sync">
          <form
            className="sync-form"
            onSubmit={(e) => {
              e.preventDefault()
              void sync()
            }}
          >
            <input
              className="text-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="chess.com username"
              aria-label="chess.com username"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              disabled={!!progress}
            />
            {progress ? (
              <button type="button" className="btn secondary" onClick={() => abortRef.current?.abort()}>
                Stop
              </button>
            ) : (
              <button type="submit" className="btn primary sync-btn" disabled={!username.trim()}>
                ⟳ Sync
              </button>
            )}
          </form>
          {progress && (
            <div className="sync-progress">
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
              </div>
              <span className="muted">
                {progress.month ? `Fetching ${progress.month}` : 'Starting'} · {progress.done}/{progress.total} months ·{' '}
                {progress.imported} games
              </span>
            </div>
          )}
          {error && <p className="error">{error}</p>}
        </section>
      )}

      <section className="games-filters">
        {chips('timeClass', [
          ['all', 'All'],
          ['bullet', 'Bullet'],
          ['blitz', 'Blitz'],
          ['rapid', 'Rapid'],
          ['daily', 'Daily'],
        ])}
        <div className="filter-line">
          {chips('color', [
            ['all', 'Both'],
            ['w', 'White'],
            ['b', 'Black'],
          ])}
          {chips('outcome', [
            ['all', 'Any'],
            ['win', 'Won'],
            ['loss', 'Lost'],
            ['draw', 'Drawn'],
          ])}
        </div>
        <div className="filter-line">
          {chips('source', [
            ['all', 'All games'],
            ['chesscom', 'chess.com'],
            ['bot', 'vs bot'],
          ])}
          <input
            className="text-input search"
            value={filters.search}
            onChange={(e) => setFilter('search', e.target.value)}
            placeholder="Opponent or opening"
            aria-label="Search by opponent or opening"
          />
        </div>
      </section>

      {games && games.length > 0 && (
        <div className="games-stats">
          <strong>
            {stats.total} {stats.total === 1 ? 'game' : 'games'}
          </strong>
          <span className="stat win">{stats.winPct}% won</span>
          <span className="stat draw">{stats.drawPct}% drawn</span>
          <span className="stat loss">{stats.lossPct}% lost</span>
        </div>
      )}

      {mode === 'insights' ? (
        games && <InsightsPanel games={filtered} />
      ) : games === null ? null : games.length === 0 ? (
        <p className="empty-state">
          No games yet. Enter your chess.com username and press <strong>Sync</strong> to import your history — or play
          the bot; finished games are saved here too.
        </p>
      ) : (
        <ul className="games-list">
          {filtered.slice(0, shown).map((g) => {
            const opp = opponentOf(g)
            const me = userOf(g)
            return (
              <li key={g.id}>
                <button className="game-row" onClick={() => open(g)}>
                  <span className={`outcome-bar ${g.outcome}`} aria-label={g.outcome} />
                  <span className="game-tc" title={g.timeClass}>
                    <span aria-hidden>{TIME_CLASS_ICON[g.timeClass]}</span>
                    <span className="tc-text">{formatTimeControl(g.timeControl)}</span>
                  </span>
                  <span className="game-main">
                    <span className="game-players">
                      <span className={`color-dot ${g.userColor === 'w' ? 'black' : 'white'}`} aria-hidden />
                      {opp.name}
                      {opp.rating !== undefined && <span className="muted"> ({opp.rating})</span>}
                      {me.rating !== undefined && <span className="muted my-rating"> · me {me.rating}</span>}
                    </span>
                    <span className="game-opening">{g.opening ?? g.eco ?? '—'}</span>
                  </span>
                  <span className="game-meta">
                    <span className={`outcome-badge ${g.outcome}`}>{g.outcome === 'win' ? '+' : g.outcome === 'loss' ? '−' : '='}</span>
                    <span className="muted">{Math.ceil(g.plies / 2)} mv</span>
                    <span className="muted">{new Date(g.endTime).toLocaleDateString()}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {mode === 'list' && filtered.length > shown && (
        <button className="btn secondary show-more" onClick={() => setShown((n) => n + PAGE)}>
          Show more ({filtered.length - shown} left)
        </button>
      )}
    </main>
  )
}
