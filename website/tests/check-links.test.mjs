import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { internalHrefs, brokenLinks, staleLinks } from '../scripts/check-links.mjs'

test('internalHrefs keeps relative links as well as root-absolute ones', () => {
  const html = '<a href="/sheppy/">a</a><a href="superpowers/">b</a><a href="./config">c</a>' +
    '<a href="https://example.com">d</a><a href="//cdn/x">e</a><a href="#top">f</a>' +
    '<a href="mailto:x@y.z">g</a>'
  assert.deepEqual(internalHrefs(html), ['/sheppy/', 'superpowers/', './config'])
})

test('internalHrefs ignores data-href, matching only a real href attribute boundary', () => {
  const html = '<button data-href="/sheppy/guides">menu</button><a href="/real/">a</a>'
  assert.deepEqual(internalHrefs(html), ['/real/'])
})

test('internalHrefs accepts single-quoted href values', () => {
  const html = "<a href='/single/'>a</a>"
  assert.deepEqual(internalHrefs(html), ['/single/'])
})

test('brokenLinks reports a link with no matching output file', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'links-'))
  await mkdir(path.join(out, 'sheppy'), { recursive: true })
  await writeFile(path.join(out, 'sheppy', 'index.html'), '<a href="/nope/">x</a>')
  const broken = await brokenLinks(out)
  assert.equal(broken.length, 1)
  assert.equal(broken[0].href, '/nope/')
})

test('brokenLinks accepts a link resolving to an index.html', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'links-'))
  await mkdir(path.join(out, 'sheppy'), { recursive: true })
  await writeFile(path.join(out, 'index.html'), '<a href="/sheppy/">x</a>')
  await writeFile(path.join(out, 'sheppy', 'index.html'), 'ok')
  assert.deepEqual(await brokenLinks(out), [])
})

test('brokenLinks ignores fragments and query strings', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'links-'))
  await mkdir(path.join(out, 'sheppy'), { recursive: true })
  await writeFile(path.join(out, 'index.html'), '<a href="/sheppy/?x=1#top">x</a>')
  await writeFile(path.join(out, 'sheppy', 'index.html'), 'ok')
  assert.deepEqual(await brokenLinks(out), [])
})

test('brokenLinks resolves a relative link against its own page directory', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'links-'))
  await mkdir(path.join(out, 'sheppy', 'config'), { recursive: true })
  await writeFile(path.join(out, 'sheppy', 'index.html'),
    '<a href="config/">ok</a><a href="missing/">bad</a>')
  await writeFile(path.join(out, 'sheppy', 'config', 'index.html'), 'ok')
  const broken = await brokenLinks(out)
  assert.equal(broken.length, 1)
  assert.equal(broken[0].href, 'missing/')
})

test('brokenLinks reports a link resolving to a directory with no index.html', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'links-'))
  await mkdir(path.join(out, 'sheppy', 'guides'), { recursive: true })
  await writeFile(path.join(out, 'sheppy', 'index.html'), '<a href="./guides">x</a>')
  const broken = await brokenLinks(out)
  assert.equal(broken.length, 1)
  assert.equal(broken[0].href, './guides')
})

test('staleLinks reports any href back to the site as an absolute URL', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'links-'))
  await writeFile(path.join(out, 'index.html'),
    '<a href="https://rammp-org.github.io/rammp-docs/platform">a</a>' +
    '<a href="https://rammp-org.github.io/sheppy/tui">b</a>')
  assert.equal((await staleLinks(out)).length, 2)
})

test('staleLinks ignores the site URL outside an href, such as a curl command', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'links-'))
  await writeFile(path.join(out, 'index.html'),
    '<code>curl -LsSf https://rammp-org.github.io/sheppy/install.sh | sh</code>')
  assert.deepEqual(await staleLinks(out), [])
})

test('staleLinks does not flag a GitHub URL that merely contains the site name', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'links-'))
  await writeFile(path.join(out, 'index.html'),
    '<a href="https://github.com/rammp-org/rammp-org.github.io/edit/main/website/content/index.mdx">edit</a>')
  assert.deepEqual(await staleLinks(out), [])
})
