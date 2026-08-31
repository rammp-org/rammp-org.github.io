import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { siblingRepoDir, copyDocs, linkDocs } from '../scripts/compose.mjs'

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'compose-'))
  const docs = path.join(root, 'repo', 'docs')
  await mkdir(path.join(docs, 'superpowers', 'specs'), { recursive: true })
  await mkdir(path.join(docs, 'guides'), { recursive: true })
  await writeFile(path.join(docs, 'index.mdx'), '# Index\n')
  await writeFile(path.join(docs, 'guides', 'one.mdx'), '# One\n')
  await writeFile(path.join(docs, 'superpowers', 'specs', 'a.md'), '# Spec\n')
  return { root, docs, target: path.join(root, 'out') }
}

test('copyDocs copies the tree and skips excluded directories', async () => {
  const { docs, target } = await fixture()
  await copyDocs(docs, target, ['superpowers'])
  assert.deepEqual((await readdir(target)).sort(), ['guides', 'index.mdx'])
  assert.equal(await readFile(path.join(target, 'guides', 'one.mdx'), 'utf8'), '# One\n')
})

test('copyDocs clears content removed from the source', async () => {
  const { docs, target } = await fixture()
  await mkdir(target, { recursive: true })
  await writeFile(path.join(target, 'stale.mdx'), '# Stale\n')
  await copyDocs(docs, target, ['superpowers'])
  assert.ok(!(await readdir(target)).includes('stale.mdx'))
})

test('linkDocs symlinks entries rather than copying them', async () => {
  const { docs, target } = await fixture()
  await linkDocs(docs, target, ['superpowers'])
  // Markdown files are copied to avoid symlink resolution issues in Turbopack,
  // but directories are symlinked
  const indexStat = await lstat(path.join(target, 'index.mdx'))
  assert.ok(!indexStat.isSymbolicLink(), 'markdown files should be copied')
  const guidesStat = await lstat(path.join(target, 'guides'))
  assert.ok(guidesStat.isSymbolicLink(), 'directories should be symlinked')
  assert.deepEqual((await readdir(target)).sort(), ['guides', 'index.mdx'])
})

test('siblingRepoDir finds a checkout beside the hub, or returns null', async () => {
  const { root } = await fixture()
  const hub = path.join(root, 'hub')
  await mkdir(hub, { recursive: true })
  const source = { repo: 'rammp-org/repo' }
  assert.equal(siblingRepoDir(hub, source), path.join(root, 'repo'))
  assert.equal(siblingRepoDir(hub, { repo: 'rammp-org/absent' }), null)
})
