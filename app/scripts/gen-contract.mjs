#!/usr/bin/env node
/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Generate src/proto/zmk.gen.ts from the firmware's own sources.
 *
 * Why a generator instead of a hand-written table: the configurator's contract
 * is only correct while it agrees with the image it talks to. Token ids are the
 * devicetree order, keycodes are ZMK's dt-bindings, the stock grid is the
 * matrix transform, and the stock layout is the keymap file. Copying any of
 * them into JavaScript means the day they move, the UI silently writes a
 * layout nobody asked for. This script reads the same files the firmware
 * compiles, and re-derives the token hash the firmware reports, so a drift
 * shows up here (or as a rejected connection) instead of as a wrong keymap.
 *
 * Sources (all outside app/, resolved relative to this file):
 *   ../../keeb-module/boards/shields/keeb/keeb.dtsi   tokens, reserved positions, grid
 *   ../../config/keeb.keymap                          stock layers + stock bindings
 *   ../../config/keeb.conf                            the advertised keyboard name
 *   ../../../zmk/app/dts/behaviors/*.dtsi             binding-cells, display names
 *   ../../../zmk/app/include/dt-bindings/zmk/*.h      keycodes and behavior args
 *
 * The pinned ZMK checkout is a workspace sibling, not part of this repo. When
 * it is missing the committed zmk.gen.ts stays in use; run with ZMK_DIR=<path>
 * to point at a different checkout.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP_DIR = resolve(HERE, '..')
const REPO = resolve(APP_DIR, '..')
const ZMK = resolve(process.env.ZMK_DIR ?? join(REPO, '..', 'zmk'))

const DTSI = join(REPO, 'keeb-module/boards/shields/keeb/keeb.dtsi')
const KEYMAP = join(REPO, 'config/keeb.keymap')
const POSITIONS = join(REPO, 'keeb-module/dts/keeb-positions.dtsi')
const CONF = join(REPO, 'config/keeb.conf')
const ZMK_BEHAVIORS = join(ZMK, 'app/dts/behaviors')
const ZMK_DT = join(ZMK, 'app/include/dt-bindings/zmk')
const ZMK_HEADERS = ['keys.h', 'hid_usage.h', 'hid_usage_pages.h', 'modifiers.h', 'pointing.h', 'mouse.h', 'bt.h', 'outputs.h']

const OUT = join(APP_DIR, 'src/proto/zmk.gen.ts')

/* Fail with instructions rather than a raw ENOENT: the pinned ZMK checkout is a
 * workspace sibling, not part of this repo, so it moves. */
for (const path of [DTSI, KEYMAP, CONF, ZMK_BEHAVIORS, ZMK_DT]) {
  if (!existsSync(path)) {
    console.error(`missing input: ${path}`)
    console.error('the generator needs config/keeb.keymap, keeb.dtsi and the pinned ZMK checkout (ZMK_DIR=<path> when it moved)')
    process.exit(1)
  }
}

/* --------------------------------------------------------------------------
 * Small pieces of a C preprocessor
 *
 * The dt-bindings headers are only ever a flat set of `#define NAME expr`
 * (plus function-like ones like ZMK_HID_USAGE and MOVE_Y). Enough to parse
 * them directly and evaluate the expressions, which is what turns PLUS into
 * 0x0007004e without a compiler in the loop.
 * -------------------------------------------------------------------------- */

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

/** `#define NAME body` and `#define NAME(a, b) body`, joined across `\` continuations. */
function parseDefines(src) {
  const lines = src.split(/\r?\n/)
  const out = new Map()

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim()

    while (line.endsWith('\\') && i + 1 < lines.length) {
      line = line.slice(0, -1).trimEnd() + ' ' + lines[++i].trim()
    }

    const m = /^#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)(\(([^)]*)\))?\s*(.*)$/.exec(line)

    if (!m) {
      continue
    }

    const name = m[1]
    const params = m[2] ? m[3].split(',').map((s) => s.trim()).filter(Boolean) : null
    const body = m[4].trim()

    out.set(name, { params, body: body || '0' })
  }

  return out
}

function tokenizeExpr(text) {
  const tokens = []
  const re = /\s*(0x[0-9a-fA-F]+|\d+|[A-Za-z_][A-Za-z0-9_]*|<<|>>|[-+()~&|*<>,?:]|\d+UL?)\s*/g
  let m

  while ((m = re.exec(text)) !== null) {
    if (m[1].endsWith('UL')) {
      tokens.push({ kind: 'num', value: Number(BigInt(m[1].slice(0, -2))) })
      continue
    }

    if (/^(0x[0-9a-fA-F]+|\d+)$/.test(m[1])) {
      tokens.push({ kind: 'num', value: Number(m[1]) })
    } else if (/^[A-Za-z_]/.test(m[1])) {
      tokens.push({ kind: 'id', value: m[1] })
    } else {
      tokens.push({ kind: 'op', value: m[1] })
    }
  }

  return tokens
}

/** Expression evaluator over the macro table. Values are unsigned 32-bit,
 * which is what ZMK stores in a binding param. */
function makeEvaluator(macros) {
  const memo = new Map()
  const resolving = new Set()

  function objectValue(name) {
    if (memo.has(name)) {
      return memo.get(name)
    }

    const def = macros.get(name)

    if (!def || def.params) {
      throw new Error(`unknown macro: ${name}`)
    }

    if (resolving.has(name)) {
      throw new Error(`macro cycle at ${name}`)
    }

    resolving.add(name)
    const v = evaluate(def.body, new Map())
    resolving.delete(name)
    memo.set(name, v >>> 0)

    return memo.get(name)
  }

  function evaluate(text, scope) {
    const t = tokenizeExpr(text)
    let i = 0

    const peek = () => t[i]
    const eat = (op) => {
      if (peek() && peek().kind === 'op' && peek().value === op) {
        i += 1
        return true
      }
      return false
    }

    function primary() {
      const tok = peek()

      if (!tok) {
        throw new Error(`unexpected end of expression: ${text}`)
      }

      if (eat('(')) {
        const v = binary(0)
        if (!eat(')')) {
          throw new Error(`unbalanced parens in ${text}`)
        }
        return v
      }

      if (eat('-')) {
        return (-primary()) >>> 0
      }

      if (eat('~')) {
        return (~primary()) >>> 0
      }

      if (tok.kind === 'num') {
        i += 1
        return tok.value >>> 0
      }

      if (tok.kind === 'id') {
        i += 1

        if (peek() && peek().kind === 'op' && peek().value === '(') {
          i += 1 /* '(' */
          const args = []

          if (!eat(')')) {
            for (;;) {
              args.push(binary(0))
              if (eat(',')) {
                continue
              }
              if (eat(')')) {
                break
              }
              throw new Error(`bad call in ${text}`)
            }
          }

          const def = macros.get(tok.value)

          if (!def || !def.params) {
            if (tok.value === 'BIT') {
              return (1 << args[0]) >>> 0 /* Zephyr's dt-util.h, used by pointing.h */
            }
            throw new Error(`unknown function-like macro: ${tok.value}`)
          }

          const inner = new Map()
          def.params.forEach((p, idx) => inner.set(p, args[idx]))

          return substitute(def.body, inner, scope)
        }

        const local = scope.get(tok.value)

        if (local !== undefined) {
          return local
        }

        return objectValue(tok.value)
      }

      throw new Error(`unexpected token ${tok.value} in ${text}`)
    }

    const BINARY = [
      ['|'],
      ['&'],
      ['<<', '>>'],
      ['+', '-'],
    ]

    function binary(level) {
      if (level >= BINARY.length) {
        return primary()
      }

      let v = binary(level + 1)

      for (;;) {
        const tok = peek()

        if (!tok || tok.kind !== 'op' || !BINARY[level].includes(tok.value)) {
          return v >>> 0
        }

        i += 1
        const rhs = binary(level + 1)

        if (tok.value === '|') v = v | rhs
        else if (tok.value === '&') v = v & rhs
        else if (tok.value === '<<') v = (v << rhs) >>> 0
        else if (tok.value === '>>') v = (v >>> rhs) >>> 0
        else if (tok.value === '+') v = (v + rhs) >>> 0
        else v = (v - rhs) >>> 0

        v = v >>> 0
      }
    }

    return binary(0)
  }

  /** Textual macro substitution, then evaluate - the C rule, and the only
   * way MOVE_Y(-ZMK_POINTING_DEFAULT_MOVE_VAL) comes out right. */
  function substitute(body, args, scope) {
    let text = body

    for (const [name, value] of args) {
      text = text.replace(new RegExp(`\\b${name}\\b`, 'g'), `(${value})`)
    }

    for (const [name, value] of scope) {
      text = text.replace(new RegExp(`\\b${name}\\b`, 'g'), `(${value})`)
    }

    return evaluate(text, new Map())
  }

  return { evaluate, objectValue }
}

/* --------------------------------------------------------------------------
 * Devicetree reading
 * -------------------------------------------------------------------------- */

/** Balanced body of `label: name { ... }`, by label. */
function findNode(src, label) {
  const re = new RegExp(`(^|[\\s{;])${label}\\s*:\\s*([A-Za-z_][A-Za-z0-9_-]*)\\s*\\{`)
  const m = re.exec(src)

  if (!m) {
    return null
  }

  const start = m.index + m[0].lastIndexOf('{')
  let depth = 0
  let end = -1

  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }

  if (end < 0) {
    return null
  }

  const body = src.slice(start + 1, end)
  const cells = /#binding-cells\s*=\s*<\s*(\d+)\s*>/.exec(body)
  const display = /display-name\s*=\s*"([^"]*)"/.exec(body)
  const compat = /compatible\s*=\s*"([^"]*)"/.exec(body)

  return {
    label,
    name: m[2],
    bindingCells: cells ? Number(cells[1]) : null,
    displayName: display ? display[1] : null,
    compatible: compat ? compat[1] : null,
  }
}

function intList(text) {
  return [...text.matchAll(/(-?\d+)/g)].map((m) => Number(m[1]))
}

/* --------------------------------------------------------------------------
 * 1. Token table (keeb,engine:tokens) — token id is the list order, and the
 *    name is the devicetree *node* name, because that is the string ZMK's
 *    keymap core stores in a binding and resolves with
 *    zmk_behavior_get_binding().
 * -------------------------------------------------------------------------- */

const dtsi = stripComments(readFileSync(DTSI, 'utf8'))
const keymapSrc = readFileSync(KEYMAP, 'utf8')
const keymap = stripComments(keymapSrc)

/* keeb-positions.dtsi is the keymap's own include: key position names (53 ->
 * KEEB_POS_L_THUMB_1) and layer indices (&lt KEEB_LAYER_NAV rather than &lt 1).
 * The generator has to read it too, or every named binding in the keymap and
 * every named position in keeb.dtsi would parse as an unknown token. */
const positionMacros = parseDefines(stripComments(readFileSync(POSITIONS, 'utf8')))

/** Expand a position or layer name into the numbers it stands for. */
function numberList(text, seen = new Set()) {
  const out = []

  for (const tok of text.match(/[A-Za-z_][A-Za-z0-9_]*|-?\d+/g) ?? []) {
    if (/^-?\d+$/.test(tok)) {
      out.push(Number(tok))
      continue
    }

    const def = positionMacros.get(tok)

    if (!def || def.params) {
      throw new Error(`keeb-positions.dtsi: ${tok} is not a position or layer name`)
    }

    if (seen.has(tok)) {
      throw new Error(`keeb-positions.dtsi: ${tok} expands to itself`)
    }

    out.push(...numberList(def.body, new Set(seen).add(tok)))
  }

  return out
}

/** A devicetree list of positions: literals and named groups mixed together. */
function expandPositionList(text) {
  const out = []

  for (const tok of text.trim().split(/[\s,]+/).filter(Boolean)) {
    if (/^-?\d+$/.test(tok)) {
      out.push(Number(tok))
    } else if (positionMacros.has(tok) && !positionMacros.get(tok).params) {
      out.push(...numberList(positionMacros.get(tok).body))
    } else {
      out.push(NaN)
    }
  }

  return out
}

/** One binding argument: a literal, a dt-bindings keycode, or a named constant
 * that stands for exactly one number. */
function resolveArg(name) {
  if (/^-?\d+$/.test(name)) {
    return Number(name) >>> 0
  }

  if (keycodes.has(name)) {
    return keycodes.get(name)
  }

  const list = positionMacros.has(name) && !positionMacros.get(name).params ? numberList(positionMacros.get(name).body) : null

  return list && list.length === 1 ? list[0] >>> 0 : null
}

/* CONFIG_ZMK_KEYBOARD_NAME is what the keyboard puts in its advertisement
 * (ZMK advertises with BT_LE_ADV_OPT_USE_NAME | FORCE_NAME_IN_AD). It belongs
 * in the generated contract because it is also the only thing a Web Bluetooth
 * chooser can filter on: the HID service it advertises (0x1812) is on the Web
 * Bluetooth GATT blocklist, so filtering by "is a HID device" is not just
 * useless, it is forbidden. A name filter is the one narrowing that works, and
 * a name filter that is hardcoded here would silently stop matching the day the
 * keyboard is renamed.
 */
const keyboardName = (() => {
  const m = /CONFIG_ZMK_KEYBOARD_NAME\s*=\s*"([^"]*)"/.exec(readFileSync(CONF, 'utf8'))

  if (!m) {
    console.error(`missing CONFIG_ZMK_KEYBOARD_NAME in ${relative(REPO, CONF)}`)
    process.exit(1)
  }

  return m[1]
})()

const tokensBlock = /tokens\s*=\s*<([^>]*)>/.exec(dtsi)

if (!tokensBlock) {
  throw new Error('no keeb,engine:tokens list in keeb.dtsi')
}

const tokenLabels = tokensBlock[1].match(/&[A-Za-z_][A-Za-z0-9_]*/g).map((s) => s.slice(1))

const behaviorSources = [
  { path: DTSI, src: dtsi },
  { path: KEYMAP, src: keymap },
  ...readdirSync(ZMK_BEHAVIORS)
    .filter((f) => f.endsWith('.dtsi'))
    .map((f) => ({ path: join(ZMK_BEHAVIORS, f), src: stripComments(readFileSync(join(ZMK_BEHAVIORS, f), 'utf8')) })),
]

const tokens = tokenLabels.map((label) => {
  for (const s of behaviorSources) {
    const node = findNode(s.src, label)
    if (node) {
      return { ...node, source: s.path.replace(REPO + '/', '') }
    }
  }
  throw new Error(`behavior node for token &${label} not found (checked keeb.dtsi, keeb.keymap, ${ZMK_BEHAVIORS})`)
})

/* --------------------------------------------------------------------------
 * 2. Token hash — the same bytes keeb_tokens.c builds: per token, u16 id LE,
 *    name bytes, 0x00, through CRC-32/IEEE, then complemented once. A host
 *    that knows the table can reproduce it, which is the point.
 * -------------------------------------------------------------------------- */

function crc32Update(state, bytes) {
  for (const b of bytes) {
    state ^= b
    for (let k = 0; k < 8; k++) {
      state = state & 1 ? (state >>> 1) ^ 0xedb88320 : state >>> 1
    }
  }
  return state >>> 0
}

function crc32(bytes) {
  return (~crc32Update(0xffffffff, bytes)) >>> 0
}

function tokenHash(table) {
  let state = 0xffffffff

  for (const t of table) {
    state = crc32Update(state, [t.id & 0xff, (t.id >> 8) & 0xff])
    state = crc32Update(state, [...Buffer.from(t.name, 'utf8')])
    state = crc32Update(state, [0])
  }

  return (~state) >>> 0
}

tokens.forEach((t, id) => (t.id = id))

const expectedTokenHash = tokenHash(tokens)
const reservedMatch = /reserved-positions\s*=\s*<([^>]*)>/.exec(dtsi)
const reservedPositions = reservedMatch ? expandPositionList(reservedMatch[1]) : []
const revertHoldMs = Number((/revert-hold-ms\s*=\s*<(\d+)>/.exec(dtsi) ?? [])[1] ?? 3000)

/* --------------------------------------------------------------------------
 * 3. Stock grid — the matrix transform's map order *is* the stock position
 *    order, which is what every CELLS record index means. A row may list
 *    fewer than `columns` entries; the unlisted grid slots have no position.
 * -------------------------------------------------------------------------- */

const transform = findNode(dtsi, 'default_transform')

if (!transform) {
  throw new Error('no default_transform (zmk,matrix-transform) in keeb.dtsi')
}

const transformSrc = (() => {
  for (const s of behaviorSources.concat([{ path: DTSI, src: dtsi }])) {
    const n = findNode(s.src, 'default_transform')
    if (n) {
      const i = s.src.indexOf(`${n.label}:`)
      return s.src.slice(i, i + 4000)
    }
  }
  return dtsi
})()

const mapBlock = /map\s*=\s*<([\s\S]*?)>/.exec(transformSrc)

if (!mapBlock) {
  throw new Error('matrix transform has no map')
}

const grid = []
for (const line of mapBlock[1].split('\n')) {
  const entries = [...line.matchAll(/RC\(\s*(\d+)\s*,\s*(\d+)\s*\)/g)]
  for (const m of entries) {
    const row = Number(m[1])
    const col = Number(m[2])
    grid.push({ pos: grid.length, row, col, side: col < 6 ? 'L' : 'R' })
  }
}

const gridRows = Number((/rows\s*=\s*<(\d+)>/.exec(transformSrc) ?? [])[1] ?? 6)
const gridCols = Number((/columns\s*=\s*<(\d+)>/.exec(transformSrc) ?? [])[1] ?? 12)

/* --------------------------------------------------------------------------
 * 4. Keycodes and behavior arguments, from ZMK's own dt-bindings.
 * -------------------------------------------------------------------------- */

const headerMacros = new Map()

for (const f of ZMK_HEADERS) {
  const path = join(ZMK_DT, f)
  let src
  try {
    src = readFileSync(path, 'utf8')
  } catch {
    throw new Error(`ZMK dt-bindings missing (${path}). Set ZMK_DIR to the pinned checkout.`)
  }
  for (const [k, v] of parseDefines(stripComments(src))) {
    if (!headerMacros.has(k)) {
      headerMacros.set(k, v)
    }
  }
}

const { evaluate } = makeEvaluator(headerMacros)

/* Names worth shipping to the browser: the ones a binding argument can be.
 * The HID usage tables (HID_USAGE_KEY_KEYBOARD_*) are the raw usage ids the
 * real names are built from — the configurator never needs them, and shipping
 * all of them is most of this file's weight. */
const SKIP_NAME = /^(HID_USAGE_|ZMK_HID_USAGE|USAGE_KEYPAD$|USAGE_CONSUMER$)/

const keycodes = new Map()
const skipped = []

for (const [name, def] of headerMacros) {
  if (def.params || SKIP_NAME.test(name)) {
    continue
  }
  try {
    keycodes.set(name, evaluate(def.body, new Map()))
  } catch {
    skipped.push(name)
  }
}

/* --------------------------------------------------------------------------
 * 5. Stock layout from the keymap file — the fallback the firmware returns to
 *    after DISCARD/RESET, so the offline mock has to know it too.
 * -------------------------------------------------------------------------- */

const keymapMacros = parseDefines(keymapSrc) /* &-bodies: HM_A, TH_TAB, ... */

function expandBindingTokens(text, depth = 0) {
  const out = []
  const tokensIn = text.match(/&[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*|-?\d+/g) ?? []

  for (const tok of tokensIn) {
    if (tok.startsWith('&')) {
      out.push(tok)
      continue
    }

    const def = keymapMacros.get(tok)

    if (def && def.body.includes('&') && depth < 4) {
      out.push(...expandBindingTokens(def.body, depth + 1))
      continue
    }

    out.push(tok)
  }

  return out
}

const keymapBody = (() => {
  const i = keymap.indexOf('keymap')
  const start = keymap.indexOf('{', i)
  let depth = 0
  for (let p = start; p < keymap.length; p++) {
    if (keymap[p] === '{') depth++
    else if (keymap[p] === '}') {
      depth--
      if (depth === 0) return keymap.slice(start + 1, p)
    }
  }
  throw new Error('no keymap { } block in keeb.keymap')
})()

const tokenIdByLabel = new Map(tokens.map((t) => [t.label, t.id]))
const KEEB_TOKEN_UNKNOWN = 0xfffe

const stockLayers = []

/* Behaviors whose first argument is a layer index. A name in that slot is the
 * bug the keymap header describes: `&mo HOME` compiles, carries the HOME keycode
 * as the layer id, and the key silently does nothing. */
const LAYER_BEHAVIORS = new Set(['mo', 'lt', 'to', 'tog', 'layer_momentary', 'layer_toggle', 'layer_move'])
const layerRefs = []

for (const m of keymapBody.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\{([^{}]*)\}/g)) {
  const block = m[2]
  const bindingsMatch = /bindings\s*=\s*<([\s\S]*)>/.exec(block)

  if (!bindingsMatch) {
    continue
  }

  const displayName = (/display-name\s*=\s*"([^"]*)"/.exec(block) ?? [])[1] ?? m[1]
  const flat = expandBindingTokens(bindingsMatch[1])
  const cells = []
  const problems = []

  for (let i = 0; i < flat.length; i++) {
    if (!flat[i].startsWith('&')) {
      problems.push(`stray token ${flat[i]} in layer ${displayName}`)
      continue
    }

    const label = flat[i].slice(1)
    const args = []

    while (i + 1 < flat.length && !flat[i + 1].startsWith('&')) {
      const a = flat[++i]
      if (/^-?\d+$/.test(a)) {
        args.push(Number(a) >>> 0)
      } else if (keycodes.has(a)) {
        args.push(keycodes.get(a))
      } else if (resolveArg(a) !== null) {
        args.push(resolveArg(a))

        if (LAYER_BEHAVIORS.has(label)) {
          layerRefs.push({ layer: displayName, pos: cells.length, label, arg: a, value: args[args.length - 1] })
        }
      } else {
        problems.push(`unknown argument ${a} after &${label} in layer ${displayName}`)

        if (LAYER_BEHAVIORS.has(label)) {
          /* NaN so guard 6a can report it: an argument that resolves to nothing
           * is the same class of mistake as a name in a layer slot. */
          layerRefs.push({ layer: displayName, pos: cells.length, label, arg: a, value: Number.NaN })
        }

        args.push(0)
      }
    }

    cells.push({
      token: tokenIdByLabel.has(label) ? tokenIdByLabel.get(label) : KEEB_TOKEN_UNKNOWN,
      label,
      param1: args[0] ?? 0,
      param2: args[1] ?? 0,
    })
  }

  if (cells.length !== grid.length) {
    problems.push(`layer ${displayName} has ${cells.length} bindings, the grid has ${grid.length} positions`)
  }

  if (problems.length) {
    console.warn('[gen-contract] ' + problems.join('; '))
  }

  stockLayers.push({ key: m[1], name: displayName, cells })
}


/* --------------------------------------------------------------------------
 * 6. Guards — the checks that keep the keymap, the position table and the
 *    matrix transform describing the same keyboard. All three drift separately
 *    and none of them produces a warning at compile time, so they fail here.
 * -------------------------------------------------------------------------- */

const guardFailures = []

/* 6a. A layer argument must be an index that exists, written as one. */
for (const r of layerRefs) {
  if (!/^-?\d+$/.test(r.arg) && !/^KEEB_LAYER_[A-Z0-9_]+$/.test(r.arg)) {
    guardFailures.push(
      `&${r.label} in layer ${r.layer} takes "${r.arg}" where a layer index belongs — a name compiles, carries a keycode as the layer id, and the key does nothing`,
    )
  } else if (!Number.isInteger(r.value) || r.value < 0 || r.value >= stockLayers.length) {
    guardFailures.push(
      `&${r.label} in layer ${r.layer} points at layer ${r.value}, but the keymap defines ${stockLayers.length} (0..${stockLayers.length - 1})`,
    )
  }
}

/* 6b. Every layer the keymap defines has a named index, and that name matches
 * its definition order. Reorder a layer without updating the table and this
 * fails, instead of quietly rebinding every &mo / &lt / &to / &tog in the file. */
const layerConstants = new Map()

for (const [name, def] of positionMacros) {
  if (!/^KEEB_LAYER_[A-Z0-9]+$/.test(name) || def.params) {
    continue
  }

  layerConstants.set(name, numberList(def.body)[0])
}

for (const [i, layer] of stockLayers.entries()) {
  const [short] = layer.name.split(/[^A-Za-z0-9]/) /* FUN/BT -> FUN */
  const name = `KEEB_LAYER_${short.toUpperCase()}`

  if (!layerConstants.has(name)) {
    guardFailures.push(`keeb-positions.dtsi has no ${name} for layer ${layer.name} (index ${i})`)
    continue
  }

  if (layerConstants.get(name) !== i) {
    guardFailures.push(`${name} is ${layerConstants.get(name)}, but ${layer.name} is layer index ${i} — the keymap's definition order moved`)
  }
}

for (const [name, value] of layerConstants) {
  if (value < 0 || value >= stockLayers.length) {
    guardFailures.push(`${name} is ${value}, but the keymap defines layers 0..${stockLayers.length - 1}`)
  }
}

const namedGroup = (name) => {
  const def = positionMacros.get(name)

  if (!def || def.params) {
    guardFailures.push(`keeb-positions.dtsi has no group named ${name}`)
    return []
  }

  return numberList(def.body)
}

const posBySide = { L: [], R: [] }

for (const cell of grid) {
  posBySide[cell.side].push(cell.pos)
}

const byRow = (side, row) => grid.filter((c) => c.side === side && c.row === row).map((c) => c.pos)

/* 6c. The position table against the transform's map: the names only mean what
 * this wiring says they mean. */
for (const [name, expected] of Object.entries({
  KEEB_POS_L_ALPHA: byRow('L', 0).concat(byRow('L', 1), byRow('L', 2), byRow('L', 3)),
  KEEB_POS_R_ALPHA: byRow('R', 0).concat(byRow('R', 1), byRow('R', 2), byRow('R', 3)),
  KEEB_POS_L_EXTRA: byRow('L', 4),
  KEEB_POS_R_EXTRA: byRow('R', 4),
  KEEB_POS_L_THUMB: byRow('L', 5),
  KEEB_POS_R_THUMB: byRow('R', 5),
  KEEB_POS_LEFT_HALF: posBySide.L,
  KEEB_POS_RIGHT_HALF: posBySide.R,
})) {
  const actual = namedGroup(name)

  if (actual.length !== expected.length || actual.some((p) => !expected.includes(p))) {
    guardFailures.push(`${name} is [${actual.join(', ')}] but on this wiring the matrix transform puts it at [${expected.join(', ')}]`)
  }
}

const leftHalf = namedGroup('KEEB_POS_LEFT_HALF')
const rightHalf = namedGroup('KEEB_POS_RIGHT_HALF')
const overlap = leftHalf.filter((p) => rightHalf.includes(p))

if (overlap.length) {
  guardFailures.push(`KEEB_POS_LEFT_HALF and KEEB_POS_RIGHT_HALF both claim ${overlap.join(', ')}`)
}

if (leftHalf.length + rightHalf.length !== grid.length) {
  guardFailures.push(`the two halves cover ${leftHalf.length + rightHalf.length} of ${grid.length} positions — the position table is not the whole keyboard`)
}

/* 6d. The names are mirror-symmetric: _L_THUMB_1 and _R_THUMB_1 are the same key
 * of the two hands, which is what makes a trigger list reviewable. */
for (const name of positionMacros.keys()) {
  const m = /^KEEB_POS_L_(.+)_([0-9]+)$/.exec(name)

  if (!m) {
    continue
  }

  const mirror = `KEEB_POS_R_${m[1]}_${m[2]}`

  if (!positionMacros.has(mirror)) {
    guardFailures.push(`${name} has no mirror ${mirror}`)
    continue
  }

  const ca = grid[numberList(positionMacros.get(name).body)[0]]
  const cb = grid[numberList(positionMacros.get(mirror).body)[0]]

  if (!ca || !cb) {
    guardFailures.push(`${name} / ${mirror} point outside the ${grid.length}-position grid`)
    continue
  }

  /* "Same key of the two hands" is the same LOCAL column: each half numbers its
   * own columns 0-5 and keeb_right.overlay adds col-offset 6, so the mirror of
   * global col c is c+6. Every row of this map obeys that. */
  if (ca.row !== cb.row || ca.col % 6 !== cb.col % 6) {
    guardFailures.push(
      `${name} (row ${ca.row}, col ${ca.col}) and ${mirror} (row ${cb.row}, col ${cb.col}) are not the same column of their own half`,
    )
  }
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x))
const halves = { L: leftHalf, R: rightHalf }
const triggeredHalves = new Set()

/* 6e. A positional hold-tap triggers from a whole half, named as one. This is
 * the pair that used to be two hand-copied number lists, one of them wired to
 * the wrong behavior. */
for (const m of keymap.matchAll(/([A-Za-z_][A-Za-z0-9_]*):\s*[A-Za-z_][A-Za-z0-9_]*\s*\{([^{}]*)\}/g)) {
  const trigger = /hold-trigger-key-positions\s*=\s*<([^>]*)>/.exec(m[2])

  if (!trigger) {
    continue
  }

  const listed = expandPositionList(trigger[1])
  const side = sameSet(listed, halves.L) ? 'L' : sameSet(listed, halves.R) ? 'R' : null

  if (!side) {
    guardFailures.push(`hold-tap ${m[1]} triggers from [${listed.join(', ')}], which is not one whole half — write KEEB_POS_LEFT_HALF or KEEB_POS_RIGHT_HALF`)
    continue
  }

  triggeredHalves.add(side)
}

if (triggeredHalves.size === 1) {
  guardFailures.push(`only the ${[...triggeredHalves][0]} half triggers a hold anywhere in the keymap — a mirrored pair of home-row mods needs both`)
}

/* 6f. A behavior declared in the keymap file exists to be used by the keymap
 * file. &hmr was declared, correct, and bound by nothing for as long as the
 * config existed. A behavior meant only for TLV rebind belongs in keeb.dtsi's
 * token table, not here. */
const behaviorsBlock = (() => {
  const i = keymap.search(/\bbehaviors\s*\{/)

  if (i < 0) {
    return ''
  }

  const start = keymap.indexOf('{', i)
  let depth = 0

  for (let p = start; p < keymap.length; p++) {
    if (keymap[p] === '{') {
      depth++
    } else if (keymap[p] === '}') {
      depth--

      if (depth === 0) {
        return keymap.slice(start + 1, p)
      }
    }
  }

  return ''
})()

for (const [, label] of behaviorsBlock.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*):/gm)) {
  if (!new RegExp(`&${label}\\b`).test(keymap)) {
    guardFailures.push(`behavior node ${label} is declared in the keymap file but no binding in it uses &${label}`)
  }
}

if (guardFailures.length) {
  throw new Error(`keeb contract does not hold:\n  ${guardFailures.join('\n  ')}`)
}

/* --------------------------------------------------------------------------
 * Emit
 * -------------------------------------------------------------------------- */

const rel = (p) => relative(REPO, resolve(p))

const ts = `/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * GENERATED by app/scripts/gen-contract.mjs — do not edit by hand.
 *
 * Derived from the firmware's own sources:
 *   keeb-module/boards/shields/keeb/keeb.dtsi   token table, reserved positions, grid
 *   keeb-module/dts/keeb-positions.dtsi        key position names, layer indices
 *   config/keeb.keymap                          stock layers and bindings
 *   config/keeb.conf                            CONFIG_ZMK_KEYBOARD_NAME, the advertised name
 *   zmk/app/dts/behaviors/*.dtsi                binding cells, display names
 *   zmk/app/include/dt-bindings/zmk/*.h         keycodes and behavior arguments
 *
 * Re-run with: npm run gen   (ZMK_DIR=<checkout> when the workspace moved)
 *
 * EXPECTED_TOKEN_HASH is computed the way keeb_tokens.c computes it, so the
 * configurator can prove it is talking to the firmware this table describes.
 */

import type { GridCell, StockLayer, TokenDef } from './types.ts'

export const GENERATED_FROM = ${JSON.stringify({ dtsi: 'keeb-module/boards/shields/keeb/keeb.dtsi', keymap: 'config/keeb.keymap', positions: 'keeb-module/dts/keeb-positions.dtsi', conf: 'config/keeb.conf', zmk: rel(ZMK), headers: ZMK_HEADERS }, null, 2)}

/** CONFIG_ZMK_KEYBOARD_NAME: the name the keyboard advertises, and the only
 * thing a Web Bluetooth chooser may filter this device by. ZMK advertises the
 * HID service (0x1812) and Battery (0x180F), but 0x1812 is on the Web Bluetooth
 * GATT blocklist - filtering by it is a SecurityError, not a narrowing. A name
 * filter has to come from the firmware config or it stops matching the day the
 * keyboard is renamed.
 */
export const KEYBOARD_NAME = ${JSON.stringify(keyboardName)}

/** keeb,engine:tokens in devicetree order — token id === index. */
export const TOKENS: TokenDef[] = ${JSON.stringify(tokens.map(({ id, label, name, bindingCells, displayName, compatible }) => ({ id, label, name, bindingCells, displayName, compatible })), null, 2)}

/** CRC-32 of the token table, as the firmware reports it in keeb_info.token_hash. */
export const EXPECTED_TOKEN_HASH = ${expectedTokenHash} >>> 0

/** Positions the engine refuses to rebind (keeb,engine:reserved-positions). */
export const RESERVED_POSITIONS: number[] = [${reservedPositions.join(', ')}]

/** Hold every reserved position this long to discard the saved keymap. */
export const REVERT_HOLD_MS = ${revertHoldMs}

/** Stock grid: the matrix transform's map order, i.e. the position numbering
 * every keeb_cell / keeb_cell_set refers to. */
export const GRID_ROWS = ${gridRows}
export const GRID_COLS = ${gridCols}
export const GRID: GridCell[] = ${JSON.stringify(grid)}

/** ZMK_KEYMAP_LEN: the keymap file has exactly this many positions per layer. */
export const KEY_COUNT = ${grid.length}

/** ZMK_KEYMAP_LAYERS_LEN: slots declared in the keymap file, i.e. the add/remove pool. */
export const LAYER_CAPACITY = ${stockLayers.length}

/** ZMK's layer names at boot (slot index === layer id before any reordering). */
export const STOCK_LAYER_NAMES = ${JSON.stringify(stockLayers.map((l) => l.name))}

/** The layout the firmware falls back to after DISCARD/RESET. */
export const STOCK_LAYERS: StockLayer[] = ${JSON.stringify(stockLayers.map((l) => ({ name: l.name, cells: l.cells.map((c) => ({ token: c.token, param1: c.param1, param2: c.param2 })) })), null, 2)}

/** ZMK dt-bindings names → the uint32 a binding param carries. */
export const KEYCODES: Record<string, number> = ${JSON.stringify(Object.fromEntries([...keycodes.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)), null, 1)}
`

writeFileSync(OUT, ts)

const unresolved = tokens.filter((t) => t.bindingCells === null)

console.log(
  `wrote ${OUT.replace(REPO + '/', '')}: ${tokens.length} tokens (hash 0x${expectedTokenHash.toString(16).padStart(8, '0')}, ` +
    `${grid.length} positions x ${stockLayers.length} layers), ${keycodes.size} named params`,
)

if (unresolved.length) {
  console.warn(`[gen-contract] tokens without #binding-cells: ${unresolved.map((t) => t.label).join(', ')}`)
}
if (skipped.length) {
  console.warn(`[gen-contract] defines not evaluable as numbers (kept out of KEYCODES): ${skipped.slice(0, 12).join(', ')}${skipped.length > 12 ? ' …' : ''}`)
}
