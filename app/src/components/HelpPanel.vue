<script setup lang="ts">
/*
 * Hints, off the main view.
 *
 * The legend and the protocol explanations are reference material: useful when
 * something looks wrong, noise while editing. So they live behind one "?" button
 * instead of sitting under the keyboard, and they are written once here rather
 * than split between the page and the device panel.
 *
 * It is a static panel - no store, no requests - so it renders with no keyboard
 * attached, which is when a person most often needs it.
 */
import { RESERVED_POSITIONS, REVERT_HOLD_MS } from '../proto/zmk.gen.ts'

defineProps<{ open: boolean }>()

const emit = defineEmits<{ (e: 'close'): void }>()
</script>

<template>
  <div v-if="open" class="overlay" @click.self="emit('close')">
    <div class="help">
      <div class="head">
        <h2>How this configurator works</h2>
        <button class="chip" @click="emit('close')">Close</button>
      </div>

      <section>
        <h3>The grid</h3>
        <ul>
          <li><b>Ring</b> — this layer defines the cell itself.</li>
          <li><b>Dimmed + dot</b> — inherited through <code>&amp;trans</code> from a lower layer.</li>
          <li><b>Double border 🔒</b> — reserved position, never writable.</li>
          <li><b>Dashed</b> — grid slot with no key position (no switch there).</li>
          <li><b>Diagonal caps</b> — hold/tap: hold reads the top-right cap, tap the bottom-left.</li>
          <li>
            Caps sit where the matrix transform maps them: left half columns 0–5 outer edge →
            split gap, right half 6–11 split gap → outer edge. Sorting a half by column number
            would flip the right hand.
          </li>
        </ul>
      </section>

      <section>
        <h3>Layers</h3>
        <ul>
          <li>
            A layer <b>slot</b> and a layer <b>id</b> are different things. Reorder, add and
            remove move slots (<code>order[slot] = id</code>); the cells and the MO/LT bindings
            belong to the id. A tab shows both.
          </li>
          <li><b>●</b> on a tab — that layer is live on the keyboard right now.</li>
          <li>
            Layer behaviors take a layer <b>id</b>, not a name. The picker shows names and sends
            ids; <code>&amp;mo HOME</code> in a <code>.keymap</code> file compiles and silently
            does nothing.
          </li>
          <li>An empty slot is a slot with no layer, not a layer with no keys.</li>
        </ul>
      </section>

      <section>
        <h3>Screens and testing</h3>
        <ul>
          <li>
            <b>screen 1 / screen 2</b> in the split are the status panels, drawn where the glass
            is. Clicking one puts its widget table under the board and its properties in the
            sidebar — the same two surfaces a key uses.
          </li>
          <li>
            The <b>tester</b> draws the same board and inverts the switches the keyboard reports
            closed. Reporting is asked for with <code>TEST_SET</code> and given back when the view
            closes, so a keyboard is never left streaming keystrokes.
          </li>
          <li>
            On the simulated keyboard, clicking a cap in the tester presses its switch for a
            moment through the same path real hardware uses.
          </li>
        </ul>
      </section>

      <section>
        <h3>Editing, applying, saving</h3>
        <ul>
          <li>
            Clicking a cap selects it — the cap inverts — and the keycode palette under the board
            is where it gets its key: choose a category and every group in it is drawn with its
            keys; the search field narrows that list as you type
            (<code>&amp;kp / &amp;kt / &amp;sk</code> is chosen by which one you click). The sidebar
            holds the rest: <code>&amp;trans</code>, <code>&amp;none</code>, <b>unstage</b>,
            and one <code>&amp;mo</code> chip per layer slot. Every one of
            them only <b>stages</b> the binding (green corner dot). Nothing leaves the browser
            until <b>Apply changes</b>.
          </li>
          <li>
            <b>advanced binding</b> is the group in that same column for the bindings with more
            than one argument: hold/tap, mouse, BT and output. It opens like the
            <b>state</b> and <b>session</b> groups do. <b>unstage</b> drops one cell's staged
            binding and asks the keyboard what it has at that position again.
          </li>
          <li>
            <b>Apply changes</b> sends one <code>CELLS_SET</code> per dirty layer. The firmware
            validates the whole record before applying any of it, so a rejected layer changes
            nothing and its edits stay staged.
          </li>
          <li>
            <b>Revert</b> throws the staged edits away. The keyboard was never asked to change,
            so this is a reload, not an undo over the wire.
          </li>
          <li>
            Applying and persisting are two firmware operations: <code>CELLS_SET</code> changes
            the live keymap, <code>SAVE</code> writes it into the keyboard's settings.
            <b>Autosave</b> (on by default, remembered per browser) sends that SAVE after every
            applied write — cell writes and layer renames, moves, adds and removes alike. With
            it off, the panel says how many changes are live but unsaved.
          </li>
          <li>
            Once a change is saved, <b>Discard</b> returns to the saved overlay rather than the
            keymap file. <b>Reset settings</b> is what clears the overlay and gets back to the
            keymap the firmware was flashed with.
          </li>
        </ul>
      </section>

      <section>
        <h3>When something goes wrong</h3>
        <ul>
          <li>
            <b>Escape hatch on the keyboard.</b> Reserved positions
            {{ RESERVED_POSITIONS.join(', ') }} can never be rebound, so holding all of them for
            {{ REVERT_HOLD_MS / 1000 }}s discards unsaved changes even after a layout that made
            those keys useless. It runs the same operation as <b>Discard</b>, so it does not
            clear a saved layout.
          </li>
          <li>
            <b>Token table mismatch.</b> The hash proves the keyboard's behavior table and this
            build's table differ, not which side is stale. If <code>keeb.dtsi</code> changed
            since this keyboard was flashed, run <code>npm run gen</code>. If it did not, the
            keyboard is running an older image — rebuild and reflash the central half.
          </li>
          <li>
            <b>Only the central (left) half answers the channel.</b> The peripheral's one BLE
            link is the split connection, so connecting to the right half fails at the GATT
            stage.
          </li>
          <li>
            <b>The keyboard must be advertising.</b> ZMK stops advertising while its active
            profile is connected — press <b>BT_SEL</b> on an open profile, or <b>BT_CLR</b> to
            clear one. The chooser filters on the advertised name from
            <code>config/keeb.conf</code>.
          </li>
          <li>
            <b>After the keyboard was reset</b> (BT_CLR, cleared bonds, a reflash) Chrome still
            holds a grant the keyboard no longer recognises: the link opens and then the write
            characteristic refuses it. <b>Forget device</b>, then <b>Connect</b> again. On macOS
            also forget the keyboard in Bluetooth settings — the browser cannot revoke that.
          </li>
          <li>
            <b>TLV traffic is logged</b> to the browser console with the prefix
            <code>keeb tlv</code>: one line per message sent, per ACK, and per notification.
            Silence it with <code>localStorage.setItem('keeb.debug', '0')</code>.
          </li>
        </ul>
      </section>

      <p class="foot">Close — Esc, or click outside the panel.</p>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed; inset: 0; z-index: 70; background: rgba(0, 0, 0, 0.62);
  display: flex; align-items: center; justify-content: center;
}

.help {
  width: min(760px, 92vw); max-height: 84vh; overflow: auto;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 0;
  padding: 16px 18px; display: flex; flex-direction: column; gap: 14px;
}

.head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
h2 { margin: 0; font-size: 15px; }
h3 { margin: 0 0 4px; font-size: 12px; color: var(--ink); letter-spacing: 0.5px; text-transform: uppercase; }

section { display: flex; flex-direction: column; }
ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 5px; }
li { font-size: 12px; color: var(--text-dim); }
li b { color: var(--text); }
code { font-family: var(--mono); font-size: 11.5px; color: var(--text-dim); }

.chip {
  padding: 5px 10px; font-size: 12px;
  border: 1px solid var(--border); border-radius: 0;
  background: var(--bg-raised); color: var(--text-dim); cursor: pointer;
}
.chip:hover { border-color: var(--ink); color: var(--ink); }

.foot { margin: 0; font-size: 11px; color: var(--text-faint); }
</style>
