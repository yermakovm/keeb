/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Layout presets — how the switches are *arranged*, not what they do.
 *
 * A preset answers one question: for each row of a half, which of the column
 * slots hold a switch. It says nothing about bindings, layers or positions; a
 * position number still comes from the firmware's matrix transform, and a
 * preset only decides where that number gets drawn.
 *
 * The default, `cosmotyl`, is not hand-drawn: it is read back out of GRID, so
 * the preset and the board the configurator is talking to cannot drift apart.
 * The other presets are real boards, and they are offered anyway — a preset
 * that does not have a slot for every position the keyboard reports is a
 * *mismatch the view reports*, not something that gets silently dropped.
 */

import { GRID, GRID_COLS, GRID_ROWS } from '../proto/zmk.gen.ts'

export type Side = 'L' | 'R'

export interface LayoutRow {
  /** slot indices inside the left half, 0 = outer edge, last = split gap */
  slots: number[]
  /**
   * Slot indices inside the right half, 0 = split gap, last = outer edge.
   * Omitted when the row is mirror-symmetric, which every alpha row is; it has
   * to be given when it is not, which the thumb cluster is not.
   */
  right?: number[]
  /** nudge this row toward the split, in columns */
  shift?: number
  /** draw this row further down, in rows; the gap a thumb cluster sits in */
  drop?: number
}

export interface LayoutPreset {
  id: string
  label: string
  /** columns drawn per half */
  cols: number
  rows: LayoutRow[]
  note: string
}

/** The mirror of a row's slots: the firmware's own rule, col c -> cols-1-c. */
export const mirrored = (row: LayoutRow, cols: number): number[] =>
  (row.right ?? row.slots.map((s) => cols - 1 - s)).slice().sort((a, b) => a - b)

const slotCount = (p: LayoutPreset): number =>
  p.rows.reduce((n, r) => n + r.slots.length + mirrored(r, p.cols).length, 0)

/**
 * The board this configurator is built for, derived from the generated grid —
 * which is derived from the matrix transform in keeb.dtsi. If the board's
 * layout changes, this changes with it.
 */
const cosmotyl = (): LayoutPreset => {
  const rows: LayoutRow[] = []
  const cols = GRID_COLS / 2

  for (let row = 0; row < GRID_ROWS; row++) {
    const left = new Set<number>()
    const right = new Set<number>()

    for (const cell of GRID) {
      if (cell.row !== row) {
        continue
      }

      // Slot is counted from the half's own outer edge: the left half runs cols
      // 0-5 outward->gap, the right half runs cols 11-6 gap->outward.
      if (cell.side === 'L') {
        left.add(cell.col)
      } else {
        right.add(GRID_COLS - 1 - cell.col)
      }
    }

    if (left.size === 0 && right.size === 0) {
      continue
    }

    const l = [...left].sort((a, b) => a - b)
    const r = [...right].sort((a, b) => a - b)

    // The rows below the alpha block are the thumb cluster. Its slots are
    // already inset - left 2-5, right 0-3 - so the only thing left to say is the
    // vertical gap it sits in.
    const thumbRow = row >= 4

    rows.push({
      slots: l,
      // Given explicitly rather than mirrored: the thumb row is not symmetric,
      // and a mirrored guess here would move a thumb key to the wrong edge.
      right: r,
      drop: thumbRow ? (row === 4 ? 0.5 : 0.15) : 0,
    })
  }

  return {
    id: 'cosmotyl',
    label: 'cosmotyl',
    cols,
    rows,
    note: 'this board: 4×6 alpha per half, 2 extra keys per half, 4-key thumb cluster',
  }
}

const PRESETS: LayoutPreset[] = [
  cosmotyl(),
  {
    id: 'corne',
    label: 'corne / crkbd (42)',
    cols: 6,
    rows: [
      { slots: [0, 1, 2, 3, 4, 5] },
      { slots: [0, 1, 2, 3, 4, 5] },
      { slots: [0, 1, 2, 3, 4, 5] },
      { slots: [0, 1, 2, 3, 4, 5] },
      { slots: [2, 3, 4], shift: 1, drop: 0.5 },
    ],
    note: '42 keys: 4×6 alpha, 3-key thumb cluster',
  },
  {
    id: 'sofle',
    label: 'sofle (64)',
    cols: 7,
    rows: [
      { slots: [0, 1, 2, 3, 4, 5, 6] },
      { slots: [0, 1, 2, 3, 4, 5, 6] },
      { slots: [0, 1, 2, 3, 4, 5, 6] },
      { slots: [0, 1, 2, 3, 4, 5, 6] },
      { slots: [0, 1, 2, 3, 4, 5, 6] },
      { slots: [1, 2, 3, 4, 5, 6] },
      { slots: [0, 1, 2, 3], shift: 1, drop: 0.5 },
    ],
    note: '64 keys: 6 rows of 7 with a column stagger, 4-key thumb cluster',
  },
  {
    id: 'grid6',
    label: 'plain 6×6 (72)',
    cols: 6,
    rows: Array.from({ length: 6 }, () => ({ slots: [0, 1, 2, 3, 4, 5] })),
    note: 'no thumb cluster, no stagger — the grid a matrix would have if it had no shape',
  },
]

export const LAYOUTS: LayoutPreset[] = PRESETS
export const DEFAULT_LAYOUT = LAYOUTS[0].id
export const layoutSlots = slotCount

export const findLayout = (id: string): LayoutPreset => LAYOUTS.find((p) => p.id === id) ?? LAYOUTS[0]

export interface Placed {
  /** per drawn row, per side, one entry per drawn column slot: the position there, or null */
  rows: Array<{ row: LayoutRow; index: number; drop: number; left: (number | null)[]; right: (number | null)[] }>
  /** positions the keyboard reports that this preset has nowhere to draw */
  overflow: number[]
  /** slots the preset draws that this keyboard has no switch for */
  empty: number
  /** true when the preset's slot count equals the board's position count */
  fits: boolean
}

/**
 * Put the board's positions into a preset's slots.
 *
 * Positions are taken in the order the transform lists them — which is physical
 * order, outer edge to split gap on the left and gap to outer edge on the right
 * — and dropped into the preset's slots in the same order. When the preset and
 * the board agree, that is identity. When they do not, what does not fit is
 * returned as `overflow` rather than dropped.
 */
export function placeKeys(preset: LayoutPreset, positions: number[]): Placed {
  const drawnCols = Math.max(
    preset.cols,
    ...preset.rows.map((r) => Math.max(...r.slots, ...mirrored(r, preset.cols), 0) + 1),
  )

  const left = positions
    .filter((p) => GRID.some((g) => g.pos === p && g.side === 'L'))
    .sort((a, b) => orderOf(a) - orderOf(b))
  const right = positions
    .filter((p) => GRID.some((g) => g.pos === p && g.side === 'R'))
    .sort((a, b) => orderOf(a) - orderOf(b))

  const fill = (list: number[], side: 'L' | 'R'): Array<(number | null)[]> => {
    let i = 0

    return preset.rows.map((row) => {
      const slots = side === 'L' ? row.slots : mirrored(row, preset.cols)
      const cells: (number | null)[] = Array.from({ length: drawnCols }, () => null)

      for (const slot of slots) {
        cells[slot] = i < list.length ? list[i++] : null
      }

      return cells
    })
  }

  const leftRows = fill(left, 'L')
  const rightRows = fill(right, 'R')

  const rows = preset.rows.map((row, index) => ({
    row,
    index,
    drop: row.drop ?? 0,
    left: leftRows[index],
    right: rightRows[index],
  }))

  const drawn = slotCount(preset)
  const placed = new Set<number>()

  for (const cells of [...leftRows, ...rightRows]) {
    for (const p of cells) {
      if (p !== null) {
        placed.add(p)
      }
    }
  }

  const overflow = positions.filter((p) => !placed.has(p))

  return {
    rows,
    overflow,
    empty: Math.max(0, drawn - placed.size),
    fits: drawn === positions.length,
  }
}

/** The transform's own order: row first, then the slot inside the half. */
function orderOf(pos: number): number {
  const cell = GRID.find((g) => g.pos === pos)

  if (!cell) {
    return Number.MAX_SAFE_INTEGER
  }

  const slot = cell.side === 'L' ? cell.col : GRID_COLS - 1 - cell.col

  return cell.row * 100 + slot
}
