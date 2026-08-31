import { test } from 'node:test'
import assert from 'node:assert/strict'
import { injectEditUrl, editUrlFor } from '../scripts/edit-url.mjs'

const URL_ = 'https://github.com/rammp-org/sheppy/edit/main/docs/index.mdx'

test('adds a frontmatter block when there is none', () => {
  const out = injectEditUrl('# Title\n', URL_)
  assert.equal(out, `---\neditUrl: "${URL_}"\n---\n\n# Title\n`)
})

test('adds the field to an existing frontmatter block', () => {
  const out = injectEditUrl('---\ntitle: Intro\n---\n\n# Title\n', URL_)
  assert.equal(out, `---\ntitle: Intro\neditUrl: "${URL_}"\n---\n\n# Title\n`)
})

test('handles an empty frontmatter block', () => {
  const out = injectEditUrl('---\n---\n# Title\n', URL_)
  assert.equal(out, `---\neditUrl: "${URL_}"\n---\n# Title\n`)
})

test('does not treat a horizontal rule in the body as frontmatter', () => {
  const out = injectEditUrl('# Title\n\n---\n\nmore\n', URL_)
  assert.ok(out.startsWith(`---\neditUrl: "${URL_}"\n---\n\n# Title`))
})

test('builds the edit URL from repo, ref and path', () => {
  const source = { repo: 'rammp-org/sheppy', ref: 'main' }
  assert.equal(editUrlFor(source, 'guides/sheppyd.mdx'),
    'https://github.com/rammp-org/sheppy/edit/main/docs/guides/sheppyd.mdx')
})
