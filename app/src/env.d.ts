/*
 * Ambient types for the app.
 *
 * *.vue imports need a declaration when the project is type-checked without
 * Vite's own plugin running (vue-tsc handles SFCs itself, but imports from
 * plain .ts files still need the module shape).
 */

/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
