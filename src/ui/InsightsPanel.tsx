import { useEffect, useMemo, useState } from 'react'
import { db, type GameRecord } from '../data/db'
import { gameStats } from '../data/filters'
import { errorsByClock, errorsByPhase, openingStats, type ErrorRate, type MoveSample, type OpeningRow } from '../insights/insights'
import { loadMoveSamples } from '../insights/load'

interface Props {
  /** Games matching the current filters. */
  games: GameRecord[]
}

/** Results by opening and color, and where my errors happen (phase, clock). */
export function InsightsPanel({ games }: Props) {
  const [loaded, setLoaded] = useState<{ games: GameRecord[]; samples: MoveSample[]; reviewed: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadMoveSamples(db, games).then((r) => {
      if (!cancelled) setLoaded({ games, ...r })
    })
    return () => {
      cancelled = true
    }
  }, [games])

  const openings = useMemo(() => openingStats(games), [games])
  const ready = loaded?.games === games ? loaded : null

  if (games.length === 0) return <p className="empty-state">No games match these filters.</p>

  return (
    <div className="insights">
      <section className="insight-card">
        <h3>By color</h3>
        <div className="color-split">
          {(['w', 'b'] as const).map((c) => {
            const s = gameStats(games.filter((g) => g.userColor === c))
            return (
              <div key={c} className="color-stat">
                <span className={`color-dot ${c === 'w' ? 'white' : 'black'}`} aria-hidden /> {c === 'w' ? 'White' : 'Black'}
                <strong title="Score: wins plus half the draws">{s.total ? `${Math.round(s.winPct + s.drawPct / 2)}%` : '—'}</strong>
                <span className="muted">
                  {s.total} games · {s.winPct}% won · {s.lossPct}% lost
                </span>
              </div>
            )
          })}
        </div>
      </section>

      {(['w', 'b'] as const).map((c) => (
        <OpeningTable key={c} title={`Openings as ${c === 'w' ? 'White' : 'Black'}`} rows={openings.filter((r) => r.color === c)} />
      ))}

      <section className="insight-card">
        <h3>Where your errors happen</h3>
        {!ready ? (
          <p className="muted">Loading reviews…</p>
        ) : ready.reviewed === 0 ? (
          <p className="muted">
            Needs engine reviews: scan some games in the <strong>Puzzles</strong> tab first.
          </p>
        ) : (
          <>
            <p className="muted hint">
              Mistakes, misses and blunders per 100 of your moves, from {ready.reviewed} reviewed{' '}
              {ready.reviewed === 1 ? 'game' : 'games'} ({ready.samples.length} moves); the red part is blunders. Scan
              more games in Puzzles for a sharper picture.
            </p>
            <RateBars title="By game phase" rows={errorsByPhase(ready.samples)} />
            <RateBars title="By time left on your clock" rows={errorsByClock(ready.samples)} />
          </>
        )}
      </section>
    </div>
  )
}

const MAX_OPENINGS = 8

function OpeningTable({ title, rows }: { title: string; rows: OpeningRow[] }) {
  if (rows.length === 0) return null
  return (
    <section className="insight-card">
      <h3>{title}</h3>
      <table className="opening-table">
        <thead>
          <tr>
            <th>Opening</th>
            <th>Games</th>
            <th>Results</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, MAX_OPENINGS).map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td className="num">{r.games}</td>
              <td>
                <span className="wdl-bar" title={`${r.wins} won, ${r.draws} drawn, ${r.losses} lost`}>
                  <span className="win" style={{ flex: r.wins }} />
                  <span className="draw" style={{ flex: r.draws }} />
                  <span className="loss" style={{ flex: r.losses }} />
                </span>
              </td>
              <td className={`num ${r.games >= 10 ? (r.score < 40 ? 'bad' : r.score > 60 ? 'good' : '') : ''}`}>{r.score}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > MAX_OPENINGS && <p className="muted hint">+{rows.length - MAX_OPENINGS} less played openings</p>}
    </section>
  )
}

function RateBars({ title, rows }: { title: string; rows: ErrorRate[] }) {
  const max = Math.max(1, ...rows.map((r) => r.errorRate))
  return (
    <div className="rate-bars">
      <h4>{title}</h4>
      {rows.map((r) => (
        <div key={r.label} className="rate-row">
          <span className="rate-label">{r.label}</span>
          <span className="rate-track" title={`${r.errors} errors (${r.blunders} blunders) in ${r.moves} moves`}>
            <span className="rate-fill" style={{ width: `${(r.errorRate / max) * 100}%` }} />
            <span className="rate-fill blunder" style={{ width: `${(r.blunderRate / max) * 100}%` }} />
          </span>
          <span className="rate-value">{r.moves ? r.errorRate : '—'}</span>
          <span className="muted rate-moves">{r.moves} mv</span>
        </div>
      ))}
    </div>
  )
}
