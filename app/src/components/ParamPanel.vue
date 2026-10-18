<script setup lang="ts">
/*
 * Device panel: what the keyboard said it can do, and the actions that only
 * the keyboard can perform.
 *
 * Save / discard / reset are surfaced here rather than assumed by the app,
 * because persistence is the firmware's decision (ZMK's settings subtree), not
 * a localStorage habit the configurator happens to have.
 */
import { computed, ref } from 'vue'

import { REVERT_HOLD_MS, RESERVED_POSITIONS } from '../proto/zmk.gen.ts'
import { useDeviceStore } from '../stores/device.ts'
import { useKeymapStore } from '../stores/keymap.ts'
import { MockKeyboard } from '../transport/mockKeyboard.ts'

const device = useDeviceStore()
const keymap = useKeymapStore()

const busy = ref(false)
const message = ref('')

const hex = (v: number): string => `0x${v.toString(16).padStart(8, '0')}`

/* The simulated keyboard can be made to change on its own, which is the only
 * way to see the live path (notifications, re-reads, layer state) without the
 * hardware. Real keyboards produce these themselves. */
const mock = computed(() => (device.transport instanceof MockKeyboard ? device.transport : null))

function simLayer(): void {
  mock.value?.simulateLayerState(0b010)
  message.value = 'simulated: the keyboard is on layer 2 (MO held)'
}

function simRevert(): void {
  mock.value?.simulateRevertChord()
  message.value = 'simulated: reserved chord held on the keyboard'
}

async function run(label: string, fn: () => Promise<unknown>): Promise<void> {
  busy.value = true

  try {
    await fn()
    message.value = ''
  } catch (err) {
    message.value = `${label}: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    busy.value = false
  }
}

async function connectMock(): Promise<void> {
  await run('connect mock', async () => {
    await device.connectMock()
    await device.handshake()
    await keymap.loadAll()
  })
}

async function connectBle(): Promise<void> {
  await run('connect BLE', async () => {
    await device.connectBle()
    await device.handshake()
    await keymap.loadAll()
  })
}

async function reconnect(): Promise<void> {
  await run('refresh', async () => {
    await device.handshake()
    await keymap.loadAll()
  })
}

async function push(): Promise<void> {
  const r = await keymap.commitAll()

  message.value = r.ok ? `pushed ${r.applied} cell${r.applied === 1 ? '' : 's'}` : (r.reason ?? 'push failed')
}

async function save(): Promise<void> {
  const r = await keymap.save()

  message.value = r.ok ? 'saved to the keyboard’s settings' : (r.reason ?? 'save failed')
}

async function discard(): Promise<void> {
  const r = await keymap.discard()

  message.value = r.ok ? 'reverted to the keymap file' : (r.reason ?? 'discard failed')
}

async function resetSettings(): Promise<void> {
  const r = await keymap.resetSettings()

  message.value = r.ok ? 'saved keymap settings deleted' : (r.reason ?? 'reset failed')
}
</script>

<template>
  <div class="panel">
    <div class="group">
      <button class="btn primary" :disabled="busy" @click="connectMock">Mock</button>
      <button class="btn" :disabled="busy" @click="connectBle">Bluetooth…</button>
      <button class="btn" :disabled="busy || !device.connected" @click="reconnect">Re-read</button>
      <button class="btn" :disabled="busy || !device.connected" @click="device.disconnect()">Disconnect</button>
    </div>

    <div class="status" :class="device.state">
      <b>{{ device.label || 'no keyboard' }}</b>
      <span v-if="device.info">
        proto {{ device.info.proto }} · fw {{ device.info.fwVersion }} ·
        {{ device.info.keyCount }} keys · {{ device.info.layerCount }} layer slots ·
        {{ device.info.tokenCount }} tokens · names ≤ {{ device.info.nameMax }}
      </span>
      <span class="hash" :class="{ ok: device.tokenTableMatches }" title="token table hash (keeb_info.token_hash)">
        tokens {{ hex(device.info?.tokenHash ?? 0) }}
        <template v-if="!device.tokenTableMatches">≠ local {{ hex(device.localTokenHash) }}</template>
      </span>
    </div>

    <span class="spacer" />

    <div class="group">
      <button class="btn push" :disabled="busy || !keymap.isDirty || !device.writable" :title="`${keymap.dirtyTotal} pending cell writes`" @click="push">
        Push{{ keymap.dirtyTotal ? ` (${keymap.dirtyTotal})` : '' }}
      </button>
      <button class="btn" :disabled="busy || !device.writable" @click="save">Save</button>
      <button class="btn" :disabled="busy || !device.writable" title="reload the layout from the keymap file" @click="discard">Discard</button>
      <button class="btn danger" :disabled="busy || !device.writable" title="delete the saved keymap settings" @click="resetSettings">Reset settings</button>
    </div>

    <div class="notes">
      <span>{{ device.statusLine }}</span>
      <span v-if="message" class="msg">{{ message }}</span>
      <span v-if="!device.tokenTableMatches && device.connected" class="warn">
        token table does not match this firmware — writes are refused. Run <code>npm run gen</code>.
      </span>
      <span class="hint">
        reserved positions {{ RESERVED_POSITIONS.join(', ') }}: hold all of them {{ REVERT_HOLD_MS / 1000 }}s on the keyboard to discard the saved keymap
      </span>
    </div>

    <div v-if="mock" class="group sim">
      <button class="btn small" title="the keyboard changes layer on its own while someone types" @click="simLayer">sim: hold MO</button>
      <button class="btn small" title="the reserved-position chord on the keyboard itself" @click="simRevert">sim: revert chord</button>
    </div>
  </div>
</template>

<style scoped>
.panel { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; }
.group { display: flex; gap: 6px; flex-wrap: wrap; }
.sim .btn { font-size: 11px; padding: 4px 9px; border-style: dashed; }

.btn {
  padding: 6px 12px; border-radius: 7px;
  border: 1px solid var(--border); background: var(--bg-raised);
  font-size: 12px; color: var(--text-dim);
}
.btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.btn:disabled { opacity: 0.45; }
.btn.primary { border-color: var(--accent); color: var(--accent); }
.btn.push { border-color: var(--ok); color: var(--ok); }
.btn.danger:hover:not(:disabled) { border-color: var(--err); color: var(--err); }

.status { display: flex; gap: 10px; flex-wrap: wrap; font-size: 11.5px; color: var(--text-dim); }
.status b { color: var(--text); }
.status.error b { color: var(--err); }
.hash { font-family: var(--mono); }
.hash.ok { color: var(--ok); }

.spacer { height: 2px; }

.notes { display: flex; flex-direction: column; gap: 2px; align-items: flex-end; font-size: 11px; color: var(--text-faint); }
.msg { color: var(--ok); }
.warn { color: var(--warn); }
.hint { color: var(--text-faint); }
code { font-family: var(--mono); }
</style>
