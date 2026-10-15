import { describe, expect, it } from 'vitest'
import { MoveTree, moveText } from './tree'

const sans = (tree: MoveTree, ids: string[]) => ids.map((id) => tree.get(id).move?.san)

describe('MoveTree', () => {
  it('adds moves and reuses existing children', () => {
    const t = new MoveTree()
    const e4 = t.addMove(t.rootId, 'e4')!
    expect(t.addMove(t.rootId, { from: 'e2', to: 'e4' })!.id).toBe(e4.id)
    expect(t.addMove(t.rootId, 'e5')).toBeNull()
    const d4 = t.addMove(t.rootId, 'd4')!
    expect(t.root.children).toEqual([e4.id, d4.id])
    expect(t.isMainline(e4.id)).toBe(true)
    expect(t.isMainline(d4.id)).toBe(false)
  })

  it('promotes and deletes variations', () => {
    const t = MoveTree.fromMoves(['e4', 'e5', 'Nf3'])
    const c5 = t.addMove(t.mainline()[0].id, 'c5')!
    const nf3 = t.addMove(c5.id, 'Nf3')!
    t.promote(nf3.id)
    expect(t.mainline().map((n) => n.move!.san)).toEqual(['e4', 'c5', 'Nf3'])
    t.delete(c5.id)
    expect(t.mainline().map((n) => n.move!.san)).toEqual(['e4', 'e5', 'Nf3'])
    expect(t.nodes.has(nf3.id)).toBe(false)
  })

  it('parses PGN with headers, comments, NAGs and nested variations', () => {
    const t = MoveTree.fromPgn(`[Event "Test"]
[White "Me"]

1. e4 e5 (1... c5 2. Nf3 (2. c3 d5) 2... d6) 2. Nf3! {good move} $1 Nc6 3. Bb5 a6 1-0`)
    expect(t.headers.White).toBe('Me')
    expect(t.mainline().map((n) => n.move!.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'])
    const e4 = t.mainline()[0]
    expect(sans(t, e4.children)).toEqual(['e5', 'c5'])
    const c5 = t.get(e4.children[1])
    const nf3 = t.get(c5.children[0])
    expect(sans(t, c5.children)).toEqual(['Nf3', 'c3'])
    expect(sans(t, nf3.children)).toEqual(['d6'])
    expect(t.mainline()[2].comment).toBe('good move')
  })

  it('round-trips PGN', () => {
    const pgn = '1. e4 e5 (1... c5 2. Nf3 (2. c3 d5) 2... d6) 2. Nf3 {good} 2... Nc6 *'
    const t = MoveTree.fromPgn(pgn)
    const again = MoveTree.fromPgn(t.toPgn())
    expect(again.toPgn()).toBe(t.toPgn())
    expect(t.toPgn().replace(/\s+/g, ' ')).toContain('1. e4 e5 (1... c5 2. Nf3 (2. c3 d5) 2... d6) 2. Nf3 {good} 2... Nc6 *')
  })

  it('supports a custom start position', () => {
    const t = MoveTree.fromPgn('[FEN "8/8/8/4k3/8/8/4P3/4K3 b - - 0 40"]\n\n40... Kd5 41. Kd2 *')
    expect(t.root.ply).toBe(79)
    expect(moveText(t.mainline()[0], true)).toBe('40... Kd5')
    expect(t.toPgn()).toContain('[FEN "8/8/8/4k3/8/8/4P3/4K3 b - - 0 40"]')
  })

  it('rejects illegal PGN moves', () => {
    expect(() => MoveTree.fromPgn('1. e4 e4')).toThrow(/Illegal move/)
  })
})
