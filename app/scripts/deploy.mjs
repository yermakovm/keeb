#!/usr/bin/env node
/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Ship the built configurator to the home server (nginx on the Arch box).
 *
 * Why a script and not a bare rsync line in package.json: the failure mode we
 * actually hit is not a broken transfer, it is uploading the wrong thing. A
 * stale dist/ uploads cleanly and serves yesterday's UI. An empty dist/
 * uploads cleanly and serves a 404. A trailing slash in the wrong place
 * uploads dist/ *inside* dist/ and serves nothing at all. So the
 * preconditions are checked here, and a dry run is one flag away.
 *
 * rsync over SSH, not FTP: credentials and payload stay inside the SSH
 * session you already have, and nothing new has to listen on the box.
 *
 * --delete is deliberate: Vite emits content-hashed asset names, so every
 * build leaves the previous bundle behind. Without it the served directory
 * only ever grows. It is also why --dry-run exists.
 *
 * Usage:
 *   npm run upload                    build, then sync dist/ -> target
 *   npm run upload:dry                same, but writes nothing (shows diff)
 *   npm run upload -- --no-build      sync the dist/ you already have
 *   npm run upload -- --no-delete     keep server files absent from dist/
 *   npm run upload -- --no-chmod      skip the world-readable permission pass
 *
 * Target comes from TARGET below; environment variables win:
 *   DEPLOY_USER=... DEPLOY_HOST=... DEPLOY_PATH=... npm run upload
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The home server: nginx serves this directory as its site root.
// Directory ownership is `admin`, so the sync user must be `admin` too.
const TARGET = {
  user: process.env.DEPLOY_USER ?? 'admin',
  host: process.env.DEPLOY_HOST ?? '192.168.1.150',
  path: (process.env.DEPLOY_PATH ?? '/srv/http/keeb').replace(/\/?$/, '/'),
}

const argv = process.argv.slice(2)
const has = (...flags) => flags.some((flag) => argv.includes(flag))

if (has('--help', '-h')) {
  console.log(`usage: npm run upload -- [flags]

  --dry-run, -n   show what would change, write nothing
  --no-build      skip vite build, sync the existing dist/
  --no-delete     keep server files that are not in dist/
  --no-chmod      skip the chmod pass that keeps files readable by nginx
  --help, -h      this message

target: ${TARGET.user}@${TARGET.host}:${TARGET.path}
override with DEPLOY_USER / DEPLOY_HOST / DEPLOY_PATH`)
  process.exit(0)
}

const dryRun = has('--dry-run', '-n')

function fail(message, hint) {
  console.error(`deploy: ${message}`)
  if (hint) console.error(`  hint: ${hint}`)
  process.exit(1)
}

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path))
    else out.push(path)
  }
  return out
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: appRoot, stdio: 'inherit' })
  if (r.error) fail(`${cmd} could not be started: ${r.error.message}`)
  if (r.status !== 0) fail(`${cmd} exited with status ${r.status}`)
}

// 1. Build, unless told the current dist/ is already the artifact we want.
if (!has('--no-build')) {
  run('npm', ['run', 'build'])
}

// 2. A build can exit 0 and still produce nothing worth serving.
const distDir = join(appRoot, 'dist')
const indexHtml = join(distDir, 'index.html')
if (!existsSync(indexHtml)) {
  fail(`no dist/index.html`, 'run `npm run build` first, or pass --no-build only if dist/ exists')
}

// Count everything but index.html. A real build emits a bundle next to the
// page; a page alone means the build went wrong somewhere.
const files = walk(distDir).filter((f) => f !== indexHtml)
if (files.length === 0) {
  fail('dist/ holds index.html and nothing else', 'the build produced no bundle; refusing to overwrite a working site')
}

// Base-path check: a build made with vite's `base` set for a subpath 404s when
// it is deployed at the domain root, and the reverse. Only bundled asset
// references are inspected, so a hand-written /favicon.ico is not a failure.
const html = readFileSync(indexHtml, 'utf8')
const assetRefs = [...html.matchAll(/(?:src|href)="(\/[^"]*assets\/[^"]*)"/g)].map((m) => m[1])
const offRoot = assetRefs.filter((ref) => !ref.startsWith('/assets/'))
if (assetRefs.length > 0 && offRoot.length === assetRefs.length) {
  fail(
    `bundled assets are referenced under a subpath: ${offRoot.slice(0, 2).join(', ')}`,
    'nginx serves this site at the domain root — set `base: "/"` in vite.config.ts, or serve dist under that subpath',
  )
}

// 3. Preflight the far side. rsync needs a peer binary inside the SSH
//    session; when it is absent the failure is reported as "connection
//    unexpectedly closed / error in rsync protocol data stream", which reads
//    like a network fault and is not one. A missing site root is checked in
//    the same round trip: rsync would create it, and nginx would still not
//    serve it.
const siteRoot = TARGET.path.replace(/\/$/, '')
const targetRef = `${TARGET.user}@${TARGET.host}`

const probe = `command -v rsync >/dev/null 2>&1 || exit 10; test -d '${siteRoot}' || exit 11`
const check = spawnSync('ssh', [targetRef, probe], { encoding: 'utf8' })
if (check.status === 10) {
  fail('rsync is not installed on the server', `ssh ${targetRef} 'sudo pacman -S rsync'`)
}
if (check.status === 11) {
  fail(`site root ${siteRoot} does not exist on the server`, 'create it, and confirm nginx\'s `root` directive points there')
}
if (check.status !== 0) {
  fail(`ssh to ${targetRef} failed (status ${check.status})`, check.stderr?.trim() || 'no output from ssh')
}

// 4. Trailing slash on the source is the whole contract: "the contents of
//    dist/", not "a folder called dist inside the target".
const remote = `${targetRef}:${TARGET.path}`
const rsyncArgs = ['-a', '-i', '--stats']
if (dryRun) rsyncArgs.push('-n')
if (!has('--no-delete')) rsyncArgs.push('--delete')
rsyncArgs.push('--', `${distDir}/`, remote) // `--` so a path is never parsed as a flag

console.log(`\ndeploy: ${distDir}/ -> ${remote}${dryRun ? '  (dry run: nothing written)' : ''}`)
run('rsync', rsyncArgs)

// 5. nginx on Arch runs as `http`. Whatever umask the build ran under, the
//    served tree must be world-readable, or nginx answers 403 on directories.
//    --chmod is unreliable on macOS openrsync, so this is done on the server.
if (!has('--no-chmod')) {
  const remoteCmd = `chmod -R u+rwX,go+rX '${siteRoot}'`
  if (dryRun) {
    console.log(`\nwould run: ssh ${targetRef} ${remoteCmd}`)
  } else {
    run('ssh', [targetRef, remoteCmd])
  }
}

console.log(`\ncheck it: http://${TARGET.host}/   (from another device, not from the server itself)`)
if (dryRun) console.log('dry run complete: re-run without --dry-run to upload')
