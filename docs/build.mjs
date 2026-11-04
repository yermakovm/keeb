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
 *   node docs/build.mjs preview         -> Marp preview window of the whole deck
 *
 * `preview` also watches docs/<n>_*.md and re-merges .deck.md on change, so
 * editing a source slide reloads the preview window (Marp itself only watches
 * the merged file).
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, cpSync, watch } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const docsDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.dirname(docsDir)
const theme = 'docs/theme/keeb.css'
const merged = path.join(docsDir, '.deck.md')
const dist = path.join(docsDir, 'dist')

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const preview = args.includes('preview')
const wanted = args.filter((a) => a !== 'preview')
if (!preview && !wanted.length) wanted.push('html')
for (const f of wanted) {
  if (!['html', 'pdf', 'pptx', 'png'].includes(f)) {
    console.error(`unsupported format: ${f} (html | pdf | pptx | png)`)
    process.exit(2)
  }
}

const files = readdirSync(docsDir)
  .filter((f) => /^\d+_.+\.md$/.test(f))
  // parseInt gives every `8_*` the same key, so ties fall back to readdir
  // order (filesystem-dependent). Tie-break on the name to keep deck order fixed.
  .sort((a, b) =>
    Number.parseInt(a, 10) - Number.parseInt(b, 10) ||
    path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true }),
  )
  .map((f) => path.join(docsDir, f))

if (!files.length) {
  console.error('no slide files found (expected docs/<n>_*.md)')
  process.exit(1)
}

console.log(`deck: ${files.map((f) => path.basename(f)).join(' ')}`)

// .deck.md lives in docs/ so that `assets/...` paths keep resolving.
const merge = () =>
  writeFileSync(merged, files.map((f) => readFileSync(f, 'utf8').trimEnd()).join('\n\n---\n\n') + '\n')
merge()

const marp = path.join(root, 'node_modules', '.bin', 'marp')

if (preview) {
  const child = spawn(
    marp,
    [
      path.relative(root, merged),
      '--theme-set',
      theme,
      '--allow-local-files',
      '--html', // raw HTML: <iframe> for the video slide, inline style for the poster
      '--preview',
    ],
    { cwd: root, stdio: 'inherit' },
  )

  // Marp watches .deck.md, not the sources: re-merge so the preview reloads.
  let timer = null
  const watcher = watch(docsDir, (_event, name) => {
    if (!name || !/^\d+_.+\.md$/.test(name)) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      merge()
      console.log(`  re-merged after ${name}`)
    }, 150)
  })

  child.on('exit', (code, signal) => {
    watcher.close()
    process.exit(signal ? 0 : (code ?? 0))
  })
  for (const sig of ['SIGINT', 'SIGTERM'])
    process.on(sig, () => {
      watcher.close()
      child.kill(sig)
    })
} else {
  mkdirSync(dist, { recursive: true })
  // deck.html inlines the theme CSS and keeps `assets/...` srcs relative to docs/dist,
  // so the placeholder images (and assets/fonts.woff2) only resolve once copied here.
  cpSync(path.join(docsDir, 'assets'), path.join(dist, 'assets'), { recursive: true })
  for (const fmt of wanted) {
    const target = path.join(dist, `deck.${fmt === 'png' ? 'png' : fmt}`)
    const res = spawnSync(
      marp,
      [
        path.relative(root, merged),
        '--theme-set',
        theme,
        '--allow-local-files', // needed for docs/assets/*, otherwise Marp blocks them
        '--html', // raw HTML: <iframe> for the video slide, inline style for the poster
        '-o',
        target,
      ],
      { cwd: root, stdio: 'inherit' },
    )
    if (res.status !== 0) process.exit(res.status ?? 1)
    console.log(`  -> ${path.relative(root, target)}`)
  }
}
