import { useState } from 'react'
import { sameTimeControl, TIME_CONTROLS, type GameSettings } from '../core/settings'
import { BOT_LEVELS } from '../engine/bot'

interface Props {
  initial: GameSettings
  onStart: (settings: GameSettings) => void
  onCancel: () => void
}

export function NewGameDialog({ initial, onStart, onCancel }: Props) {
  const [settings, setSettings] = useState(initial)
  const groups = [...new Set(TIME_CONTROLS.map((t) => t.group))]
  const level = BOT_LEVELS.find((l) => l.id === settings.botLevel)!

  return (
    <div className="overlay" role="dialog" aria-modal aria-labelledby="new-game-title">
      <div className="dialog">
        <h2 id="new-game-title">Play vs computer</h2>

        <section>
          <h3>Time control</h3>
          {groups.map((g) => (
            <div key={g} className="tc-group">
              <span className="tc-group-label">{g}</span>
              <div className="chip-row">
                {TIME_CONTROLS.filter((t) => t.group === g).map((t) => (
                  <button
                    key={t.label}
                    className={`chip${sameTimeControl(t.tc, settings.timeControl) ? ' selected' : ''}`}
                    onClick={() => setSettings({ ...settings, timeControl: t.tc })}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section>
          <h3>
            Bot strength <span className="muted">— {level.name} (≈{level.approxElo})</span>
          </h3>
          <input
            type="range"
            min={1}
            max={BOT_LEVELS.length}
            value={settings.botLevel}
            onChange={(e) => setSettings({ ...settings, botLevel: Number(e.target.value) })}
            aria-label="Bot strength"
          />
        </section>

        <section>
          <h3>I play as</h3>
          <div className="chip-row">
            {(
              [
                ['w', 'White'],
                ['random', 'Random'],
                ['b', 'Black'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={`chip${settings.color === value ? ' selected' : ''}`}
                onClick={() => setSettings({ ...settings, color: value })}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3>Training</h3>
          <button
            className={`chip${settings.blunderCheck ? ' selected' : ''}`}
            aria-pressed={!!settings.blunderCheck}
            onClick={() => setSettings({ ...settings, blunderCheck: !settings.blunderCheck })}
          >
            🛡 Blunder check
          </button>
          <p className="muted hint">Before each move, name what the bot threatens. Best with a slow clock or none.</p>
        </section>

        <div className="dialog-actions">
          <button className="btn secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => onStart(settings)}>
            Play
          </button>
        </div>
      </div>
    </div>
  )
}
