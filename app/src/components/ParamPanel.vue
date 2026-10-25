<script setup lang="ts">
/*
 * Device panel: what the keyboard said it can do, and the actions that only
 * the keyboard can perform.
 *
 * Save / discard / reset are surfaced here rather than assumed by the app,
 * because persistence is the firmware's decision (ZMK's settings subtree), not
 * a localStorage habit the configurator happens to have.
 *
 * Autosave is the one habit this app does have, and it is a preference rather
 * than a protocol rule: applying a change and persisting it are two separate
 * firmware operations, and only the second one survives a reboot.
 */
import { ref } from 'vue'

import { useDeviceStore } from '../stores/device.ts'
import type { WriteResult } from '../stores/keymap.ts'
import { useKeymapStore } from '../stores/keymap.ts'

const device = useDeviceStore()
const keymap = useKeymapStore()

const busy = ref(false)
const message = ref('')

const hex = (v: number): string => `0x${v.toString(16).padStart(8, '0')}`

/* The simulated keyboard exists for the tests and the SSR smoke render only;
 * nothing here can reach it. Every action in this panel is a real keyboard
 * action. */

async function run(label: string, fn: () => Promise<unknown>): Promise<void> {
  busy.value = true
  /* Cleared before, not after: a step that reports its own outcome ("reconnected
   * to keeb") is the message, and wiping it on success is how a panel ends up
   * saying nothing at all about what just happened.
   */
  message.value = ''

  try {
    await fn()
  } catch (err) {
    message.value = `${label}: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    busy.value = false
  }
}

/* Gesture-free retry against a keyboard this browser already knows: the usual
 * answer after the keyboard slept, rebooted, or was handed back by another host.
 * The chooser itself lives in the Connect card, because it needs a click. */
async function reconnectSaved(): Promise<void> {
  await run('reconnect', async () => {
    const label = await device.reconnectBle()

    if (!label) {
      message.value = 'no saved keyboard reachable - use Connect'
      return
    }

    await device.handshake()
    await keymap.loadAll()
    message.value = `reconnected to ${label}`
  })
}

async function forget(): Promise<void> {
  await run('forget', async () => {
    const n = await device.forgetBle()

    message.value = n ? `forgot ${n} saved device${n === 1 ? '' : 's'} in this browser` : 'this browser has no saved keyboard grants'
  })
}

/** The only path from a staged edit to the keyboard. */
async function applyChanges(): Promise<void> {
  const r = await keymap.commitAll()

  message.value = r.ok
    ? describe(r, `applied ${r.applied} cell${r.applied === 1 ? '' : 's'} to the keyboard`)
    : (r.reason ?? 'apply failed')
}

/**
 * Report which of the two things happened: the keyboard accepted the write, and
 * whether it also stored it. A write that did not persist has to be named as
 * such - it is the one a reboot takes back.
 */
function describe(r: WriteResult, done: string): string {
  if (r.saveReason) {
    return `${done}; save failed: ${r.saveReason}`
  }

  if (r.saved) {
    return `${done} and saved to the keyboard’s settings`
  }

  return keymap.hasUnsaved ? `${done} - not saved (autosave is off)` : done
}

function toggleAutosave(on: boolean): void {
  keymap.setAutosave(on)

  /* Switching autosave on over a keyboard that already holds unsaved writes
   * persists them now rather than waiting for the next write to trigger it.
   */
  if (on) {
    void keymap.persistAfterWrite().then((p) => {
      if (p.reason) {
        message.value = `save failed: ${p.reason}`
      }
    })
  }
}

async function revertEdits(): Promise<void> {
  const n = await keymap.revertEdits()

  message.value = `reverted ${n} staged edit${n === 1 ? '' : 's'}; the keyboard was never asked to change`
}

async function save(): Promise<void> {
  const r = await keymap.save()

  message.value = r.ok ? 'saved to the keyboard’s settings' : (r.reason ?? 'save failed')
}

async function discard(): Promise<void> {
  const r = await keymap.discard()

  message.value = r.ok ? 'reverted to the keyboard’s saved settings (the keymap file when nothing is saved)' : (r.reason ?? 'discard failed')
}

async function resetSettings(): Promise<void> {
  const r = await keymap.resetSettings()

  message.value = r.ok ? 'saved keymap settings deleted' : (r.reason ?? 'reset failed')
}
</script>

<template>
  <div class="panel">
    <div class="group">
      <button class="btn" :disabled="busy || device.connected" title="reconnect to a keyboard this browser already has permission for - no chooser, no pairing prompt" @click="reconnectSaved">Reconnect</button>
      <button class="btn" :disabled="busy" title="revoke this browser's saved Bluetooth grants, then press Connect to pair again. Do this after a keyboard reset (BT_CLR, cleared bonds, a reflash) or a firmware flash: Chrome keeps stale entries that can no longer complete an encrypted link" @click="forget">Forget device</button>
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
      <button class="btn push" :disabled="busy || !keymap.isDirty || !device.writable" :title="`${keymap.dirtyTotal} staged cell write(s) - nothing reaches the keyboard until this`" @click="applyChanges">
        Apply changes{{ keymap.dirtyTotal ? ` (${keymap.dirtyTotal})` : '' }}
      </button>
      <button class="btn" :disabled="busy || !keymap.isDirty" title="throw the staged edits away and show the keyboard's layout again; it was never asked to change" @click="revertEdits">
        Revert{{ keymap.dirtyTotal ? ` (${keymap.dirtyTotal})` : '' }}
      </button>
      <button class="btn" :disabled="busy || !device.writable" title="tell the keyboard to persist the layout it has now (what Autosave does after every write)" @click="save">Save</button>
      <button class="btn" :disabled="busy || !device.writable" title="reload the layout from the keyboard's saved settings (the keymap file when nothing is saved). After a save this is a no-op - use Reset settings to get back to the keymap file" @click="discard">Discard</button>
      <button class="btn danger" :disabled="busy || !device.writable" title="delete the saved keymap settings, which is the only way back to the keymap file the firmware was flashed with" @click="resetSettings">Reset settings</button>
    </div>

    <div class="group">
      <label class="toggle" :class="{ on: keymap.autosave }" title="after a write lands, immediately tell the keyboard to persist it (ZMK's settings storage). Off means a change stays live only until the keyboard is powered off">
        <input type="checkbox" :checked="keymap.autosave" :disabled="busy" @change="toggleAutosave(($event.target as HTMLInputElement).checked)" />
        Autosave
      </label>
      <span v-if="keymap.hasUnsaved" class="unsaved" title="these writes are in the keyboard's live keymap but not in its settings storage - a reboot or a battery swap drops them">
        {{ keymap.unsavedWrites }} change{{ keymap.unsavedWrites === 1 ? '' : 's' }} not saved
      </span>
      <span v-else-if="keymap.savedAt" class="saved" title="last KEEB_EV_SAVED from the keyboard">saved to the keyboard</span>
    </div>

    <div class="notes">
      <span>{{ device.statusLine }}</span>
      <span v-if="message" class="msg">{{ message }}</span>
      <span v-if="!device.tokenTableMatches && device.connected" class="warn">
        token table does not match this firmware — writes are refused ({{ device.info?.tokenCount }} tokens, keyboard 0x{{ (device.info?.tokenHash ?? 0).toString(16).padStart(8, '0') }} ≠ this build 0x{{ (device.localTokenHash ?? 0).toString(16).padStart(8, '0') }})
      </span>
      <span v-for="d in device.tokenTableDiff" :key="d" class="warn">{{ d }}</span>
    </div>
  </div>
</template>

<style scoped>
.panel { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; }
.group { display: flex; gap: 6px; flex-wrap: wrap; }

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

.toggle {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 10px; border-radius: 7px;
  border: 1px solid var(--border); font-size: 12px; color: var(--text-faint);
  cursor: pointer;
}
.toggle.on { border-color: var(--ok); color: var(--ok); }
.toggle input { accent-color: var(--ok); }

.unsaved { font-size: 11.5px; color: var(--warn); align-self: center; }
.saved { font-size: 11.5px; color: var(--text-faint); align-self: center; }

.status { display: flex; gap: 10px; flex-wrap: wrap; font-size: 11.5px; color: var(--text-dim); }
.status b { color: var(--text); }
.status.error b { color: var(--err); }
.hash { font-family: var(--mono); }
.hash.ok { color: var(--ok); }

.spacer { height: 2px; }

.notes { display: flex; flex-direction: column; gap: 2px; align-items: flex-end; font-size: 11px; color: var(--text-faint); }
.msg { color: var(--ok); }
.warn { color: var(--warn); }
</style>
