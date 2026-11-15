<script setup lang="ts">
/*
 * Settings: the Kconfig values this keyboard lets a host change without a rebuild.
 *
 * The table sits in the middle of the page (where the keyboard usually is) and
 * the write actions live in a sliding dock at the bottom: Apply is the primary,
 * and a combined "⋯" button folds Save and Discard under it — the same habit as
 * the key-map dock.
 *
 * Every number on the page comes from the keyboard's own KEEB_T_SETTINGS record,
 * and every write re-reads it, so the row is the firmware's value, not a guess
 * this page kept.
 *
 * The page is one entry of the settings menu: the same store, the same dock, but
 * only the category cards that entry owns. Dirty tracking stays store-wide, so an
 * edit on one page still blocks Apply on another until it is written.
 */
import { computed, ref } from 'vue'

import { colorToHex, hexToColor, humanMs, useSettingsStore } from '../stores/settings.ts'
import type { SettingCategory, SettingField } from '../stores/settings.ts'

export type SettingsPage = 'configuration' | 'LED'

const PAGE_TITLE: Record<SettingsPage, string> = {
  configuration: 'Configuration',
  LED: 'LED',
}

/** Which category cards each settings page shows. */
const PAGE_CATEGORIES: Record<SettingsPage, SettingCategory[]> = {
  configuration: ['energy', 'matrix', 'holdTap'],
  LED: ['led', 'layerLed'],
}

const props = defineProps<{ page: SettingsPage }>()

const s = useSettingsStore()

function hexOf(v: number | boolean): string {
  return colorToHex(typeof v === 'number' ? v : 0)
}

function onHex(field: SettingField, raw: string): void {
  const c = hexToColor(raw)

  s.set(field.key, c ?? Number.NaN)
}

function displayKeyboard(field: SettingField, v: unknown): string {
  if (typeof v === 'boolean') {
    return v ? 'on' : 'off'
  }

  if (typeof v === 'number') {
    if (field.kind === 'ms') {
      return humanMs(v)
    }
    if (field.kind === 'color') {
      return colorToHex(v)
    }
  }

  return String(v)
}

const groups = computed(() => s.groups.filter((g) => PAGE_CATEGORIES[props.page].includes(g.category)))
const dirty = computed(() => s.dirty)
const statusLine = computed(() => s.statusLine)
const problems = computed(() => s.problems)
const savedAt = computed(() => s.savedAt)

const moreOpen = ref(false)

async function apply(): Promise<void> {
  moreOpen.value = false
  const r = await s.apply()

  if (!r.ok) {
    s.lastError = r.reason ?? 'apply failed'
  }
}

async function save(): Promise<void> {
  moreOpen.value = false
  const r = await s.save()

  if (!r.ok) {
    s.lastError = r.reason ?? 'save failed'
  }
}

async function discard(): Promise<void> {
  moreOpen.value = false
  const r = await s.discard()

  if (!r.ok) {
    s.lastError = r.reason ?? 'discard failed'
  }
}
</script>

<template>
  <section class="settings">
    <!-- The page header floats above the category grid. -->
    <div class="s-head">
      <span class="s-title">Settings · {{ PAGE_TITLE[page] }}</span>
      <span class="s-status">{{ statusLine }}</span>
      <button class="s-reload" title="read the values back from the keyboard" :disabled="!s.loaded" @click="s.reload()">
        Reload
      </button>
    </div>

    <p v-if="!s.supported" class="s-note">
      This build does not expose the settings channel, so there is nothing here to edit. Rebuild with
      <code>CONFIG_KEEB_SETTINGS=y</code> to get it.
    </p>

    <template v-else>
      <div class="s-grid">
        <div v-for="g in groups" :key="g.category" class="s-card">
          <h3 class="s-cat">{{ g.label }}</h3>
          <div class="s-rows">
            <div v-for="it in g.items" :key="it.field.key" class="s-row">
            <span class="s-key">
              {{ it.field.label }}
              <small>{{ it.field.config }}</small>
              <small>{{ it.field.note }}</small>
            </span>

            <div class="s-val">
              <template v-if="it.field.kind === 'bool'">
                <button
                  class="s-switch"
                  :class="{ on: !!it.value }"
                  :disabled="!s.canWrite"
                  :aria-pressed="!!it.value"
                  :aria-label="it.field.label"
                  @click="s.set(it.field.key, it.value ? 0 : 1)"
                ></button>
              </template>

              <template v-else-if="it.field.kind === 'color'">
                <span class="s-color">
                  <input
                    class="swatch"
                    type="color"
                    :value="hexOf(it.value)"
                    :disabled="!s.canWrite"
                    :aria-label="`${it.field.label} color`"
                    @input="onHex(it.field, ($event.target as HTMLInputElement).value)"
                  />
                  <input
                    class="field"
                    type="text"
                    :value="hexOf(it.value)"
                    :disabled="!s.canWrite"
                    :aria-label="`${it.field.label} as a hex color`"
                    @input="onHex(it.field, ($event.target as HTMLInputElement).value)"
                  />
                </span>
              </template>

              <template v-else>
                <input
                  class="field"
                  type="number"
                  inputmode="numeric"
                  :step="it.field.kind === 'percent' ? 1 : 1000"
                  :min="it.field.min"
                  :max="it.field.max"
                  :value="it.value"
                  :aria-label="`${it.field.label} in ${it.field.kind === 'percent' ? 'percent' : 'milliseconds'}`"
                  :disabled="!s.canWrite"
                  @input="s.set(it.field.key, ($event.target as HTMLInputElement).value)"
                />
              </template>

              <span class="s-hint" :class="{ bad: it.invalid }">
                {{ it.hint }}
                <template v-if="it.changed">
                  · keyboard: {{ displayKeyboard(it.field, it.fromDevice) }}
                </template>
              </span>
            </div>
          </div>
          </div>
        </div>
      </div>

      <p v-if="problems.length" class="s-note bad">{{ problems[0] }}</p>
      <p v-else-if="s.lastError" class="s-note bad">{{ s.lastError }}</p>
      <p v-else-if="savedAt" class="s-note">saved to the keyboard's settings storage at {{ savedAt }}</p>
    </template>

    <!-- The bottom dock: Apply is the loud one, a combined ⋯ holds save/discard. -->
    <div class="dock-s" v-if="s.supported">
      <div class="bar">
        <button
          class="go-apply"
          :disabled="!dirty || !s.canWrite || s.loading || problems.length > 0"
          title="send the values to the keyboard: they take effect immediately and last until it is reflashed"
          @click="apply"
        >
          Apply
        </button>

        <div class="more-wrap">
          <button
            class="go-more"
            :class="{ on: moreOpen }"
            :aria-expanded="moreOpen"
            aria-label="more actions: save, discard"
            :disabled="!s.canWrite"
            @click="moreOpen = !moreOpen"
          >⋯</button>

          <div v-if="moreOpen" class="drop">
            <button
              title="persist what the keyboard is running on, so it survives a reboot"
              :disabled="dirty"
              @click="save"
            >
              Save to flash
            </button>
            <button
              title="put the compiled-in values back and delete the saved copy"
              @click="discard"
            >
              Discard (back to the build)
            </button>
            <button title="throw the edits on this page away" :disabled="!dirty" @click="s.dropLocalEdits()">
              Revert this page
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.settings {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  /* The top nav and the Apply dock float over the stage; pad the page so
   * neither covers a row. The dock is 86px up and ~40px tall, so 140px clears
   * the last row when the page is scrolled to its end. */
  padding-top: 116px;
  padding-bottom: 140px;
}

/* The page header bar and the category grid share one centred column. */
.s-head,
.s-grid {
  width: min(1000px, 100%);
}

.s-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--panel-raised);
}

/* Two columns of category cards. Cards in a row stretch to the same height so
 * their edges line up. */
.s-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

/* A category card holds one group of rows. */
.s-card {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--panel-raised);
  padding: 6px 0;
}

.s-cat {
  margin: 0;
  padding: 12px 16px 4px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mid);
}

.s-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
}

.s-status {
  font-size: 12px;
  color: var(--mid);
  flex: 1 1 auto;
}

.s-reload {
  border: 1px solid var(--line);
  border-radius: 10px;
  background: transparent;
  color: var(--mid);
  font: inherit;
  font-size: 12px;
  padding: 6px 10px;
  cursor: pointer;
}

.s-reload:hover:not(:disabled) { color: var(--ink); border-color: var(--ink); }
.s-reload:disabled { opacity: 0.45; cursor: default; }

.s-rows {
  padding: 4px 0;
}

.s-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.s-row:last-child { border-bottom: 0; }

.s-key {
  font-size: 13px;
  color: var(--ink);
  line-height: 1.25;
}

.s-key small {
  display: block;
  font-size: 11px;
  color: var(--mid);
}

.s-val {
  flex: 0 0 auto;
  min-width: 170px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.field {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--bg-inset);
  color: var(--ink);
  font: inherit;
  font-size: 13px;
}

.field:focus { border-color: var(--accent); outline: none; }
.field:disabled { opacity: 0.5; }

/* boolean toggle */
.s-switch {
  width: 42px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--bg-inset);
  position: relative;
  cursor: pointer;
  transition: background 0.15s;
}
.s-switch::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--mid);
  transition: left 0.15s;
}
.s-switch.on { background: var(--accent); border-color: var(--accent); }
.s-switch.on::after { left: 21px; background: #fff; }
.s-switch:disabled { opacity: 0.5; cursor: default; }

/* color picker + hex text */
.s-color {
  display: flex;
  gap: 6px;
  width: 100%;
}
.s-color .swatch {
  width: 40px;
  height: auto;
  padding: 2px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--bg-inset);
}
.s-color .field {
  flex: 1 1 auto;
  min-width: 0;
}

.s-hint {
  font-size: 11px;
  color: var(--mid);
}

.s-hint.bad { color: var(--warn); }

.s-note {
  width: min(1000px, 100%);
  padding: 10px 16px 4px;
  font-size: 12px;
  color: var(--mid);
}

.s-note.bad { color: var(--warn); }

.s-note code { color: var(--ink); }

/* The bottom dock. */
.dock-s {
  position: fixed;
  left: 50%;
  bottom: 86px;
  transform: translateX(-50%);
  z-index: 30;
  width: min(460px, calc(100vw - 32px));
}

.bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--panel-raised);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
}

.go-apply {
  padding: 10px 28px;
  border-radius: 12px;
  border: none;
  background: linear-gradient(135deg, #9deab8, var(--accent-deep));
  color: var(--on-accent);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 0 20px var(--accent-dim);
}

.go-apply:hover:not(:disabled) { filter: brightness(1.06); }
.go-apply:disabled { opacity: 0.5; cursor: default; box-shadow: none; }

.more-wrap {
  position: relative;
}

.go-more {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--mid);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.go-more:hover { color: var(--ink); border-color: var(--ink); }
.go-more.on { background: rgba(255, 255, 255, 0.12); color: var(--ink); border-color: rgba(110, 231, 160, 0.6); }
.go-more:disabled { opacity: 0.45; cursor: default; }

.drop {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  min-width: 220px;
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: rgba(14, 11, 9, 0.92);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
}

.drop button {
  padding: 9px 12px;
  border-radius: 9px;
  border: none;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.drop button:hover:not(:disabled) { background: rgba(255, 255, 255, 0.08); color: var(--accent); }
.drop button:disabled { opacity: 0.45; cursor: default; }

@media (max-width: 640px) {
  .settings { padding-top: 0; padding-bottom: 110px; }
  .s-grid { grid-template-columns: 1fr; }
}
</style>
