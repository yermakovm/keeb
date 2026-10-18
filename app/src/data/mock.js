/**
 * Mock configuration modeled on config/keeb.keymap (bring-up build).
 *
 * Physical matrix per half: 6 rows x 6 cols.
 *   rows 0-3  alpha rows (6 keys per half)
 *   row 4     extra row: LBKT/RBKT (left) LBRC/RBRC (right) at local cols 2-3
 *   row 5     thumb cluster: first 4 cols per half
 * Local col 0 = innermost (split gap side) for the RIGHT half; col 5 =
 * innermost for the LEFT half. See layout store for the display mapping.
 *
 * Cell keys: `${side}.${row}.${col}` with side 'L' | 'R'.
 * Binding kinds are JSON-serializable for later TLV encoding.
 */

const k = (code) => ({ kind: 'key', code })
const mo = (layer) => ({ kind: 'mo', layer })
const lt = (layer, tap) => ({ kind: 'lt', layer, tap })
const hml = (tap, hold) => ({ kind: 'hml', tap, hold })
const hmr = (tap, hold) => ({ kind: 'hmr', tap, hold })
const mmv = (code) => ({ kind: 'mmv', code })
const msc = (code) => ({ kind: 'msc', code })
const mkp = (code) => ({ kind: 'mkp', code })

const key = (side, row, col) => `${side}.${row}.${col}`

/** Unwired matrix cells for the 6x6 bring-up board (both halves). */
export const UNWIRED_CELLS = ['L', 'R'].flatMap((s) => [
  ...[0, 1, 4, 5].map((c) => key(s, 4, c)), // extra row: only cols 2-3 wired
  ...[4, 5].map((c) => key(s, 5, c)), // thumb row: only cols 0-3 wired
])

export const MOCK_CONFIG = {
  split: true,
  rows: 6,
  cols: 6,
  layers: [
    { name: 'HOME', color: '#e0a158' },
    { name: 'NAV', color: '#5ea87c' },
    { name: 'FUN', color: '#6c9ce8' },
    { name: 'MOUSE', color: '#4fb7ae' },
    { name: 'MEDIA', color: '#c878b4' },
  ],
}

/** Layer 0 (HOME): full grid, straight from the keymap. */
const home = {}
const put = (side, row, colArr) =>
  colArr.forEach((b, c) => { home[key(side, row, c)] = b })

put('L', 0, [k('PLUS'), k('N1'), k('N2'), k('N3'), k('N4'), k('N5')])
put('R', 0, [k('N6'), k('N7'), k('N8'), k('N9'), k('N0'), k('MINUS')])
put('L', 1, [k('GRAVE'), k('Q'), k('W'), k('E'), k('R'), k('T')])
put('R', 1, [k('Y'), k('U'), k('I'), k('O'), k('P'), k('LBRC')])
put('L', 2, [k('ESC'), hml('A', 'LGUI'), hml('S', 'LALT'), hml('D', 'LCTRL'), hml('F', 'LSHFT'), k('G')])
put('R', 2, [k('H'), hmr('J', 'RSHFT'), hmr('K', 'RCTRL'), hmr('L', 'RALT'), hmr('SEMI', 'RGUI'), k('RBRC')])
put('L', 3, [k('LCTRL'), k('Z'), k('X'), k('C'), k('V'), k('B')])
put('R', 3, [k('N'), k('M'), k('COMMA'), k('DOT'), k('SLASH'), k('RALT')])
put('L', 4, [undefined, undefined, k('LBKT'), k('RBKT'), undefined, undefined])
put('R', 4, [undefined, undefined, k('LBRC'), k('RBRC'), undefined, undefined])
// Thumb rows: left col 0 = innermost.
put('L', 5, [lt(1, 'TAB'), lt(2, 'SPACE'), lt(3, 'HOME'), mo(4)])
put('R', 5, [k('PGUP'), mo(1), k('BKSP'), k('RET')])

/** Override layers: only the cells that differ from HOME. */
const nav = {
  [key('R', 2, 1)]: k('DOWN'),
  [key('R', 2, 2)]: k('UP'),
  [key('R', 2, 3)]: k('LEFT'),
  [key('R', 2, 4)]: k('RIGHT'),
  [key('L', 5, 2)]: mo(0),
}

const fun = {
  [key('L', 0, 0)]: k('F12'),
  [key('L', 0, 1)]: k('F1'),
  [key('L', 0, 2)]: k('F2'),
  [key('L', 0, 3)]: k('F3'),
  [key('L', 0, 4)]: k('F4'),
  [key('L', 0, 5)]: k('F5'),
  [key('R', 0, 0)]: k('F6'),
  [key('R', 0, 1)]: k('F7'),
  [key('R', 0, 2)]: k('F8'),
  [key('R', 0, 3)]: k('F9'),
  [key('R', 0, 4)]: k('F10'),
  [key('R', 0, 5)]: k('F11'),
  [key('L', 5, 2)]: mo(0),
}

const mouse = {
  [key('R', 2, 1)]: mmv('MOVE_DOWN'),
  [key('R', 2, 2)]: mmv('MOVE_UP'),
  [key('R', 2, 3)]: mmv('MOVE_LEFT'),
  [key('R', 2, 4)]: mmv('MOVE_RIGHT'),
  [key('R', 5, 0)]: msc('SCRL_UP'),
  [key('R', 5, 1)]: msc('SCRL_DOWN'),
  [key('R', 5, 2)]: mkp('LCLK'),
  [key('R', 5, 3)]: mkp('RCLK'),
  [key('L', 5, 2)]: mo(0),
}

const media = {
  [key('R', 2, 1)]: k('K_PREV'),
  [key('R', 2, 2)]: k('K_PLAY_PAUSE'),
  [key('R', 2, 3)]: k('K_NEXT'),
  [key('R', 2, 4)]: k('K_MUTE'),
  [key('L', 5, 2)]: mo(0),
}

export const MOCK_BINDINGS = [home, nav, fun, mouse, media]
