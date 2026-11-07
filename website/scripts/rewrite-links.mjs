import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const PAGE_EXTENSIONS = new Set(['.md', '.mdx'])

// A source repo's docs link to each other the way GitHub renders them:
// `[text](interface.md#speed-scale)`, relative to the linking file. On the site
// every page is a directory (`trailingSlash: true`), so a relative link left
// alone resolves from inside the page's own directory and misses. Rewrite each
// one to the site path the composed page gets, and leave the source docs
// GitHub-friendly.

function isRelativePage(target) {
  if (target.startsWith('/') || target.startsWith('#')) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) return false
  return PAGE_EXTENSIONS.has(path.posix.extname(target))
}

export function sitePathFor(slug, pageRelPath, target) {
  const pageDir = path.posix.dirname(pageRelPath.split(path.sep).join('/'))
  const resolved = path.posix.normalize(path.posix.join(pageDir, target))
  if (resolved.startsWith('..')) return null // points outside docs/: nothing on the site
  const withoutExt = resolved.slice(0, -path.posix.extname(resolved).length)
  const parts = withoutExt.split('/').filter(part => part !== '' && part !== '.')
  if (parts.at(-1) === 'index') parts.pop()
  return `/${[slug, ...parts].join('/')}/`
}

export function rewriteLinks(text, slug, pageRelPath) {
  // Leave fenced code blocks alone: a link inside one is an example, not a link.
  return text
    .split(/(^(?:```|~~~)[\s\S]*?^(?:```|~~~)[ \t]*$)/m)
    .map((chunk, index) => (index % 2 === 1 ? chunk : rewriteChunk(chunk, slug, pageRelPath)))
    .join('')
}

function rewriteChunk(text, slug, pageRelPath) {
  // Inline links and images: `](target)` and `](target "title")`.
  const inline = /\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g
  // Reference definitions: `[id]: target` at the start of a line.
  const definition = /^(\[[^\]]+\]:[ \t]+)(\S+)/gm
  const rewrite = target => {
    const [file, fragment = ''] = splitFragment(target)
    if (!isRelativePage(file)) return null
    const sitePath = sitePathFor(slug, pageRelPath, file)
    return sitePath === null ? null : `${sitePath}${fragment}`
  }
  return text
    .replace(inline, (match, target, title) => {
      const rewritten = rewrite(target)
      return rewritten === null ? match : `](${rewritten}${title})`
    })
    .replace(definition, (match, prefix, target) => {
      const rewritten = rewrite(target)
      return rewritten === null ? match : `${prefix}${rewritten}`
    })
}

function splitFragment(target) {
  const hash = target.indexOf('#')
  return hash === -1 ? [target, ''] : [target.slice(0, hash), target.slice(hash)]
}

export async function rewriteLinksIn(dir, slug) {
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !PAGE_EXTENSIONS.has(path.extname(entry.name))) continue
    const file = path.join(entry.parentPath, entry.name)
    const text = await readFile(file, 'utf8')
    const rewritten = rewriteLinks(text, slug, path.relative(dir, file))
    if (rewritten !== text) await writeFile(file, rewritten)
  }
}
