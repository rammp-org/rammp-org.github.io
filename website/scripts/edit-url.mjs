import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const PAGE_EXTENSIONS = new Set(['.md', '.mdx'])

export function injectEditUrl(text, editUrl) {
  const line = `editUrl: ${JSON.stringify(editUrl)}`
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---', 3)
    if (end !== -1) {
      return `${text.slice(0, end)}\n${line}${text.slice(end)}`
    }
  }
  return `---\n${line}\n---\n\n${text}`
}

export function editUrlFor(source, relPath) {
  const posixPath = relPath.split(path.sep).join('/')
  return `https://github.com/${source.repo}/edit/${source.ref}/docs/${posixPath}`
}

export async function injectEditUrls(dir, source) {
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !PAGE_EXTENSIONS.has(path.extname(entry.name))) continue
    const file = path.join(entry.parentPath, entry.name)
    const relPath = path.relative(dir, file)
    const text = await readFile(file, 'utf8')
    await writeFile(file, injectEditUrl(text, editUrlFor(source, relPath)))
  }
}
