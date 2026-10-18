#!/usr/bin/env node
/**
 * Build the presentation deck out of docs/<n>_*.md.
 *
 * Why a script: Marp CLI refuses `-o` with several input files (it would write
 * one deck per file), and `docs/*.md` sorted lexicographically puts
 * `10_sw_demo.md` before `1_project_idea.md`. So the files are concatenated in
 * numeric order into docs/.deck.md first, then converted once.
 *
 * Consequences for the slide files:
 *   - docs/0_index.md front-matter is at the start of the merged document, so
 *     it configures the whole deck (marp/theme/title/language). Keep it first.
 *   - per-slide settings go into HTML comments (`<!-- class: agenda -->`) or a
 *     front-matter block after a `---` separator; both are page-scoped.
 *   - asset paths are relative to docs/ (e.g. `assets/keyboard.png`).
 *
 * Usage:
 *   node docs/build.mjs                 -> docs/dist/deck.html
 *   node docs/build.mjs pdf             -> docs/dist/deck.pdf
 *   node docs/build.mjs html pdf pptx   -> all of them
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const docsDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.dirname(docsDir)
const theme = 'docs/theme/keeb.css'
const merged = path.join(docsDir, '.deck.md')
const dist = path.join(docsDir, 'dist')

const formats = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const wanted = formats.length ? formats : ['html']
for (const f of wanted) {
  if (!['html', 'pdf', 'pptx', 'png'].includes(f)) {
    console.error(`unsupported format: ${f} (html | pdf | pptx | png)`)
    process.exit(2)
  }
}

const files = readdirSync(docsDir)
  .filter((f) => /^\d+_.+\.md$/.test(f))
  .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
  .map((f) => path.join(docsDir, f))

if (!files.length) {
  console.error('no slide files found (expected docs/<n>_*.md)')
  process.exit(1)
}

console.log(`deck: ${files.map((f) => path.basename(f)).join(' ')}`)

// .deck.md lives in docs/ so that `assets/...` paths keep resolving.
writeFileSync(merged, files.map((f) => readFileSync(f, 'utf8').trimEnd()).join('\n\n---\n\n') + '\n')

mkdirSync(dist, { recursive: true })

const marp = path.join(root, 'node_modules', '.bin', 'marp')
for (const fmt of wanted) {
  const target = path.join(dist, `deck.${fmt === 'png' ? 'png' : fmt}`)
  const res = spawnSync(
    marp,
    [
      path.relative(root, merged),
      '--theme-set',
      theme,
      '--allow-local-files', // needed for docs/assets/*, otherwise Marp blocks them
      '-o',
      target,
    ],
    { cwd: root, stdio: 'inherit' },
  )
  if (res.status !== 0) process.exit(res.status ?? 1)
  console.log(`  -> ${path.relative(root, target)}`)
}
