import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('basePath defaults to empty so the hub serves the org root', async () => {
  const config = await readFile(new URL('../next.config.mjs', import.meta.url), 'utf8')
  assert.match(config, /DOCS_BASE_PATH \?\? ''/)
  assert.doesNotMatch(config, /rammp-docs/)
})
