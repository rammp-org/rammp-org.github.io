import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rewriteLinks, sitePathFor } from '../scripts/rewrite-links.mjs'

const SLUG = 'kinova-gen3-ros2'

test('a sibling .md link with a fragment becomes the page path plus fragment', () => {
  const out = rewriteLinks('see [interface.md](interface.md#speed-scale).', SLUG, 'guide-goto-ee-pose.md')
  assert.equal(out, 'see [interface.md](/kinova-gen3-ros2/interface/#speed-scale).')
})

test('a .mdx link without a fragment becomes the page path', () => {
  const out = rewriteLinks('[t](troubleshooting.mdx)', SLUG, 'on-robot-runbook.md')
  assert.equal(out, '[t](/kinova-gen3-ros2/troubleshooting/)')
})

test('links resolve relative to the linking file, including ./ and ../', () => {
  assert.equal(sitePathFor(SLUG, 'guides/one.md', './two.md'), '/kinova-gen3-ros2/guides/two/')
  assert.equal(sitePathFor(SLUG, 'guides/one.md', '../interface.md'), '/kinova-gen3-ros2/interface/')
  assert.equal(sitePathFor(SLUG, 'index.mdx', 'guides/one.mdx'), '/kinova-gen3-ros2/guides/one/')
})

test('index pages map to their directory', () => {
  assert.equal(sitePathFor(SLUG, 'guides/one.md', '../index.mdx'), '/kinova-gen3-ros2/')
  assert.equal(sitePathFor(SLUG, 'one.md', 'guides/index.md'), '/kinova-gen3-ros2/guides/')
})

test('a link that climbs out of docs/ is left alone', () => {
  const text = '[readme](../README.md)'
  assert.equal(rewriteLinks(text, SLUG, 'one.md'), text)
})

test('absolute, external, fragment-only and non-page links are left alone', () => {
  const text = [
    '[a](/interfaces/arm)',
    '[b](https://github.com/rammp-org/kinova-gen3-ros2/blob/main/docs/interface.md#x)',
    '[c](#speed-scale)',
    '[d](install.sh)',
    '![e](figures/arm.png)',
    '[f](mailto:someone@example.org)'
  ].join('\n')
  assert.equal(rewriteLinks(text, SLUG, 'one.md'), text)
})

test('a link title is kept', () => {
  const out = rewriteLinks('[t](interface.md "The interface")', SLUG, 'one.md')
  assert.equal(out, '[t](/kinova-gen3-ros2/interface/ "The interface")')
})

test('reference-style definitions are rewritten', () => {
  const out = rewriteLinks('[iface]: interface.md#speed-scale\n', SLUG, 'guides/one.md')
  assert.equal(out, '[iface]: /kinova-gen3-ros2/guides/interface/#speed-scale\n')
})

test('links inside fenced code blocks are left alone', () => {
  const text = 'before [x](a.md)\n\n```md\n[y](b.md)\n```\n\nafter [z](c.md)\n'
  const out = rewriteLinks(text, SLUG, 'one.md')
  assert.equal(out, 'before [x](/kinova-gen3-ros2/a/)\n\n```md\n[y](b.md)\n```\n\nafter [z](/kinova-gen3-ros2/c/)\n')
})
