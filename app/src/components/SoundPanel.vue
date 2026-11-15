<script setup lang="ts">
/*
 * Sound: what the buzzer plays, and which event plays it.
 *
 * Two questions, two cards. "Events" is the selection — one sound per thing the
 * keyboard does by itself. "Sounds" is the shape of each sound, edited as a
 * short list of (pitch, on, gap) steps. Every step is a percentage of the build's
 * base pitch, so the same shape fits another piezo.
 *
 * Apply lands in RAM and takes effect on the next press; Save is the same flash
 * write the settings page uses. The ▶ buttons apply that one sound first and
 * then play it, so a preview is what you see, not what was last saved.
 */
import { computed, ref } from 'vue'

import { TUNE_NAMES, useSoundStore } from '../stores/sound.ts'

const s = useSoundStore()
const moreOpen = ref(false)
const playing = ref<number | null>(null)

const names = TUNE_NAMES
const dirty = computed(() => s.dirty)
const problems = computed(() => s.problems)
const savedAt = computed(() => s.savedAt)
const label = (name: string): string => name.replace(/_/g, ' ')

async function hear(tune: number): Promise<void> {
  playing.value = tune
  const r = await s.preview(tune)

  playing.value = null

  if (!r.ok) {
    s.lastError = r.reason ?? 'preview failed'
  }
}

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
  <section class="sound">
    <div class="s-head">
      <span class="s-title">Sound</span>
      <span class="s-status">{{ s.statusLine }}</span>
      <button class="s-reload" title="read the sounds back from the keyboard" :disabled="!s.loaded" @click="s.reload()">
        Reload
      </button>
    </div>

    <p v-if="!s.supported" class="s-note">
      This build does not expose the sound channel, so there is nothing here to edit. Rebuild with
      <code>CONFIG_KEEB_SOUND=y</code> to get it.
    </p>

    <template v-else>
      <div class="s-card">
        <h3 class="s-cat">what plays for each event</h3>
        <div class="s-rows">
          <div v-for="row in s.eventRows" :key="row.row.event" class="s-row">
            <span class="s-key">
              {{ row.row.label }}
              <small>{{ row.row.note }}</small>
            </span>

            <div class="s-val">
              <div class="pick">
                <select
                  class="field"
                  :value="row.tune"
                  :disabled="!s.canWrite"
                  :aria-label="`sound for ${row.row.label}`"
                  @change="s.setEvent(row.row.event, Number(($event.target as HTMLSelectElement).value))"
                >
                  <option v-for="(name, id) in names" :key="name" :value="id">{{ label(name) }}</option>
                </select>

                <button
                  class="play"
                  :disabled="!s.canWrite || playing !== null"
                  :title="`play the sound mapped to ${row.row.label}`"
                  :aria-label="`play the sound mapped to ${row.row.label}`"
                  @click="hear(row.tune)"
                >▶</button>
              </div>

              <span class="s-hint">
                <template v-if="row.changed">changed · apply to hear it for real</template>
                <template v-else>keyboard: {{ label(names[row.tune] ?? 'random') }}</template>
              </span>
            </div>
          </div>
        </div>

        <h3 class="s-cat">the sounds</h3>

        <p class="s-note tight">
          pitch is a percentage of the build's base pitch; on/gap are milliseconds. The last step's
          gap is not played.
        </p>

        <div class="tunes">
          <div v-for="card in s.tuneCards" :key="card.id" class="tune">
            <div class="tune-head">
              <span class="tune-name">{{ label(card.name) }}</span>
              <span v-if="card.changed" class="tune-mark">edited</span>

              <button
                class="play"
                :disabled="!s.canWrite || playing !== null"
                :title="`play ${label(card.name)}`"
                :aria-label="`play ${label(card.name)}`"
                @click="hear(card.id)"
              >▶</button>
            </div>

            <p v-if="!card.editable" class="s-hint">generated per press: a fresh rhythm and pitch every time</p>

            <template v-else>
              <div v-for="(step, i) in card.steps" :key="i" class="step">
                <label class="step-field">
                  <small>pitch %</small>
                  <input
                    class="field"
                    type="number"
                    inputmode="numeric"
                    min="50"
                    max="400"
                    step="5"
                    :value="step.pitchPct"
                    :disabled="!s.canWrite"
                    :aria-label="`${label(card.name)} step ${i + 1} pitch percent`"
                    @input="s.setStep(card.id, i, 'pitchPct', ($event.target as HTMLInputElement).value)"
                  />
                </label>

                <label class="step-field">
                  <small>on ms</small>
                  <input
                    class="field"
                    type="number"
                    inputmode="numeric"
                    min="10"
                    max="1000"
                    step="5"
                    :value="step.onMs"
                    :disabled="!s.canWrite"
                    :aria-label="`${label(card.name)} step ${i + 1} on time`"
                    @input="s.setStep(card.id, i, 'onMs', ($event.target as HTMLInputElement).value)"
                  />
                </label>

                <label class="step-field">
                  <small>gap ms</small>
                  <input
                    class="field"
                    type="number"
                    inputmode="numeric"
                    min="0"
                    max="1000"
                    step="5"
                    :value="step.gapMs"
                    :disabled="!s.canWrite || i === card.steps.length - 1"
                    :title="i === card.steps.length - 1 ? 'the trailing gap is not played' : 'silence before the next step'"
                    :aria-label="`${label(card.name)} step ${i + 1} gap`"
                    @input="s.setStep(card.id, i, 'gapMs', ($event.target as HTMLInputElement).value)"
                  />
                </label>

                <button
                  class="step-del"
                  :disabled="!s.canWrite || !card.canRemove"
                  title="remove this step"
                  :aria-label="`remove ${label(card.name)} step ${i + 1}`"
                  @click="s.removeStep(card.id, i)"
                >×</button>
              </div>

              <button class="step-add" :disabled="!s.canWrite || !card.canAdd" @click="s.addStep(card.id)">
                + Step
              </button>
            </template>
          </div>
        </div>
      </div>

      <p v-if="problems.length" class="s-note bad">{{ problems[0] }}</p>
      <p v-else-if="s.lastError" class="s-note bad">{{ s.lastError }}</p>
      <p v-else-if="savedAt" class="s-note">saved to the keyboard's settings storage at {{ savedAt }}</p>
    </template>

    <div v-if="s.supported" class="dock-s">
      <div class="bar">
        <button
          class="go-apply"
          :disabled="!dirty || !s.canWrite || s.loading || problems.length > 0"
          title="send the sounds to the keyboard: they take effect from the next press and last until it is reflashed"
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
            <button title="persist what the keyboard is running on, so it survives a reboot" :disabled="dirty" @click="save">
              Save to flash
            </button>
            <button title="put the compiled-in sounds back and delete the saved copy" @click="discard">
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
.sound {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding-top: 116px;
  padding-bottom: 140px;
  overflow: auto;
}

/* Two thirds of the stage: the rows are short, and a narrower column keeps the
 * event table and the steps on one screen without hunting across the page. */
.s-head,
.s-card,
.s-note {
  width: min(66%, 100%);
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

/* One section for the whole page: the event table first, the sounds it can play
 * under it. Full page width, because a step is three numbers and a remove button;
 * the width itself stays in the shared min(1000px) rule above so the card, the
 * head and the notes line up. */
.s-card {
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--panel-raised);
  padding: 6px 0;
}

.s-cat + .s-cat,
.s-rows + .s-cat {
  margin-top: 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
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
  min-width: 190px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.pick {
  display: flex;
  gap: 6px;
  width: 100%;
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

.play {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: transparent;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
}

.play:hover:not(:disabled) { color: var(--ink); border-color: var(--ink); }
.play:disabled { opacity: 0.45; cursor: default; }

.s-hint {
  font-size: 11px;
  color: var(--mid);
}

.s-hint.bad { color: var(--warn); }

.s-note {
  padding: 10px 16px 4px;
  font-size: 12px;
  color: var(--mid);
}

.s-note.tight { padding: 0 16px 8px; }
.s-note.bad { color: var(--warn); }
.s-note code { color: var(--ink); }

.tunes {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 16px 12px;
}

.tune {
  padding: 10px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.tune:last-child { border-bottom: 0; }

.tune-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tune-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
}

.tune-mark {
  font-size: 11px;
  color: var(--accent);
}

.tune-head .play { margin-left: auto; }

.step {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  margin-top: 6px;
}

.step-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1 1 auto;
  min-width: 0;
}

.step-field small {
  font-size: 10px;
  color: var(--mid);
}

.step-field .field { padding: 5px 8px; }

.step-del,
.step-add {
  border: 1px solid var(--line);
  border-radius: 10px;
  background: transparent;
  color: var(--mid);
  font: inherit;
  cursor: pointer;
}

.step-del { width: 30px; height: 32px; }
.step-add { margin-top: 8px; padding: 6px 12px; font-size: 12px; }

.step-del:hover:not(:disabled),
.step-add:hover:not(:disabled) { color: var(--ink); border-color: var(--ink); }
.step-del:disabled,
.step-add:disabled { opacity: 0.4; cursor: default; }

/* The bottom dock, same shape as the settings page. */
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

.more-wrap { position: relative; }

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

@media (max-width: 900px) {
  .sound { padding-top: 0; padding-bottom: 110px; }
  .s-head,
  .s-card,
  .s-note { width: 100%; }
}
</style>
