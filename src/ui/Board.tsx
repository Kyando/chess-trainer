import { Chessground } from 'chessground'
import type { Api } from 'chessground/api'
import type { Config } from 'chessground/config'
import type { Key } from 'chessground/types'
import { useEffect, useLayoutEffect, useRef } from 'react'
import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.cburnett.css'
import './board-theme.css'

export interface Arrow {
  from: string
  /** Omitted: a circle on `from`. */
  to?: string
  brush: 'green' | 'red' | 'blue' | 'yellow' | 'paleBlue' | 'paleGreen' | 'paleRed' | 'paleGrey'
}

export interface Badge {
  square: string
  /** One or two characters. */
  glyph: string
  color: string
}

export interface BoardProps {
  fen: string
  orientation: 'white' | 'black'
  turnColor: 'white' | 'black'
  /** Which side the user may move (and premove); 'both' for analysis; undefined = view only. */
  movableColor?: 'white' | 'black' | 'both'
  dests: Map<string, string[]>
  lastMove?: [string, string]
  check: boolean
  /** Arrows drawn by the app (e.g. the engine's best move), separate from the user's own. */
  arrows?: Arrow[]
  /** Small round badges in a square's corner (e.g. Game Review's move classification). */
  badges?: Badge[]
  /** Bump to force the board back in sync (e.g. after a cancelled promotion). */
  syncKey?: number
  /** `premove` is true when a queued premove was just played. */
  onMove: (from: string, to: string, premove: boolean) => void
}

/** Thin React wrapper around chessground (the lichess board). */
export function Board(props: BoardProps) {
  const el = useRef<HTMLDivElement>(null)
  const api = useRef<Api | null>(null)
  const onMove = useRef(props.onMove)
  useLayoutEffect(() => {
    onMove.current = props.onMove
  })

  useEffect(() => {
    if (!el.current) return
    api.current = Chessground(el.current, {
      animation: { enabled: true, duration: 180 },
      highlight: { lastMove: true, check: true },
      premovable: { enabled: true, showDests: true, castle: true },
      draggable: { enabled: true, showGhost: true },
      drawable: { enabled: true, eraseOnClick: true },
      movable: {
        free: false,
        showDests: true,
        events: { after: (orig, dest, meta) => onMove.current(orig, dest, meta.premove) },
      },
    })
    const observer = new ResizeObserver(() => api.current?.redrawAll())
    observer.observe(el.current)
    return () => {
      observer.disconnect()
      api.current?.destroy()
      api.current = null
    }
  }, [])

  const lastMoveKey = props.lastMove?.join('')
  useEffect(() => {
    const cg = api.current
    if (!cg) return
    const config: Config = {
      fen: props.fen,
      orientation: props.orientation,
      turnColor: props.turnColor,
      check: props.check,
      lastMove: lastMoveKey ? [lastMoveKey.slice(0, 2), lastMoveKey.slice(2, 4)] as Key[] : undefined,
      viewOnly: false,
      movable: {
        color: props.movableColor,
        dests: props.dests as Map<Key, Key[]>,
      },
    }
    cg.set(config)
    if (!props.movableColor) cg.cancelPremove()
    // A premove queued during the opponent's turn fires as soon as it is ours.
    else if (props.turnColor === props.movableColor) cg.playPremove()
  }, [props.fen, props.orientation, props.turnColor, props.movableColor, props.dests, lastMoveKey, props.check, props.syncKey])

  const shapesKey = JSON.stringify([props.arrows ?? [], props.badges ?? []])
  useEffect(() => {
    const [arrows, badges]: [Arrow[], Badge[]] = JSON.parse(shapesKey)
    api.current?.setAutoShapes([
      ...arrows.map((a) => ({ orig: a.from as Key, dest: a.to as Key | undefined, brush: a.brush })),
      ...badges.map((b) => ({ orig: b.square as Key, customSvg: { html: badgeSvg(b) } })),
    ])
  }, [shapesKey])

  return <div ref={el} className="cg-wrap board" />
}

/** Badge drawn in the square's top-right corner; the square spans -50..50 around 0,0. */
function badgeSvg({ glyph, color }: Badge): string {
  const size = glyph.length > 1 ? 21 : 26
  return (
    `<g transform="translate(32 -32)"><circle r="22" fill="${color}" stroke="#fff" stroke-width="3"/>` +
    `<text text-anchor="middle" dominant-baseline="central" y="1" font-size="${size}" font-weight="800" ` +
    `font-family="system-ui, sans-serif" fill="#fff">${glyph}</text></g>`
  )
}
