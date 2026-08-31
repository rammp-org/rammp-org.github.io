import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'

const DEFAULT_EXCLUDE = ['superpowers']
const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/

export function normalizeSources(raw) {
  if (!Array.isArray(raw)) {
    throw new Error('sources.yml must contain a list of sources')
  }
  const seen = new Set()
  return raw.map((entry, index) => {
    for (const key of ['repo', 'slug', 'title']) {
      if (!entry?.[key]) {
        throw new Error(`sources.yml entry ${index}: missing "${key}"`)
      }
    }
    if (!REPO_PATTERN.test(entry.repo)) {
      throw new Error(`sources.yml entry ${index}: repo "${entry.repo}" must be "owner/name"`)
    }
    if (!/^[\w.-]+$/.test(entry.slug) || entry.slug === '.' || entry.slug === '..') {
      throw new Error(`sources.yml entry ${index}: slug "${entry.slug}" must be a single path segment`)
    }
    if (seen.has(entry.slug)) {
      throw new Error(`sources.yml entry ${index}: duplicate slug "${entry.slug}"`)
    }
    seen.add(entry.slug)
    return {
      repo: entry.repo,
      slug: entry.slug,
      title: entry.title,
      ref: entry.ref ?? 'main',
      assets: entry.assets ?? [],
      exclude: entry.exclude ?? DEFAULT_EXCLUDE
    }
  })
}

export function assertSlugsAreMounted(sources, metaKeys) {
  const missing = sources.map(source => source.slug).filter(slug => !metaKeys.includes(slug))
  if (missing.length > 0) {
    throw new Error(
      `sources.yml slugs missing from website/content/_meta.js: ${missing.join(', ')}. ` +
      'Composed sections render but are unreachable from the sidebar without a _meta entry.'
    )
  }
}

export async function loadSources(file) {
  return normalizeSources(parse(await readFile(file, 'utf8')))
}
