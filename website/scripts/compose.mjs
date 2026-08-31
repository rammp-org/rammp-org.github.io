import { cp, mkdir, readdir, rm, symlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadSources, assertSlugsAreMounted } from './sources.mjs'

const websiteDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const repoRoot = path.dirname(websiteDir)
const contentDir = path.join(websiteDir, 'content')
const cacheDir = path.join(websiteDir, '.sources')

export function siblingRepoDir(hubDir, source) {
  const name = source.repo.split('/')[1]
  const dir = path.resolve(hubDir, '..', name)
  return existsSync(path.join(dir, 'docs')) ? dir : null
}

async function resetDir(dir) {
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
}

export async function copyDocs(fromDocsDir, toDir, exclude) {
  await resetDir(toDir)
  const skip = new Set(exclude)
  for (const entry of await readdir(fromDocsDir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue
    await cp(path.join(fromDocsDir, entry.name), path.join(toDir, entry.name), { recursive: true })
  }
}

export async function linkDocs(fromDocsDir, toDir, exclude) {
  await resetDir(toDir)
  const skip = new Set(exclude)
  for (const entry of await readdir(fromDocsDir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue
    await symlink(path.join(fromDocsDir, entry.name), path.join(toDir, entry.name))
  }
}

export function cloneRepo(source, into) {
  const dest = path.join(into, source.slug)
  execFileSync('git', [
    'clone', '--depth=1', '--filter=blob:none',
    '--branch', source.ref,
    `https://github.com/${source.repo}.git`, dest
  ], { stdio: 'inherit' })
  return dest
}

export async function compose() {
  const sources = await loadSources(path.join(repoRoot, 'sources.yml'))
  const { default: meta } = await import(pathToFileURL(path.join(contentDir, '_meta.js')).href)
  assertSlugsAreMounted(sources, Object.keys(meta))

  await rm(cacheDir, { recursive: true, force: true })

  for (const source of sources) {
    const target = path.join(contentDir, source.slug)
    const sibling = process.env.CI ? null : siblingRepoDir(repoRoot, source)
    const sourceRepo = sibling ?? cloneRepo(source, cacheDir)
    const docsDir = path.join(sourceRepo, 'docs')

    if (!existsSync(docsDir)) {
      throw new Error(`${source.repo} has no docs/ directory at ref ${source.ref}`)
    }

    if (sibling) {
      console.log(`compose: ${source.slug} <- ${docsDir} (symlinked)`)
      await linkDocs(docsDir, target, source.exclude)
    } else {
      console.log(`compose: ${source.slug} <- ${source.repo}@${source.ref}`)
      await copyDocs(docsDir, target, source.exclude)
    }
  }
}

if (import.meta.filename === process.argv[1]) {
  await compose()
}
