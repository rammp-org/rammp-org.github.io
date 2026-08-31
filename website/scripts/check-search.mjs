import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { htmlFiles } from './check-links.mjs'

const outDir = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'out')

const entry = JSON.parse(await readFile(path.join(outDir, '_pagefind', 'pagefind-entry.json'), 'utf8'))
const indexed = Object.values(entry.languages).reduce((total, lang) => total + lang.page_count, 0)

const UNINDEXED = ['404.html', `404${path.sep}index.html`, `_not-found${path.sep}index.html`]

const pages = (await htmlFiles(outDir))
  .filter(file => !UNINDEXED.includes(path.relative(outDir, file)))
const composed = pages.filter(file => path.relative(outDir, file).startsWith(`sheppy${path.sep}`))

if (composed.length === 0) {
  console.error('no composed sheppy pages in out/ — the tree is not aggregating')
  process.exit(1)
}

if (indexed !== pages.length) {
  console.error(`pagefind indexed ${indexed} pages but out/ has ${pages.length} (excluding ${UNINDEXED.join(', ')})`)
  process.exit(1)
}

console.log(`search ok: ${indexed} pages indexed, ${composed.length} from composed sources`)
