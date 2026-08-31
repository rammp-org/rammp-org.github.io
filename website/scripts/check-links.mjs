import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE_ORIGIN = 'https://rammp-org.github.io/'

export async function htmlFiles(outDir) {
  const files = []
  for (const entry of await readdir(outDir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(path.join(entry.parentPath, entry.name))
    }
  }
  return files
}

export function internalHrefs(html) {
  return [...html.matchAll(/href="([^"]*)"/g)]
    .map(match => match[1])
    .filter(href => {
      // Exclude: schemes (http:, https:, mailto:, etc), protocol-relative (//), pure fragments (#)
      if (href.includes(':') || href.startsWith('//') || href.startsWith('#')) return false
      return true
    })
}

function resolves(outDir, pageFile, href) {
  const clean = href.split('#')[0].split('?')[0]
  let target

  if (href.startsWith('/')) {
    // Root-absolute: resolve from outDir
    target = path.join(outDir, clean)
  } else {
    // Relative: resolve from page's directory
    const pageDir = path.dirname(pageFile)
    target = path.join(pageDir, clean)
  }

  return existsSync(target) || existsSync(`${target}.html`) || existsSync(path.join(target, 'index.html'))
}

export async function brokenLinks(outDir) {
  const broken = []
  for (const file of await htmlFiles(outDir)) {
    const html = await readFile(file, 'utf8')
    for (const href of internalHrefs(html)) {
      if (!resolves(outDir, file, href)) broken.push({ file: path.relative(outDir, file), href })
    }
  }
  return broken
}

export async function staleLinks(outDir) {
  const stale = []
  for (const file of await htmlFiles(outDir)) {
    const html = await readFile(file, 'utf8')
    for (const match of html.matchAll(/href="([^"]*)"/g)) {
      if (match[1].startsWith(SITE_ORIGIN)) {
        stale.push({ file: path.relative(outDir, file), href: match[1] })
      }
    }
  }
  return stale
}

if (import.meta.filename === process.argv[1]) {
  const outDir = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'out')
  const broken = await brokenLinks(outDir)
  const stale = await staleLinks(outDir)
  for (const { file, href } of broken) console.error(`broken: ${file} -> ${href}`)
  for (const { file, href } of stale) console.error(`stale:  ${file} -> ${href} (use a path, not an absolute URL)`)
  if (broken.length > 0 || stale.length > 0) {
    console.error(`${broken.length} broken, ${stale.length} stale`)
    process.exit(1)
  }
  console.log('links ok')
}
