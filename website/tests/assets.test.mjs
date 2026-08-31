import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { copyAssets } from '../scripts/compose.mjs'

test('copies declared assets into public/<slug>/', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'assets-'))
  const repo = path.join(root, 'repo')
  await mkdir(repo, { recursive: true })
  await writeFile(path.join(repo, 'install.sh'), '#!/bin/sh\necho hi\n')
  const publicDir = path.join(root, 'public')

  await copyAssets(repo, { slug: 'sheppy', assets: ['install.sh'] }, publicDir)

  const copied = await readFile(path.join(publicDir, 'sheppy', 'install.sh'), 'utf8')
  assert.equal(copied, '#!/bin/sh\necho hi\n')
})

test('fails loudly when a declared asset is missing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'assets-'))
  const repo = path.join(root, 'repo')
  await mkdir(repo, { recursive: true })
  await assert.rejects(
    () => copyAssets(repo, { slug: 'sheppy', assets: ['install.sh'] }, path.join(root, 'public')),
    /install\.sh/
  )
})

test('does nothing when no assets are declared', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'assets-'))
  const repo = path.join(root, 'repo')
  await mkdir(repo, { recursive: true })
  await assert.doesNotReject(
    () => copyAssets(repo, { slug: 'dojo', assets: [] }, path.join(root, 'public'))
  )
})
