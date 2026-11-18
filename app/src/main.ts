import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import { MISSING_CATALOG_NAMES } from './data/keycodes.ts'
import './styles/theme.css'

/* The picker catalog is hand-curated on purpose, but the codes are not: if a
 * name in it is not in ZMK's dt-bindings, that is drift, and it should be loud
 * at load time rather than a cap that silently renders keycode 0. */
if (MISSING_CATALOG_NAMES.length) {
  console.warn('[keeb] catalog names missing from the generated ZMK table:', MISSING_CATALOG_NAMES.join(', '))
}

/* /demo is the hardware-free page: the same shell, the same codec and the same
 * stores, driven by the simulated keyboard. The demo entry says so on the mount
 * point; the path is the fallback for a host that answers /demo with the root
 * page instead of redirecting to /demo/. */
const demo =
  document.getElementById('app')?.dataset.mode === 'demo' || /^\/demo\/?$/.test(location.pathname)

createApp(App, { demo }).use(createPinia()).mount('#app')
