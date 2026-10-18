# keeb configurator (web UI)

Vue 3 + Vite + Pinia web configurator for the split keyboard, styled after the
ZSA Oryx configurator (dark theme, color-coded caps, per-layer overrides).

## Run

```sh
cd app
npm install
npm run dev      # http://localhost:5173
npm run build    # production bundle in app/dist (gitignored)
```

## What it does

- Renders the configurable matrix: `split` (true/false), `rows`, `cols`
  (per half), live key count.
- Layer tabs (rename the edited layer inline, add/remove via the Layers field).
- Click any cap → picker menu with ZMK key/behavior groups
  (letters, numbers, symbols, modifiers, navigation, function, media, keypad,
  mouse `&mkp`/`&mmv`/`&msc`, layer behaviors `&mo`/`&to`, hold/tap `&lt`/HML/HMR).
- Override model (Oryx-style): each layer stores only the cells it overrides;
  resolution walks down to layer 0. Ringed caps = override on the edited
  layer, dimmed = inherited, dashed = matrix cell not wired.
- **JSON** button dumps the full state — this is the payload that will later be
  encoded to TLV and pushed to the keyboard over BLE.
- State persists to `localStorage` (same JSON shape as the future TLV source).

## Mock / reference data

`src/data/mock.js` is modeled on `../config/keeb.keymap`:
split=true, 6×6 per half, 5 layers (HOME, NAV, FUN, MOUSE, MEDIA).
Matrix rows: 0–3 alpha, row 4 = extra keys (local cols 2–3), row 5 = thumb
(cols 0–3); the other cells are marked unwired. Keycode names are verified
against the pinned ZMK checkout at `../zmk` (`../zmk/app/include/dt-bindings/zmk/`).

## State shape (future TLV payload)

```json
{
  "config": { "split": true, "rows": 6, "cols": 6, "layers": [{ "name": "HOME", "color": "…" }] },
  "bindings": [ { "L.0.0": { "kind": "key", "code": "PLUS" }, "L.2.1": { "kind": "hml", "tap": "A", "hold": "LGUI" }, … } ]
}
```

Cell keys: `${side}.${row}.${col}`, side `L`/`R`; both halves render cols
left→right, LEFT col 5 and RIGHT col 0 face the split gap.

## Next steps

- TLV encoder module + Web Bluetooth transport (replace localStorage sink).
- Keymap export back to `.keymap` DTS text.
- Combos/conditional bindings editing (keymap currently defines several).
