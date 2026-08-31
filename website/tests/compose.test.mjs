import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { siblingRepoDir, copyDocs, assertSlugsDontCollideWithHubPages } from '../scripts/compose.mjs'

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

async function excludeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'compose-exclude-'))
  const docs = path.join(root, 'repo', 'docs')
  await mkdir(path.join(docs, 'Superpowers'), { recursive: true })
  await mkdir(path.join(docs, 'guides', 'superpowers'), { recursive: true })
  await writeFile(path.join(docs, 'index.mdx'), '# Index\n')
  await writeFile(path.join(docs, 'Superpowers', 'x.md'), '# X\n')
  await writeFile(path.join(docs, 'guides', 'AGENTS.md'), '# Agents\n')
  await writeFile(path.join(docs, 'guides', 'superpowers', 'secret.md'), '# Secret\n')
  return { root, docs, target: path.join(root, 'out') }
}

test('copyDocs excludes a nested file matched by its full relative path', async () => {
  const { docs, target } = await excludeFixture()
  await copyDocs(docs, target, ['guides/AGENTS.md'])
  const guidesFiles = await readdir(path.join(target, 'guides'), { recursive: true })
  assert.ok(!guidesFiles.includes('AGENTS.md'))
})

test('copyDocs excludes a nested directory matched by its full relative path', async () => {
  const { docs, target } = await excludeFixture()
  await copyDocs(docs, target, ['guides/superpowers'])
  const guidesFiles = await readdir(path.join(target, 'guides'), { recursive: true })
  assert.ok(!guidesFiles.some(f => f.includes('secret.md')))
})

test('copyDocs matches exclude patterns case-insensitively', async () => {
  const { docs, target } = await excludeFixture()
  await copyDocs(docs, target, ['superpowers'])
  assert.ok(!(await readdir(target)).includes('Superpowers'))
})

test('copyDocs throws when a declared exclude pattern matches nothing', async () => {
  const { docs, target } = await excludeFixture()
  await assert.rejects(
    () => copyDocs(docs, target, ['does-not-exist']),
    /does-not-exist/
  )
})

test('assertSlugsDontCollideWithHubPages throws when a slug names an existing hub .mdx page', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'compose-collide-'))
  const contentDir = path.join(root, 'content')
  await mkdir(contentDir, { recursive: true })
  await writeFile(path.join(contentDir, 'platform.mdx'), '# Platform\n')
  assert.throws(
    () => assertSlugsDontCollideWithHubPages([{ slug: 'platform' }], contentDir),
    /platform/
  )
})

test('assertSlugsDontCollideWithHubPages does not throw for a slug with no hub page', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'compose-collide-'))
  const contentDir = path.join(root, 'content')
  await mkdir(contentDir, { recursive: true })
  await writeFile(path.join(contentDir, 'platform.mdx'), '# Platform\n')
  assert.doesNotThrow(() => assertSlugsDontCollideWithHubPages([{ slug: 'sheppy' }], contentDir))
})

test('siblingRepoDir finds a checkout beside the hub, or returns null', async () => {
  const { root } = await fixture()
  const hub = path.join(root, 'hub')
  await mkdir(hub, { recursive: true })
  const source = { repo: 'rammp-org/repo' }
  assert.equal(siblingRepoDir(hub, source), path.join(root, 'repo'))
  assert.equal(siblingRepoDir(hub, { repo: 'rammp-org/absent' }), null)
})
