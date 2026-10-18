/**
 * ZMK behavior / keycode catalog used by the key picker.
 * Codes are the real macro names from the pinned ZMK checkout
 * (../zmk/app/include/dt-bindings/zmk/{keys,mouse,pointing}.h) so they map
 * 1:1 onto `&kp <CODE>` / `&mmv <CODE>` / `&msc <CODE>` / `&mkp <CODE>`
 * when generating the keymap. Data stays flat and JSON-serializable:
 * it will be embedded into TLV records for the BLE transfer later.
 */

const mk = (code, label) => ({ code, label })

export const CATALOG = {
  letters: 'QWERTYUIOPASDFGHJKLZXCVBNM'.split('').map((c) => mk(c, c)),

  numbers: '1234567890'.split('').map((c) => mk(`N${c}`, c)),

  symbols: [
    mk('MINUS', '-'), mk('EQUAL', '='), mk('GRAVE', '`'), mk('LBRC', '['),
    mk('RBRC', ']'), mk('BSLS', '\\'), mk('SEMI', ';'), mk('QUOT', "'"),
    mk('COMMA', ','), mk('DOT', '.'), mk('SLASH', '/'), mk('SPACE', '␣'),
    mk('RET', 'Enter'), mk('BKSP', '⌫'), mk('TAB', 'Tab'), mk('ESC', 'Esc'),
  ],

  modifiers: [
    mk('LCTRL', 'LCtrl'), mk('LSHFT', 'LShift'), mk('LALT', 'LAlt'), mk('LGUI', 'LGui'),
    mk('RCTRL', 'RCtrl'), mk('RSHFT', 'RShift'), mk('RALT', 'RAlt'), mk('RGUI', 'RGui'),
  ],

  navigation: [
    mk('HOME', 'Home'), mk('END', 'End'), mk('PGUP', 'PgUp'), mk('PGDN', 'PgDn'),
    mk('UP', '↑'), mk('DOWN', '↓'), mk('LEFT', '←'), mk('RIGHT', '→'),
    mk('INS', 'Ins'), mk('DEL', 'Del'), mk('CAPSLOCK', 'Caps'),
    mk('C_PRINT', 'PrtSc'), mk('K_PSCREEN', 'Screen'),
  ],

  function: Array.from({ length: 12 }, (_, i) => mk(`F${i + 1}`, `F${i + 1}`)),

  media: [
    mk('K_PLAY_PAUSE', '⏯'), mk('K_NEXT', '⏭'), mk('K_PREV', '⏮'),
    mk('K_STOP', '⏹'), mk('K_MUTE', '🔇'), mk('K_VOLUME_UP', '🔉+'),
    mk('K_VOLUME_DOWN', '🔉−'), mk('C_BRIGHTNESS_INC', '☀+'),
    mk('C_BRIGHTNESS_DEC', '☀−'),
  ],

  mouseButtons: [
    mk('LCLK', 'LClick'), mk('RCLK', 'RClick'), mk('MCLK', 'MClick'),
    mk('MB4', 'B4'), mk('MB5', 'B5'),
  ],

  mouseMove: [
    mk('MOVE_UP', 'Move ↑'), mk('MOVE_DOWN', 'Move ↓'),
    mk('MOVE_LEFT', 'Move ←'), mk('MOVE_RIGHT', 'Move →'),
  ],

  mouseScroll: [mk('SCRL_UP', 'Scroll ↑'), mk('SCRL_DOWN', 'Scroll ↓')],

  keypad: [
    mk('KP_ENTER', 'KP⏎'), mk('KP_DIVIDE', 'KP/'), mk('KP_ASTERISK', 'KP*'),
    mk('KP_PLUS', 'KP+'), mk('KP_MINUS', 'KP−'), mk('KP_DOT', 'KP.'),
  ],
}

/** Every catalog entry, tagged with the binding kind it produces. */
export const PICKER_GROUPS = [
  { id: 'letters', title: 'Letters', items: CATALOG.letters.map((i) => ({ ...i, kind: 'key' })) },
  { id: 'numbers', title: 'Numbers', items: CATALOG.numbers.map((i) => ({ ...i, kind: 'key' })) },
  { id: 'symbols', title: 'Symbols', items: CATALOG.symbols.map((i) => ({ ...i, kind: 'key' })) },
  { id: 'modifiers', title: 'Modifiers', items: CATALOG.modifiers.map((i) => ({ ...i, kind: 'key' })) },
  { id: 'navigation', title: 'Navigation', items: CATALOG.navigation.map((i) => ({ ...i, kind: 'key' })) },
  { id: 'function', title: 'Function', items: CATALOG.function.map((i) => ({ ...i, kind: 'key' })) },
  { id: 'media', title: 'Media', items: CATALOG.media.map((i) => ({ ...i, kind: 'key' })) },
  { id: 'keypad', title: 'Keypad', items: CATALOG.keypad.map((i) => ({ ...i, kind: 'key' })) },
  {
    id: 'mouse',
    title: 'Mouse',
    items: [
      ...CATALOG.mouseButtons.map((i) => ({ ...i, kind: 'mkp' })),
      ...CATALOG.mouseMove.map((i) => ({ ...i, kind: 'mmv' })),
      ...CATALOG.mouseScroll.map((i) => ({ ...i, kind: 'msc' })),
    ],
  },
  // "Layers" and "Hold/Tap" are synthesized in the picker from config layers.
]

/** Pretty label for a keycode, used on keycaps. */
const SHORT_LABELS = {
  SPACE: '␣', RET: '⏎', BKSP: '⌫', TAB: '⇆', ESC: '⎋',
  UP: '↑', DOWN: '↓', LEFT: '←', RIGHT: '→',
  LCTRL: 'LCtrl', LSHFT: 'LSh', LALT: 'LAlt', LGUI: 'LGui',
  RCTRL: 'RCtrl', RSHFT: 'RSh', RALT: 'RAlt', RGUI: 'RGui',
  CAPSLOCK: 'Caps', HOME: 'Home', END: 'End', PGUP: 'Pg↑', PGDN: 'Pg↓',
  MINUS: '-', EQUAL: '=', GRAVE: '`', LBRC: '[', RBRC: ']', BSLS: '\\',
  SEMI: ';', QUOT: "'", COMMA: ',', DOT: '.', SLASH: '/',
  LCLK: '🖱L', RCLK: '🖱R', MCLK: '🖱M', MB4: '🖱4', MB5: '🖱5',
  MOVE_UP: 'M↑', MOVE_DOWN: 'M↓', MOVE_LEFT: 'M←', MOVE_RIGHT: 'M→',
  SCRL_UP: 'S↑', SCRL_DOWN: 'S↓',
  K_PLAY_PAUSE: '⏯', K_NEXT: '⏭', K_PREV: '⏮', K_MUTE: '🔇',
  K_VOLUME_UP: '🔉+', K_VOLUME_DOWN: '🔉−',
}

export function keyLabel(code) {
  return SHORT_LABELS[code] ?? code.replace(/^K_|^C_/, '')
}

/** Sets of codes by category, for keycap color-coding. */
const MOD_CODES = new Set(CATALOG.modifiers.map((i) => i.code))
const MEDIA_CODES = new Set(CATALOG.media.map((i) => i.code))
const NAV_CODES = new Set(CATALOG.navigation.map((i) => i.code))
const MOUSE_CODES = new Set([...CATALOG.mouseButtons, ...CATALOG.mouseMove, ...CATALOG.mouseScroll].map((i) => i.code))

/** CSS category token for a resolved binding (drives keycap coloring). */
export function bindingCategory(binding) {
  if (!binding) return 'inherit'
  switch (binding.kind) {
    case 'mo': case 'to': return 'layer'
    case 'lt': case 'hml': case 'hmr': return 'holdtap'
    case 'mmv': case 'msc': case 'mkp': return 'mouse'
    case 'key':
      if (MOD_CODES.has(binding.code)) return 'mod'
      if (MEDIA_CODES.has(binding.code)) return 'media'
      if (MOUSE_CODES.has(binding.code)) return 'mouse'
      if (NAV_CODES.has(binding.code)) return 'nav'
      return 'key'
    default: return 'key'
  }
}
