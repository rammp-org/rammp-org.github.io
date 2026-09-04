import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { htmlFiles } from './check-links.mjs'
import { loadSources } from './sources.mjs'

const websiteDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const repoRoot = path.dirname(websiteDir)
const outDir = path.join(websiteDir, 'out')

const sources = await loadSources(path.join(repoRoot, 'sources.yml'))

const entry = JSON.parse(await readFile(path.join(outDir, '_pagefind', 'pagefind-entry.json'), 'utf8'))
const indexed = Object.values(entry.languages).reduce((total, lang) => total + lang.page_count, 0)

const UNINDEXED = ['404.html', `404${path.sep}index.html`, `_not-found${path.sep}index.html`]

const pages = (await htmlFiles(outDir))
  .filter(file => !UNINDEXED.includes(path.relative(outDir, file)))
const composed = pages.filter(file =>
  sources.some(source => path.relative(outDir, file).startsWith(`${source.slug}${path.sep}`)))

for (const source of sources) {
  const fromSlug = pages.filter(file => path.relative(outDir, file).startsWith(`${source.slug}${path.sep}`))
  if (fromSlug.length === 0) {
    console.error(`no composed pages for slug "${source.slug}" in out/ — the tree is not aggregating it`)
    process.exit(1)
  }
}

if (indexed !== pages.length) {
  console.error(`pagefind indexed ${indexed} pages but out/ has ${pages.length} (excluding ${UNINDEXED.join(', ')})`)
  process.exit(1)
}

for (const source of sources) {
  for (const asset of source.assets) {
    const target = path.join(outDir, source.slug, path.basename(asset))
    if (!existsSync(target)) {
      console.error(`${source.repo} declares asset "${asset}" but it is missing from the build: ${path.relative(outDir, target)}`)
      process.exit(1)
    }
  }
}

console.log(`search ok: ${indexed} pages indexed, ${composed.length} from composed sources`)
