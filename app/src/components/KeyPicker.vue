<script setup lang="ts">
/*
 * Binding picker.
 *
 * Lives in the key properties column, inside a group that starts closed: the
 * bindings worth a popup are the ones with arguments, and a popup hid the grid
 * the write was for.
 *
 * The host never names a behavior: it picks a token id from the firmware's
 * table and fills the params that token accepts. Token availability comes from
 * the device (KEEB_TOKEN_F_READY — a behavior whose driver is not in the image
 * cannot be bound), and param metadata comes from the device too
 * (KEEB_T_TOKEN_PARAMS, which is ZMK's own behavior metadata), with the
 * devicetree binding cells as the offline fallback.
 */
import { computed, ref } from 'vue'

import { CATALOG, keyLabel } from '../data/keycodes.ts'
import { paramKinds, type ParamKind } from '../model/cap.ts'
import { KEEB_TOKEN_NONE, KEEB_TOKEN_UNKNOWN } from '../proto/constants.ts'
import { KEYCODES, TOKENS } from '../proto/zmk.gen.ts'
import type { Binding, ParamValue } from '../proto/types.ts'
import { LAYER_ID_INVALID, NONE_TOKEN, TRANSPARENT_TOKEN, useKeymapStore } from '../stores/keymap.ts'
import { useDeviceStore } from '../stores/device.ts'

defineProps<{ pos: number; reserved: boolean }>()

const emit = defineEmits<{ (e: 'set', binding: Binding): void }>()

const device = useDeviceStore()
const keymap = useKeymapStore()

const step = ref<'token' | 'params'>('token')
const token = ref<number | null>(null)
const paramValues = ref<number[]>([0, 0])
const search = ref('')
const metadata = ref<ParamValue[]>([])
const notice = ref('')

const GROUPS: Array<{ id: string; title: string; labels: string[] }> = [
  { id: 'keys', title: 'Keys', labels: ['kp', 'kt', 'sk'] },
  { id: 'layers', title: 'Layers', labels: ['mo', 'to', 'tog', 'sl', 'lt'] },
  { id: 'holdtap', title: 'Hold / tap', labels: ['mt', 'hml', 'hmr', 'gresc'] },
  { id: 'mouse', title: 'Mouse', labels: ['mkp', 'mmv', 'msc'] },
  { id: 'system', title: 'System', labels: ['bt', 'out', 'sys_reset', 'bootloader', 'right_reset', 'right_boot', 'caps_word', 'key_repeat', 'layer_art'] },
  { id: 'special', title: 'Special', labels: ['trans', 'none'] },
]

const readyIds = computed(() => new Set(device.readyTokens.map((t) => t.token)))
const hasDeviceTokens = computed(() => device.tokens.length > 0)

const groups = computed(() =>
  GROUPS.map((g) => ({
    id: g.id,
    title: g.title,
    items: TOKENS.filter((t) => g.labels.includes(t.label)).map((t) => ({
      token: t.id,
      label: `&${t.label}`,
      name: t.displayName ?? t.name,
      ready: !hasDeviceTokens.value || readyIds.value.has(t.id),
    })),
  })),
)

const activeGroup = ref('keys')

const chosenDef = computed(() => (token.value === null ? null : TOKENS.find((t) => t.id === token.value) ?? null))
const kinds = computed<ParamKind[]>(() => (token.value === null ? [] : paramKinds(token.value)))

const metadataFor = (param: number): ParamValue[] => metadata.value.filter((v) => v.param === param)

async function chooseToken(id: number): Promise<void> {
  notice.value = ''
  token.value = id
  paramValues.value = [0, 0]
  metadata.value = []

  if (id === TRANSPARENT_TOKEN || id === NONE_TOKEN) {
    stage({ token: id, param1: 0, param2: 0 })
    return
  }

  if (device.connected) {
    try {
      metadata.value = await device.readTokenParams(id)
    } catch (err) {
      notice.value = err instanceof Error ? err.message : String(err)
    }
  }

  step.value = 'params'
}

/* ---------------------------------------------------------------- keycodes */

const keyGroups = computed(() => {
  const q = search.value.trim().toUpperCase()

  const filtered = (items: typeof CATALOG.letters) =>
    q ? items.filter((i) => i.name.includes(q) || i.label.toUpperCase().includes(q)) : items

  return Object.entries(CATALOG)
    .filter(([id]) => id !== 'mouseButtons' && id !== 'mouseMove' && id !== 'mouseScroll')
    .map(([id, items]) => ({ id, items: filtered(items) }))
    .filter((g) => g.items.length)
})

/* ---------------------------------------------------------------- params */

const layerChips = computed(() => keymap.slots.filter((s) => s.id !== LAYER_ID_INVALID))

const MOVE_ITEMS = ['MOVE_UP', 'MOVE_DOWN', 'MOVE_LEFT', 'MOVE_RIGHT']
const SCRL_ITEMS = ['SCRL_UP', 'SCRL_DOWN', 'SCRL_LEFT', 'SCRL_RIGHT']
const BUTTON_ITEMS = ['LCLK', 'RCLK', 'MCLK', 'MB4', 'MB5']

const BT_ITEMS = [
  { v: 0, label: 'clear profile' },
  { v: 1, label: 'next profile' },
  { v: 2, label: 'previous profile' },
  { v: 3, label: 'select profile' },
  { v: 4, label: 'clear all bonds' },
  { v: 5, label: 'disconnect' },
]

const OUT_ITEMS = [
  { v: 0, label: 'toggle' },
  { v: 1, label: 'USB' },
  { v: 2, label: 'BLE' },
  { v: 3, label: 'none' },
]

function setParam(index: number, value: number): void {
  const next = [...paramValues.value]
  next[index] = value >>> 0
  paramValues.value = next
}

const buttonMask = computed(() => paramValues.value[0] ?? 0)

const preview = computed<Binding | null>(() =>
  token.value === null ? null : { token: token.value, param1: paramValues.value[0] ?? 0, param2: paramValues.value[1] ?? 0 },
)

/**
 * Stage a binding for this position.
 *
 * The picker is a group in the key properties column, so staging leaves it where
 * it was: the grid is next to it and shows the result, and the next binding is
 * one more click in the same group. Nothing is sent until Apply changes.
 */
function stage(binding: Binding): void {
  emit('set', binding)
}

function apply(): void {
  if (token.value === null) {
    return
  }

  stage({ token: token.value, param1: paramValues.value[0] ?? 0, param2: paramValues.value[1] ?? 0 })
}

function paramLabel(kind: ParamKind, index: number): string {
  const md = metadataFor(index)

  if (md.length === 1) {
    return md[0].name || kind
  }

  if (md.length > 1) {
    return `${md.length} accepted values`
  }

  switch (kind) {
    case 'keycode': return 'keycode'
    case 'layer': return 'layer'
    case 'mouse-vector': return 'vector'
    case 'button-mask': return 'buttons'
    case 'bt-cmd': return 'command'
    case 'output': return 'output'
    default: return `param${index + 1}`
  }
}

function reset(): void {
  step.value = 'token'
  token.value = null
  search.value = ''
}
</script>

<template>
  <div class="picker">
    <div class="head">
      <div class="cell-info">
        <b>position {{ pos }}</b>
        <span>{{ chosenDef ? `${chosenDef.label} (${chosenDef.name})` : 'choose a token' }}</span>
        <span v-if="reserved" class="reserved">reserved position — the firmware will refuse this write</span>
      </div>
    </div>

    <div v-if="step === 'token'" class="step">
      <div class="cats">
        <button v-for="g in groups" :key="g.id" class="cat" :class="{ on: activeGroup === g.id }" @click="activeGroup = g.id">
          {{ g.title }}
        </button>
      </div>

      <div class="tokens">
        <button
          v-for="t in groups.find((g) => g.id === activeGroup)?.items ?? []"
          :key="t.token"
          class="token"
          :disabled="!t.ready"
          :title="t.ready ? t.name : `${t.name}: no driver in this firmware build`"
          @click="chooseToken(t.token)"
        >
          <span class="tk">{{ t.label }}</span>
          <span class="tn">{{ t.name }}</span>
          <span class="tid">#{{ t.token }}</span>
        </button>
      </div>

      <p class="note">
        Tokens are the firmware's table (devicetree order). A greyed token is in
        the table but has no driver compiled in, so the keyboard would reject it.
      </p>
    </div>

    <div v-else class="step">
      <div class="param-head">
        <b>{{ chosenDef?.label }}</b>
        <span class="cells">{{ chosenDef?.bindingCells ?? 0 }} binding cells</span>
        <button class="chip small" @click="reset">change token</button>
      </div>

      <div v-for="(kind, index) in kinds" :key="index" class="param">
        <div class="param-title">
          param{{ index + 1 }} · {{ paramLabel(kind, index) }}
          <span class="cur">{{ paramValues[index] ?? 0 }}</span>
        </div>

        <template v-if="kind === 'keycode'">
          <input v-model="search" class="search" placeholder="search keycodes…" spellcheck="false" />
          <div class="keys">
            <div v-for="g in keyGroups" :key="g.id" class="keygroup">
              <button
                v-for="k in g.items"
                :key="k.name"
                class="key"
                :class="{ on: (paramValues[index] ?? 0) === k.code }"
                :title="`${k.name} = 0x${k.code.toString(16)}`"
                @click="setParam(index, k.code)"
              >
                {{ k.label }}
              </button>
            </div>
          </div>
        </template>

        <template v-else-if="kind === 'layer'">
          <div class="chips">
            <button
              v-for="s in layerChips"
              :key="s.id"
              class="chip"
              :class="{ on: (paramValues[index] ?? 0) === s.id }"
              @click="setParam(index, s.id)"
            >
              {{ s.name }} <small>#{{ s.id }}</small>
            </button>
          </div>
        </template>

        <template v-else-if="kind === 'mouse-vector'">
          <div class="chips">
            <button
              v-for="n in (chosenDef?.label === 'msc' ? SCRL_ITEMS : MOVE_ITEMS)"
              :key="n"
              class="chip"
              :class="{ on: (paramValues[index] ?? 0) === KEYCODES[n] }"
              :title="`${n} = ${KEYCODES[n]}`"
              @click="setParam(index, KEYCODES[n] ?? 0)"
            >
              {{ n.replace(/^MOVE_/, '').replace(/^SCRL_/, '') }}
            </button>
          </div>
        </template>

        <template v-else-if="kind === 'button-mask'">
          <div class="chips">
            <button
              v-for="(n, i) in BUTTON_ITEMS"
              :key="n"
              class="chip"
              :class="{ on: (buttonMask & (1 << i)) !== 0 }"
              @click="setParam(index, buttonMask ^ (1 << i))"
            >
              {{ n }}
            </button>
          </div>
        </template>

        <template v-else-if="kind === 'bt-cmd'">
          <div class="chips">
            <button
              v-for="b in BT_ITEMS"
              :key="b.v"
              class="chip"
              :class="{ on: (paramValues[index] ?? 0) === b.v }"
              @click="setParam(index, b.v)"
            >
              {{ b.label }}
            </button>
          </div>
        </template>

        <template v-else-if="kind === 'output'">
          <div class="chips">
            <button
              v-for="o in OUT_ITEMS"
              :key="o.v"
              class="chip"
              :class="{ on: (paramValues[index] ?? 0) === o.v }"
              @click="setParam(index, o.v)"
            >
              {{ o.label }}
            </button>
          </div>
        </template>

        <template v-else>
          <input
            class="num"
            type="number"
            :value="paramValues[index] ?? 0"
            @input="setParam(index, Number(($event.target as HTMLInputElement).value))"
          />
        </template>
      </div>

      <div v-if="kinds.length === 0" class="note">
        This token takes no parameters — binding it is the whole edit.
      </div>

      <div class="apply">
        <span v-if="preview" class="pv">
          {{ chosenDef?.label }} {{ paramValues.join(' ') }} →
          <template v-if="preview.token !== KEEB_TOKEN_NONE && preview.token !== KEEB_TOKEN_UNKNOWN">
            {{ keyLabel(preview.param2) }}{{ (chosenDef?.bindingCells ?? 0) === 1 ? keyLabel(preview.param1) : '' }}
          </template>
        </span>
        <button class="chip primary" title="stage this binding for position {{ pos }}; nothing is written until Apply changes" @click="apply">Apply</button>
      </div>

      <p v-if="notice" class="notice">{{ notice }}</p>
    </div>
  </div>
</template>

<style scoped>
.picker {
  display: flex; flex-direction: column; gap: 12px; min-width: 0;
}

.head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center; }
.cell-info { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--text-dim); }
.cell-info b { color: var(--text); font-size: 14px; }
.reserved { color: var(--warn); }

.cats { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
.cat { padding: 5px 10px; border: 1px solid var(--border); border-radius: 0; font-size: 12px; color: var(--text-dim); background: transparent; }
.cat.on { border-color: var(--ink); background: var(--bg-raised); color: var(--text); font-weight: 700; }

.tokens { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; }
.token {
  display: flex; align-items: baseline; gap: 6px; text-align: left;
  padding: 7px 9px; border: 1px solid var(--border); border-radius: 0;
  background: var(--bg-raised); color: var(--text); font-size: 12px;
}
.token:disabled { opacity: 0.62; }
.token:hover:not(:disabled) { border-color: var(--border-strong); }
.tk { font-weight: 700; }
.tn { color: var(--text-faint); font-size: 11px; flex: 1; }
.tid { color: var(--text-faint); font-size: 10px; font-family: var(--mono); }

.param-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13px; }
.cells { color: var(--text-faint); font-size: 11px; }
.param { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.param-title { font-size: 11px; color: var(--text-dim); display: flex; gap: 8px; }
.cur { font-family: var(--mono); color: var(--text-faint); }

.search { padding: 5px 8px; border: 1px solid var(--border); border-radius: 0; background: var(--bg-inset); color: var(--text); font-size: 12px; }

.keys { display: flex; flex-direction: column; gap: 4px; max-height: 260px; overflow: auto; }
.keygroup { display: flex; gap: 4px; flex-wrap: wrap; }
.key {
  min-width: 40px; padding: 5px 7px; font-size: 11px;
  border: 1px solid var(--border); border-radius: 0;
  background: var(--bg-raised); color: var(--text);
}
.key.on { background: var(--text); border-color: var(--text); color: var(--bg-raised); font-weight: 700; }
.key:hover { border-color: var(--border-strong); }

.chips { display: flex; gap: 5px; flex-wrap: wrap; }
.chip {
  padding: 5px 10px; font-size: 12px;
  border: 1px solid var(--border); border-radius: 0;
  background: var(--bg-raised); color: var(--text-dim);
}
.chip.on { border-color: var(--ink); background: var(--bg-raised); color: var(--text); }
.chip:hover { border-color: var(--border-strong); }
.chip.small { font-size: 11px; }
.chip.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); font-weight: 700; }

.num { width: 120px; padding: 5px 8px; border: 1px solid var(--border); border-radius: 0; background: var(--bg-inset); color: var(--text); }

.apply { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 10px; }
.pv { font-size: 11px; color: var(--text-faint); font-family: var(--mono); }
.note { color: var(--text-faint); font-size: 11px; }
.notice { color: var(--err); font-size: 11px; }
</style>
