import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSources, assertSlugsAreMounted } from '../scripts/sources.mjs'

test('applies defaults for ref, assets and exclude', () => {
  const [source] = normalizeSources([
    { repo: 'rammp-org/sheppy', slug: 'sheppy', title: 'sheppy' }
  ])
  assert.equal(source.ref, 'main')
  assert.deepEqual(source.assets, [])
  assert.deepEqual(source.exclude, ['superpowers', 'AGENTS.md', 'CLAUDE.md'])
})

test('keeps explicit values', () => {
  const [source] = normalizeSources([
    { repo: 'rammp-org/sheppy', slug: 'sheppy', title: 'sheppy', ref: 'dev', assets: ['install.sh'], exclude: [] }
  ])
  assert.equal(source.ref, 'dev')
  assert.deepEqual(source.assets, ['install.sh'])
  assert.deepEqual(source.exclude, [])
})

test('rejects a missing required field', () => {
  assert.throws(
    () => normalizeSources([{ repo: 'rammp-org/sheppy', slug: 'sheppy' }]),
    /missing "title"/
  )
})

test('rejects a repo that is not owner/name', () => {
  assert.throws(
    () => normalizeSources([{ repo: 'sheppy', slug: 'sheppy', title: 'sheppy' }]),
    /must be "owner\/name"/
  )
})

test('rejects duplicate slugs', () => {
  assert.throws(
    () => normalizeSources([
      { repo: 'rammp-org/sheppy', slug: 'sheppy', title: 'sheppy' },
      { repo: 'rammp-org/other', slug: 'sheppy', title: 'Other' }
    ]),
    /duplicate slug "sheppy"/
  )
})

test('rejects a slug that is not a single path segment', () => {
  for (const slug of ['../foo', 'a/b', '..', '.']) {
    assert.throws(
      () => normalizeSources([{ repo: 'rammp-org/sheppy', slug, title: 'sheppy' }]),
      /must be a single path segment/
    )
  }
  assert.doesNotThrow(
    () => normalizeSources([{ repo: 'rammp-org/x', slug: 'module-template', title: 'X' }])
  )
})

test('rejects a top-level value that is not a list', () => {
  assert.throws(() => normalizeSources({ repo: 'x' }), /must contain a list/)
})

test('assertSlugsAreMounted names every slug missing from _meta.js', () => {
  const sources = normalizeSources([
    { repo: 'rammp-org/sheppy', slug: 'sheppy', title: 'sheppy' },
    { repo: 'rammp-org/dojo', slug: 'dojo', title: 'Dojo' }
  ])
  assert.throws(() => assertSlugsAreMounted(sources, ['index', 'sheppy']), /dojo/)
  assert.doesNotThrow(() => assertSlugsAreMounted(sources, ['index', 'sheppy', 'dojo']))
})
