/*
 * The grid the views draw from.
 *
 * The expectations here are written out by hand from the board, not derived
 * from the helper: what the keymap file draws, what keeb.dtsi's transform maps,
 * and what the two reserved corners are. If the helper ever re-reads the
 * transform in a different order, this is what notices.
 *
 * The board (12 global columns, left half 0-5, right half 6-11 with col-offset 6):
 *
 *   row 0-3   full alpha grid, 6 keys per half
 *   row 4     2 extra keys per half, at local cols 2-3 (mirror-placed)
 *   row 5     thumb cluster, left cols 2-5, right cols 8-11
 *
 * The transform lists the left half outer edge -> split gap and the right half
 * gap -> outer edge, so the drawn order of the halves is:
 *
 *   left  slot 0 = col 0 (outer edge)      right slot 0 = col 11 (split gap)
 *   left  slot 5 = col 5 (split gap)       right slot 5 = col 6 (outer edge)
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { GRID, KEY_COUNT, RESERVED_POSITIONS } from '../src/proto/zmk.gen.ts'
import { GRID_ROWS, HALF_COLS, gridHalf } from '../src/stores/keymap.ts'

const N = null

const drawnOrder = () => {
  const out: Array<number | null> = []

  for (let row = 0; row < GRID_ROWS; row++) {
    for (const side of ['L', 'R'] as const) {
      out.push(...gridHalf(row, side).map((s) => s.pos))
    }
  }

  return out
}

test('the grid is the matrix transform: 6 rows, 6 columns per half, 60 positions', () => {
  assert.equal(GRID_ROWS, 6)
  assert.equal(HALF_COLS, 6)
  assert.equal(GRID.length, KEY_COUNT)
  assert.equal(new Set(GRID.map((g) => g.pos)).size, KEY_COUNT)
})

test('every half renders in the order the transform lists it, not by column number', () => {
  assert.deepEqual(
    gridHalf(0, 'L').map((s) => s.pos),
    [0, 1, 2, 3, 4, 5],
  )

  /* The right half's map row is RC(0,11) ... RC(0,6): position 6 is the key
   * next to the split, position 11 is the outer top-right corner. Sorting by
   * column would put 11 first and mirror the whole right hand. */
  assert.deepEqual(
    gridHalf(0, 'R').map((s) => s.pos),
    [6, 7, 8, 9, 10, 11],
  )

  assert.deepEqual(
    gridHalf(3, 'R').map((s) => s.pos),
    [42, 43, 44, 45, 46, 47],
  )

  /* Reading the halves left to right therefore walks the positions in map
   * order, which is the order every CELLS record lists them in. */
  assert.deepEqual(
    drawnOrder().filter((p) => p !== null),
    Array.from({ length: KEY_COUNT }, (_, pos) => pos),
  )
})

test('the reserved corners are the two outer top corners of the board', () => {
  const row0 = [
    ...gridHalf(0, 'L').map((s) => s.pos),
    ...gridHalf(0, 'R').map((s) => s.pos),
  ]

  assert.equal(row0[0], RESERVED_POSITIONS[0])
  assert.equal(row0[row0.length - 1], RESERVED_POSITIONS[1])
})

test('short rows keep their columns instead of collapsing to the left', () => {
  /* Row 4: LBKT/RBKT on the left at cols 2-3, their mirrors on the right at
   * cols 9-8 - the same slots on both halves, which is what "mirror-placed"
   * (mirror of global col c is 11 - c) has to mean. */
  assert.deepEqual(
    gridHalf(4, 'L').map((s) => s.pos),
    [N, N, 48, 49, N, N],
  )

  assert.deepEqual(
    gridHalf(4, 'R').map((s) => s.pos),
    [N, N, 50, 51, N, N],
  )

  /* Row 5: the left thumbs sit at cols 2-5, the right thumbs at cols 11-8, so
   * the left cluster is flush with the split and the right one is not. */
  assert.deepEqual(
    gridHalf(5, 'L').map((s) => s.pos),
    [N, N, 52, 53, 54, 55],
  )

  assert.deepEqual(
    gridHalf(5, 'R').map((s) => s.pos),
    [56, 57, 58, 59, N, N],
  )
})

test('a mirrored key lands in the same slot of its own half', () => {
  for (let row = 0; row < GRID_ROWS; row++) {
    const left = gridHalf(row, 'L')
    const right = gridHalf(row, 'R')

    for (let slot = 0; slot < HALF_COLS; slot++) {
      assert.equal(
        left[slot].col + right[slot].col,
        11,
        `row ${row} slot ${slot}: the mirror of col c is 11 - c`,
      )
    }
  }
})

test('grid slots with no switch are reported as slots without a position', () => {
  const empty: string[] = []

  for (let row = 0; row < GRID_ROWS; row++) {
    for (const side of ['L', 'R'] as const) {
      gridHalf(row, side).forEach((s, slot) => {
        if (s.pos === null) {
          empty.push(`${side}${row}.${s.col} (slot ${slot})`)
        }
      })
    }
  }

  /* 60 mapped positions in a 6x12 grid leaves 12 unwired grid slots, and they
   * are exactly the row-4 and row-5 edges the layout comment describes. */
  assert.deepEqual(empty, [
    'L4.0 (slot 0)', 'L4.1 (slot 1)', 'L4.4 (slot 4)', 'L4.5 (slot 5)',
    'R4.11 (slot 0)', 'R4.10 (slot 1)', 'R4.7 (slot 4)', 'R4.6 (slot 5)',
    'L5.0 (slot 0)', 'L5.1 (slot 1)',
    'R5.7 (slot 4)', 'R5.6 (slot 5)',
  ])
})
