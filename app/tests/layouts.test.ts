/*
 * Layout presets — the arrangement the view draws, checked against the board.
 *
 * A preset is allowed to be wrong for this keyboard: corne has too few slots,
 * sofle has too many. What must never happen is a wrong preset silently losing
 * a position, or the default preset drawing a key somewhere other than where
 * the transform puts it.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { GRID, KEY_COUNT } from '../src/proto/zmk.gen.ts'
import { LAYOUTS, findLayout, mirrored, placeKeys } from '../src/model/layouts.ts'

const allPositions = GRID.map((g) => g.pos)

test('the default preset is cosmotyl, and it is the board exactly', () => {
  const def = LAYOUTS[0]

  assert.equal(def.id, 'cosmotyl')
  assert.equal(findLayout('a preset that does not exist').id, 'cosmotyl')

  const placed = placeKeys(def, allPositions)

  assert.equal(placed.fits, true)
  assert.equal(placed.overflow.length, 0)
  assert.equal(placed.empty, 0)
})

test('the default preset draws every position where the transform puts it', () => {
  const placed = placeKeys(findLayout('cosmotyl'), allPositions)
  const drawn: Array<number | null> = []

  /* Row by row, left half then right half: the same walk the view renders, and
   * the same order the firmware's CELLS records list positions in. */
  for (const line of placed.rows) {
    drawn.push(...line.left, ...line.right)
  }

  assert.deepEqual(
    drawn.filter((p): p is number => p !== null),
    Array.from({ length: KEY_COUNT }, (_, pos) => pos),
  )
})

test('the thumb cluster is not mirror-symmetric, and the preset says so', () => {
  const thumb = findLayout('cosmotyl').rows.at(-1)!

  /* Left thumbs sit at slots 2-5, flush with the split. Mirroring that gives
   * slots 0-3 on the right, which happens to be right here - but it only
   * happens to be right, so the preset states the right half instead of
   * deriving it. A preset that derived it would move a thumb key to the wrong
   * edge the moment the board's thumb row stopped being symmetric. */
  assert.deepEqual(thumb.slots, [2, 3, 4, 5])
  assert.deepEqual(thumb.right, [0, 1, 2, 3])
  assert.deepEqual(mirrored(thumb, 6), [0, 1, 2, 3])
})

test('a preset with too few slots reports the positions it has nowhere to draw', () => {
  const placed = placeKeys(findLayout('corne'), allPositions)

  assert.equal(placed.fits, false)
  /* Corne draws 54 slots and the board reports 60 positions. The six that do
   * not fit are named, not dropped. */
  assert.equal(placed.overflow.length, 6)
  assert.equal(placed.empty, 0)

  const drawn = new Set<number>()

  for (const line of placed.rows) {
    for (const p of [...line.left, ...line.right]) {
      if (p !== null) {
        drawn.add(p)
      }
    }
  }

  assert.equal(drawn.size + placed.overflow.length, KEY_COUNT)
})

test('a preset with too many slots reports the slots this board has no switch for', () => {
  const placed = placeKeys(findLayout('sofle'), allPositions)

  assert.equal(placed.fits, false)
  assert.equal(placed.overflow.length, 0)
  assert.equal(placed.empty, 90 - KEY_COUNT)
})

test('the grid6 preset is the same board with the thumb cluster filled in', () => {
  const placed = placeKeys(findLayout('grid6'), allPositions)

  assert.equal(placed.overflow.length, 0)
  /* 72 slots, 60 switches: the 12 unwired grid corners the grid test lists. */
  assert.equal(placed.empty, 12)
})
