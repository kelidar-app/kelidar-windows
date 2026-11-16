import { describe, expect, it } from 'vitest'
import { looksLikeSudoPrompt } from '../../src/main/ssh/sudo'
import { COMMAND_KEYS, comboLabel, findByKey } from '../../src/renderer/app/key-combos'
import {
  dropPreview,
  dropSide,
  insertLayout,
  MAX_PANES,
  neighbour,
  paneIds,
  paneLeaf,
  paneRects,
  removePane,
  resizePane,
  setRatio,
  splitPane,
  splitRects,
  type Layout,
} from '../../src/renderer/features/terminal/layout'
import { isMultiLine } from '../../src/renderer/stores/terminal-ui'
import { terminalFontFamilySchema } from '../../src/shared/settings'

/**
 *  a | b
 *  --+--
 *  a | c      (a on the left, b over c on the right)
 */
function threePanes(): Layout {
  let layout = splitPane(paneLeaf('a'), 'a', 'b', 'beside')
  layout = splitPane(layout, 'b', 'c', 'below')
  return layout
}

describe('pane layout', () => {
  it('splits a pane beside or below and lists panes in reading order', () => {
    const layout = threePanes()
    expect(paneIds(layout)).toEqual(['a', 'b', 'c'])
    const rects = paneRects(layout)
    expect(rects.get('a')).toEqual({ x: 0, y: 0, width: 0.5, height: 1 })
    expect(rects.get('b')).toEqual({ x: 0.5, y: 0, width: 0.5, height: 0.5 })
    expect(rects.get('c')).toEqual({ x: 0.5, y: 0.5, width: 0.5, height: 0.5 })
  })

  it('removes a pane and lets its sibling take the space', () => {
    const layout = threePanes()
    const withoutB = removePane(layout, 'b')
    expect(withoutB === null ? [] : paneIds(withoutB)).toEqual(['a', 'c'])
    expect(withoutB === null ? null : paneRects(withoutB).get('c')).toEqual({
      x: 0.5,
      y: 0,
      width: 0.5,
      height: 1,
    })
    expect(removePane(paneLeaf('a'), 'a')).toBeNull()
  })

  it('finds the neighbour in each direction', () => {
    const layout = threePanes()
    expect(neighbour(layout, 'a', 'right')).toBe('b')
    expect(neighbour(layout, 'b', 'down')).toBe('c')
    expect(neighbour(layout, 'c', 'up')).toBe('b')
    expect(neighbour(layout, 'c', 'left')).toBe('a')
    expect(neighbour(layout, 'a', 'left')).toBeUndefined()
    expect(neighbour(layout, 'a', 'up')).toBeUndefined()
  })

  it('gives each divider its place, for drawing and dragging', () => {
    const splits = splitRects(threePanes())
    expect(splits).toEqual([
      { path: [], direction: 'beside', ratio: 0.5, area: { x: 0, y: 0, width: 1, height: 1 } },
      {
        path: ['second'],
        direction: 'below',
        ratio: 0.5,
        area: { x: 0.5, y: 0, width: 0.5, height: 1 },
      },
    ])
  })

  it('moves the nearest divider and keeps both parts usable', () => {
    const layout = threePanes()
    const wider = resizePane(layout, 'a', 'right')
    expect(paneRects(wider).get('a')?.width).toBeCloseTo(0.55)
    const taller = resizePane(layout, 'c', 'up')
    expect(paneRects(taller).get('b')?.height).toBeCloseTo(0.45)
    // A pane with no divider in that direction stays as it is.
    expect(resizePane(paneLeaf('a'), 'a', 'right')).toEqual(paneLeaf('a'))
    // Dragging past the edge stops at 15% / 85%.
    expect(paneRects(setRatio(layout, [], 0.01)).get('a')?.width).toBeCloseTo(0.15)
    expect(paneRects(setRatio(layout, ['second'], 0.99)).get('b')?.height).toBeCloseTo(0.85)
  })
})

describe('dropping a tab into another tab', () => {
  it('picks the pane side nearest to the pointer', () => {
    expect(dropSide(0.1, 0.5)).toBe('left')
    expect(dropSide(0.95, 0.4)).toBe('right')
    expect(dropSide(0.5, 0.05)).toBe('top')
    expect(dropSide(0.4, 0.9)).toBe('bottom')
  })

  it('previews the half the dropped tab takes', () => {
    const rect = { x: 0.5, y: 0, width: 0.5, height: 1 }
    expect(dropPreview(rect, 'left')).toEqual({ x: 0.5, y: 0, width: 0.25, height: 1 })
    expect(dropPreview(rect, 'bottom')).toEqual({ x: 0.5, y: 0.5, width: 0.5, height: 0.5 })
  })

  it("puts the whole dropped tab on that side of the pane, keeping the tab's own splits", () => {
    const dropped = splitPane(paneLeaf('x'), 'x', 'y', 'below')
    const left = insertLayout(threePanes(), 'c', dropped, 'left')
    expect(paneIds(left)).toEqual(['a', 'b', 'x', 'y', 'c'])
    const rects = paneRects(left)
    expect(rects.get('x')).toEqual({ x: 0.5, y: 0.5, width: 0.25, height: 0.25 })
    expect(rects.get('c')).toEqual({ x: 0.75, y: 0.5, width: 0.25, height: 0.5 })
    const below = insertLayout(paneLeaf('a'), 'a', paneLeaf('x'), 'bottom')
    expect(paneRects(below).get('x')).toEqual({ x: 0, y: 0.5, width: 1, height: 0.5 })
    expect(MAX_PANES).toBe(8)
  })
})

describe('sudo prompt detection', () => {
  it('spots sudo and doas password prompts at the end of the output', () => {
    expect(looksLikeSudoPrompt('$ sudo apt update\r\n[sudo] password for deploy: ')).toBe(true)
    expect(looksLikeSudoPrompt('\x1b[1m[sudo] password for ali:\x1b[0m ')).toBe(true)
    expect(looksLikeSudoPrompt('[sudo: authenticate] Password: ')).toBe(true)
    expect(looksLikeSudoPrompt('doas (deploy@web1) password: ')).toBe(true)
    expect(looksLikeSudoPrompt('Password:')).toBe(true)
  })

  it('ignores prompts that are already answered or are not password prompts', () => {
    expect(looksLikeSudoPrompt('[sudo] password for deploy: \r\nroot\r\n$ ')).toBe(false)
    expect(looksLikeSudoPrompt('Enter the new password for the database user:')).toBe(false)
    expect(looksLikeSudoPrompt('echo "[sudo] password for x:" && ls')).toBe(false)
    expect(looksLikeSudoPrompt('')).toBe(false)
  })
})

describe('terminal shortcuts', () => {
  const items = Object.entries(COMMAND_KEYS).map(([id, combos]) => ({
    id,
    combos,
    available: () => true,
  }))
  const press = (code: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean }) =>
    findByKey(
      {
        code,
        ctrlKey: mods.ctrl === true,
        altKey: mods.alt === true,
        shiftKey: mods.shift === true,
        metaKey: false,
      },
      true,
      items,
    )?.id ?? null

  it('moves between panes with Alt+Arrow and resizes with Alt+Shift+Arrow', () => {
    expect(press('ArrowLeft', { alt: true })).toBe('focusLeft')
    expect(press('ArrowDown', { alt: true, shift: true })).toBe('resizeDown')
    expect(press('ArrowLeft', { ctrl: true, alt: true })).toBeNull()
    expect(press('ArrowLeft', {})).toBeNull()
  })

  it('zooms with Ctrl+=, Ctrl+- and Ctrl+0, and labels Alt shortcuts', () => {
    expect(press('Equal', { ctrl: true })).toBe('zoomIn')
    expect(press('Minus', { ctrl: true })).toBe('zoomOut')
    expect(press('Digit0', { ctrl: true })).toBe('zoomReset')
    expect(press('KeyD', { ctrl: true, shift: true })).toBe('splitRight')
    expect(comboLabel({ code: 'ArrowRight', ctrl: false, alt: true, shift: true })).toBe(
      'Alt+Shift+→',
    )
  })
})

describe('paste guard', () => {
  it('treats any line break as a command that runs at once', () => {
    expect(isMultiLine('ls')).toBe(false)
    expect(isMultiLine('ls\n')).toBe(true)
    expect(isMultiLine('a\r\nb')).toBe(true)
    expect(isMultiLine('a\rb')).toBe(true)
  })
})

describe('terminal font setting', () => {
  it('accepts CSS font lists and refuses anything that could break out of one', () => {
    expect(terminalFontFamilySchema.safeParse("'Cascadia Mono', Consolas").success).toBe(true)
    expect(terminalFontFamilySchema.safeParse('Vazirmatn, monospace').success).toBe(true)
    expect(terminalFontFamilySchema.safeParse('x; background: url(evil)').success).toBe(false)
    expect(terminalFontFamilySchema.safeParse('a</style>').success).toBe(false)
  })
})
