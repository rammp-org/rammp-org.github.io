import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { internalHrefs, brokenLinks, staleLinks } from '../scripts/check-links.mjs'

test('internalHrefs keeps root-relative links and drops the rest', () => {
  const html = '<a href="/sheppy/">a</a><a href="https://example.com">b</a><a href="//cdn/x">c</a><a href="#top">d</a>'
  assert.deepEqual(internalHrefs(html), ['/sheppy/'])
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
