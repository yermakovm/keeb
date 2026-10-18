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

createApp(App).use(createPinia()).mount('#app')
