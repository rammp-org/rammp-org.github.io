# Multi-repo Docs Aggregation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `rammp-docs` into `rammp-org.github.io`, a hub that pulls `docs/` from every RAMMP repo at build time and publishes them as one tree with a single sidebar and a single search index.

**Architecture:** Source repos own only a `docs/` directory. The hub owns the sole Nextra app. A `compose` step runs before `next build`, resolving each repo listed in `sources.yml` — symlinking a sibling checkout during local development, shallow-cloning in CI — into `website/content/<slug>/`. One build produces the whole tree at the org root.

**Tech Stack:** Next 16, Nextra 4 + nextra-theme-docs, pagefind, Node 22, `yaml`. Tests use the built-in `node:test` runner. No test framework is added.

**Spec:** `docs/superpowers/specs/2026-08-31-multi-repo-docs-aggregation-design.md`

## Global Constraints

- **Node is not on the default PATH in this environment.** Every shell running `npm` or `node` must first `export PATH="$HOME/.local/node/bin:$PATH"`. Verified: node v22.23.2, npm 10.9.8.
- Node 22. Dependency versions stay as pinned in `website/package.json`: `next ^16.3.1`, `nextra ^4.6.1`, `nextra-theme-docs ^4.6.1`, `react ^19.1.0`, `pagefind ^1.3.0`, `overrides.zod 4.1.12`.
- All npm commands run from `website/`. Scripts live in `website/scripts/`, tests in `website/tests/`.
- `sources.yml` lives at the repo root; `compose.mjs` resolves it relative to its own location.
- `basePath` is empty for every build. `DOCS_BASE_PATH` stays in `next.config.mjs` so a future path or domain move is a one-variable change.
- `exclude` defaults to `['superpowers']`. Every repo keeps design specs and plans in `docs/superpowers/`; those are never published.
- Composed output is generated, never committed: `website/content/<slug>/`, `website/public/<slug>/`, and `website/.sources/` are gitignored.
- Commit messages use plain imperative subjects, matching the existing history. Not Conventional Commits.
- `rammp-deployments` is not mounted. Its `docs/` holds only `superpowers/`.

---

### Task 1: Rename the repo and serve from the org root

**Files:**
- Modify: `website/next.config.mjs`
- Modify: `website/app/layout.jsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a hub deployed at `https://rammp-org.github.io/` with an empty `basePath`.

- [ ] **Step 1: Rename the GitHub repo**

```bash
gh repo rename rammp-org.github.io --repo rammp-org/rammp-docs
git remote set-url origin git@github.com:rammp-org/rammp-org.github.io.git
git remote -v
```

Expected: both fetch and push URLs read `rammp-org/rammp-org.github.io`.

- [ ] **Step 2: Write the failing test**

Create `website/tests/config.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('basePath defaults to empty so the hub serves the org root', async () => {
  const config = await readFile(new URL('../next.config.mjs', import.meta.url), 'utf8')
  assert.match(config, /DOCS_BASE_PATH \?\? ''/)
  assert.doesNotMatch(config, /rammp-docs/)
})
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `cd website && node --test tests/config.test.mjs`
Expected: FAIL — the config still defaults to `'/rammp-docs'`.

- [ ] **Step 4: Change the default basePath**

In `website/next.config.mjs`, replace the comment and `basePath` line with:

```js
// Static export for GitHub Pages at the org root (https://rammp-org.github.io).
// Set DOCS_BASE_PATH="/some-prefix" to build under a subpath.
const basePath = process.env.DOCS_BASE_PATH ?? ''
```

- [ ] **Step 5: Run the test to make sure it passes**

Run: `cd website && node --test tests/config.test.mjs`
Expected: PASS.

- [ ] **Step 6: Point the repository link at the new name**

In `website/app/layout.jsx`, change `docsRepositoryBase` to:

```js
docsRepositoryBase="https://github.com/rammp-org/rammp-org.github.io/tree/main/website"
```

In `README.md`, replace every `rammp-org.github.io/rammp-docs` with `rammp-org.github.io`.

- [ ] **Step 7: Build and confirm no stale prefix**

```bash
cd website && npm ci && npm run build
grep -r "/rammp-docs" out/ && echo "STALE PREFIX FOUND" || echo "clean"
```

Expected: `clean`, and `out/index.html` exists.

- [ ] **Step 8: Commit**

```bash
git add website/next.config.mjs website/app/layout.jsx website/tests/config.test.mjs README.md
git commit -m "Serve the hub from the org root

Renamed rammp-docs to rammp-org.github.io, so the site is the org Pages
site and basePath is empty."
```

---

### Task 2: Source manifest with validation

**Files:**
- Create: `sources.yml`
- Create: `website/scripts/sources.mjs`
- Test: `website/tests/sources.test.mjs`
- Modify: `website/package.json`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `normalizeSources(raw: unknown) => Source[]` where `Source = { repo: string, slug: string, title: string, ref: string, assets: string[], exclude: string[] }`
  - `assertSlugsAreMounted(sources: Source[], metaKeys: string[]) => void`
  - `loadSources(file: string) => Promise<Source[]>`

- [ ] **Step 1: Add the yaml dependency**

```bash
cd website && npm install --save-dev yaml
```

- [ ] **Step 2: Write the failing tests**

Create `website/tests/sources.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSources, assertSlugsAreMounted } from '../scripts/sources.mjs'

test('applies defaults for ref, assets and exclude', () => {
  const [source] = normalizeSources([
    { repo: 'rammp-org/sheppy', slug: 'sheppy', title: 'sheppy' }
  ])
  assert.equal(source.ref, 'main')
  assert.deepEqual(source.assets, [])
  assert.deepEqual(source.exclude, ['superpowers'])
})

test('keeps explicit values', () => {
  const [source] = normalizeSources([
    { repo: 'rammp-org/sheppy', slug: 'sheppy', title: 'sheppy', ref: 'dev', assets: ['install.sh'], exclude: [] }
  ])
  assert.equal(source.ref, 'dev')
  assert.deepEqual(source.assets, ['install.sh'])
  assert.deepEqual(source.exclude, [])
})

test('rejects a missing required field', () => {
  assert.throws(
    () => normalizeSources([{ repo: 'rammp-org/sheppy', slug: 'sheppy' }]),
    /missing "title"/
  )
})

test('rejects a repo that is not owner/name', () => {
  assert.throws(
    () => normalizeSources([{ repo: 'sheppy', slug: 'sheppy', title: 'sheppy' }]),
    /must be "owner\/name"/
  )
})

test('rejects duplicate slugs', () => {
  assert.throws(
    () => normalizeSources([
      { repo: 'rammp-org/sheppy', slug: 'sheppy', title: 'sheppy' },
      { repo: 'rammp-org/other', slug: 'sheppy', title: 'Other' }
    ]),
    /duplicate slug "sheppy"/
  )
})

test('rejects a top-level value that is not a list', () => {
  assert.throws(() => normalizeSources({ repo: 'x' }), /must contain a list/)
})

test('assertSlugsAreMounted names every slug missing from _meta.js', () => {
  const sources = normalizeSources([
    { repo: 'rammp-org/sheppy', slug: 'sheppy', title: 'sheppy' },
    { repo: 'rammp-org/dojo', slug: 'dojo', title: 'Dojo' }
  ])
  assert.throws(() => assertSlugsAreMounted(sources, ['index', 'sheppy']), /dojo/)
  assert.doesNotThrow(() => assertSlugsAreMounted(sources, ['index', 'sheppy', 'dojo']))
})
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `cd website && node --test tests/sources.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/sources.mjs'`.

- [ ] **Step 4: Implement the module**

Create `website/scripts/sources.mjs`:

```js
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
```

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `cd website && node --test tests/sources.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 6: Create the manifest and its sidebar entry**

Create `sources.yml` at the repo root:

```yaml
# Repos whose docs/ directory is published as part of this site.
# slug is the path it mounts at, and must also appear in website/content/_meta.js.
- repo: rammp-org/sheppy
  slug: sheppy
  title: sheppy
  assets: [install.sh]
```

Add the matching entry to `website/content/_meta.js` in the same commit —
`assertSlugsAreMounted` rejects a manifest slug with no sidebar entry, so
compose cannot run until both exist:

```js
export default {
  index: 'Introduction',
  platform: 'The platform',
  interfaces: 'Interfaces',
  building: 'Build a module',
  running: 'Run the system',
  sheppy: 'sheppy'
}
```

- [ ] **Step 7: Add a test script**

In `website/package.json`, add to `scripts`:

```json
"test": "node --test tests/"
```

- [ ] **Step 8: Commit**

```bash
git add sources.yml website/content/_meta.js website/scripts/sources.mjs website/tests/sources.test.mjs website/package.json website/package-lock.json
git commit -m "Add the source manifest and its validation

sources.yml lists which repos mount where. Validation catches the two
mistakes that fail silently: a slug with no _meta.js entry, and a
duplicate slug."
```

---

### Task 3: Compose source docs into the content tree

**Files:**
- Create: `website/scripts/compose.mjs`
- Test: `website/tests/compose.test.mjs`
- Modify: `website/.gitignore`

**Interfaces:**
- Consumes: `loadSources`, `assertSlugsAreMounted` from Task 2.
- Produces:
  - `siblingRepoDir(repoRoot: string, source: Source) => string | null`
  - `copyDocs(fromDocsDir: string, toDir: string, exclude: string[]) => Promise<void>`
  - `linkDocs(fromDocsDir: string, toDir: string, exclude: string[]) => Promise<void>`
  - `compose() => Promise<void>` — the CLI entry point, run for its side effects.

- [ ] **Step 1: Write the failing tests**

Create `website/tests/compose.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { siblingRepoDir, copyDocs, linkDocs } from '../scripts/compose.mjs'

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'compose-'))
  const docs = path.join(root, 'repo', 'docs')
  await mkdir(path.join(docs, 'superpowers', 'specs'), { recursive: true })
  await mkdir(path.join(docs, 'guides'), { recursive: true })
  await writeFile(path.join(docs, 'index.mdx'), '# Index\n')
  await writeFile(path.join(docs, 'guides', 'one.mdx'), '# One\n')
  await writeFile(path.join(docs, 'superpowers', 'specs', 'a.md'), '# Spec\n')
  return { root, docs, target: path.join(root, 'out') }
}

test('copyDocs copies the tree and skips excluded directories', async () => {
  const { docs, target } = await fixture()
  await copyDocs(docs, target, ['superpowers'])
  assert.deepEqual((await readdir(target)).sort(), ['guides', 'index.mdx'])
  assert.equal(await readFile(path.join(target, 'guides', 'one.mdx'), 'utf8'), '# One\n')
})

test('copyDocs clears content removed from the source', async () => {
  const { docs, target } = await fixture()
  await mkdir(target, { recursive: true })
  await writeFile(path.join(target, 'stale.mdx'), '# Stale\n')
  await copyDocs(docs, target, ['superpowers'])
  assert.ok(!(await readdir(target)).includes('stale.mdx'))
})

test('linkDocs symlinks entries rather than copying them', async () => {
  const { docs, target } = await fixture()
  await linkDocs(docs, target, ['superpowers'])
  assert.ok((await lstat(path.join(target, 'index.mdx'))).isSymbolicLink())
  assert.deepEqual((await readdir(target)).sort(), ['guides', 'index.mdx'])
})

test('siblingRepoDir finds a checkout beside the hub, or returns null', async () => {
  const { root } = await fixture()
  const hub = path.join(root, 'hub')
  await mkdir(hub, { recursive: true })
  const source = { repo: 'rammp-org/repo' }
  assert.equal(siblingRepoDir(hub, source), path.join(root, 'repo'))
  assert.equal(siblingRepoDir(hub, { repo: 'rammp-org/absent' }), null)
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd website && node --test tests/compose.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/compose.mjs'`.

- [ ] **Step 3: Implement compose**

Create `website/scripts/compose.mjs`:

```js
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
```

Note the sibling lookup takes `repoRoot`, not `websiteDir`. Sibling checkouts sit beside the hub *repo*, so `path.resolve(repoRoot, '..', name)` lands on `~/atdev/<name>`. Passing `websiteDir` would look inside the hub repo itself.

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `cd website && node --test tests/compose.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 5: Ignore generated output**

Append to `website/.gitignore`:

```
.sources/
content/sheppy/
public/sheppy/
```

- [ ] **Step 6: Commit**

```bash
git add website/scripts/compose.mjs website/tests/compose.test.mjs website/.gitignore
git commit -m "Compose source repo docs into the content tree

Symlinks a sibling checkout during local development so doc authors keep
a live preview, and shallow-clones in CI. docs/superpowers is excluded."
```

---

### Task 4: Per-page edit links pointing at the source repo

**Files:**
- Create: `website/scripts/edit-url.mjs`
- Modify: `website/scripts/compose.mjs`
- Modify: `website/mdx-components.jsx`
- Modify: `website/app/layout.jsx`
- Test: `website/tests/edit-url.test.mjs`

**Interfaces:**
- Consumes: `copyDocs` from Task 3.
- Produces:
  - `injectEditUrl(text: string, editUrl: string) => string`
  - `editUrlFor(source: Source, relPath: string) => string`
  - `injectEditUrls(dir: string, source: Source) => Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `website/tests/edit-url.test.mjs`:

```js
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
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd website && node --test tests/edit-url.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/edit-url.mjs'`.

- [ ] **Step 3: Implement the module**

Create `website/scripts/edit-url.mjs`:

```js
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
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `cd website && node --test tests/edit-url.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Call it from compose, copy mode only**

In `website/scripts/compose.mjs`, add the import:

```js
import { injectEditUrls } from './edit-url.mjs'
```

and in the `else` branch of the loop, after `copyDocs`:

```js
      await copyDocs(docsDir, target, source.exclude)
      await injectEditUrls(target, source)
```

Injection only runs in copy mode. Symlinked trees point at the author's own checkout, and writing through them would edit that repo's working tree.

- [ ] **Step 6: Render the edit link from frontmatter**

Replace `website/mdx-components.jsx` with:

```jsx
import { useMDXComponents as getThemeComponents } from 'nextra-theme-docs'

const themeComponents = getThemeComponents()
const ThemeWrapper = themeComponents.wrapper

const HUB_EDIT_BASE = 'https://github.com/rammp-org/rammp-org.github.io/edit/main/website'

function Wrapper({ metadata, children, ...props }) {
  const editUrl = metadata?.editUrl ??
    (metadata?.filePath ? `${HUB_EDIT_BASE}/${metadata.filePath}` : null)
  return (
    <ThemeWrapper metadata={metadata} {...props}>
      {children}
      {editUrl && (
        <p style={{ marginTop: '3rem', fontSize: '0.875rem' }}>
          <a href={editUrl} target="_blank" rel="noreferrer">Edit this page on GitHub</a>
        </p>
      )}
    </ThemeWrapper>
  )
}

export function useMDXComponents(components) {
  return { ...themeComponents, wrapper: Wrapper, ...components }
}
```

In `website/app/layout.jsx`, remove the `docsRepositoryBase` and `editLink` props from `<Layout>`. With no `docsRepositoryBase`, the theme renders no edit link of its own, leaving exactly one.

- [ ] **Step 7: Verify against a real build**

```bash
cd website && CI=1 npm run compose && npx next build
grep -o 'https://github.com/rammp-org/sheppy/edit/main/docs/[^"]*' out/sheppy/index.html | head -1
grep -c 'Edit this page on GitHub' out/sheppy/index.html
```

Expected: the first command prints a sheppy edit URL; the second prints `1`.

If the second prints `0` for a hub page such as `out/index.html`, `metadata.filePath` is relative to the content directory rather than the website directory — append `/content` to `HUB_EDIT_BASE` and re-run. Do not weaken the assertion.

- [ ] **Step 8: Commit**

```bash
git add website/scripts/edit-url.mjs website/scripts/compose.mjs website/mdx-components.jsx website/app/layout.jsx website/tests/edit-url.test.mjs
git commit -m "Point edit links at the repo a page came from

Compose stamps an editUrl into each copied page's frontmatter, and the MDX
wrapper renders it. Nextra's docsRepositoryBase is global, so it cannot
express a per-page repository."
```

---

### Task 5: Publish declared assets

**Files:**
- Modify: `website/scripts/compose.mjs`
- Test: `website/tests/assets.test.mjs`

**Interfaces:**
- Consumes: `Source.assets` from Task 2.
- Produces: `copyAssets(sourceRepoDir: string, source: Source, publicDir: string) => Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `website/tests/assets.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { copyAssets } from '../scripts/compose.mjs'

test('copies declared assets into public/<slug>/', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'assets-'))
  const repo = path.join(root, 'repo')
  await mkdir(repo, { recursive: true })
  await writeFile(path.join(repo, 'install.sh'), '#!/bin/sh\necho hi\n')
  const publicDir = path.join(root, 'public')

  await copyAssets(repo, { slug: 'sheppy', assets: ['install.sh'] }, publicDir)

  const copied = await readFile(path.join(publicDir, 'sheppy', 'install.sh'), 'utf8')
  assert.equal(copied, '#!/bin/sh\necho hi\n')
})

test('fails loudly when a declared asset is missing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'assets-'))
  const repo = path.join(root, 'repo')
  await mkdir(repo, { recursive: true })
  await assert.rejects(
    () => copyAssets(repo, { slug: 'sheppy', assets: ['install.sh'] }, path.join(root, 'public')),
    /install\.sh/
  )
})

test('does nothing when no assets are declared', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'assets-'))
  const repo = path.join(root, 'repo')
  await mkdir(repo, { recursive: true })
  await assert.doesNotReject(
    () => copyAssets(repo, { slug: 'dojo', assets: [] }, path.join(root, 'public'))
  )
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd website && node --test tests/assets.test.mjs`
Expected: FAIL — `copyAssets is not a function`.

- [ ] **Step 3: Implement copyAssets**

In `website/scripts/compose.mjs`, add after `linkDocs`:

```js
export async function copyAssets(sourceRepoDir, source, publicDir) {
  if (source.assets.length === 0) return
  const target = path.join(publicDir, source.slug)
  await mkdir(target, { recursive: true })
  for (const asset of source.assets) {
    const from = path.join(sourceRepoDir, asset)
    if (!existsSync(from)) {
      throw new Error(`${source.repo} declares asset "${asset}", which does not exist at ref ${source.ref}`)
    }
    await cp(from, path.join(target, path.basename(asset)))
  }
}
```

Add `const publicDir = path.join(websiteDir, 'public')` beside the other directory constants, and call it once per source at the end of the loop body, in both modes:

```js
    await copyAssets(sourceRepo, source, publicDir)
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `cd website && node --test tests/assets.test.mjs`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add website/scripts/compose.mjs website/tests/assets.test.mjs
git commit -m "Serve source repo assets alongside their docs

Sheppy's documented install command curls install.sh from the docs site,
so the hub has to serve that file once it owns /sheppy."
```

---

### Task 6: Wire compose into the build and mount sheppy

**Files:**
- Modify: `website/package.json`
- Modify: `website/content/_meta.js`
- Modify: `website/content/index.mdx`

**Interfaces:**
- Consumes: `compose()` from Task 3.
- Produces: `npm run build` emitting `out/sheppy/`.

- [ ] **Step 1: Add compose to the build scripts**

In `website/package.json`, replace the `dev` and `build` scripts:

```json
"compose": "node scripts/compose.mjs",
"dev": "npm run compose && next dev",
"build": "npm run compose && next build",
```

- [ ] **Step 2: Confirm sheppy is mounted in the sidebar**

`website/content/_meta.js` already gained its `sheppy: 'sheppy'` entry in Task 2,
because compose refuses to run without it. Confirm it is there:

```bash
grep sheppy website/content/_meta.js
```

Expected: one match.

- [ ] **Step 3: Turn the outbound sheppy link into a path**

In `website/content/index.mdx`, replace `[sheppy](https://rammp-org.github.io/sheppy)` with `[sheppy](/sheppy)`.

- [ ] **Step 4: Build against the local sheppy checkout**

```bash
cd website && npm run build
ls out/sheppy/index.html out/sheppy/install.sh
```

Expected: both paths exist. Sheppy already has a `docs/` directory, so compose symlinks it — but at this point it holds only `superpowers/` (excluded) and a one-page `index.md`. The real content arrives in Task 7. `install.sh` is already present at sheppy's root, so the asset copy works now.

- [ ] **Step 5: Confirm the sidebar shows both sections**

```bash
cd website && npx serve out
```

Visit `http://localhost:3000/`. Expected: the sidebar lists the five hub pages and a `sheppy` section; opening a sheppy page shows its own sub-navigation.

- [ ] **Step 6: Commit**

```bash
git add website/package.json website/content/index.mdx
git commit -m "Mount sheppy in the hub tree

compose runs before dev and build, so the tree is always composed from
sources.yml before Next sees the content directory."
```

---

### Task 7: Migrate the sheppy repo

**Files (in `../sheppy`):**
- Move: `website/content/*` → `docs/`, `website/AGENTS.md` and `website/CLAUDE.md` → `docs/`
- Delete: `website/`, `.github/workflows/docs.yml`, `docs/index.md`

**Interfaces:**
- Consumes: the `sheppy` entry in `sources.yml` from Task 2.
- Produces: a sheppy repo whose only docs artefact is `docs/`, holding real content rather than a pointer page.

This lands before the link and search checkers because sheppy's current `docs/index.md` links into `../website/content/`, which produces broken links in the composed tree. The checkers cannot pass until it is gone.

- [ ] **Step 1: Replace the pointer page with the site's index**

```bash
cd ../sheppy
git rm docs/index.md
git mv website/content/index.mdx docs/index.mdx
```

`docs/index.md` was a pointer to the standalone site plus a table of design records. `design-records.mdx` already carries the table, and the pointer is now wrong.

- [ ] **Step 2: Move the rest of the content**

```bash
cd ../sheppy
git mv website/content/_meta.js docs/_meta.js
git mv website/content/*.mdx docs/
git mv website/content/guides docs/guides
ls docs
```

Expected: `AGENTS.md` and `CLAUDE.md` are not there yet, but `_meta.js`, `architecture.mdx`, `concepts.mdx`, `design-records.mdx`, `getting-started.mdx`, `guides/`, `index.mdx`, `manifest.mdx`, `manifest-reference.mdx`, `superpowers/` and `tui.mdx` are.

- [ ] **Step 3: Move the authoring guidance**

```bash
cd ../sheppy
git mv website/AGENTS.md docs/AGENTS.md
git mv website/CLAUDE.md docs/CLAUDE.md
```

Edit both: paths reading `website/content/` become `docs/`, and any instruction to run a local Nextra server is replaced with a note that previewing happens by running `npm run dev` in a `rammp-docs` checkout beside this one, which symlinks this `docs/` into the tree.

`AGENTS.md` and `CLAUDE.md` sit inside the published `docs/` tree, so they need frontmatter suppressing them from the sidebar, or `_meta.js` must not list them. Nextra only renders `.md` and `.mdx` files it can route; confirm in Step 6 that no page for them appears in `out/sheppy/`.

- [ ] **Step 4: Delete the scaffold and its workflow**

```bash
cd ../sheppy
git rm -r website
git rm .github/workflows/docs.yml
```

The `postbuild` step that published `install.sh` goes with it. `sources.yml` already declares `assets: [install.sh]`, so the hub takes over serving it.

- [ ] **Step 5: Fix outbound links in the moved content**

```bash
cd ../sheppy
grep -rn "rammp-org.github.io" docs/
```

Expected remaining matches: only the two `curl -LsSf https://rammp-org.github.io/sheppy/install.sh` commands, which are shell commands in code blocks and must stay absolute. Rewrite any link to a sheppy *page* as a relative path, and any link to hub content as a root-absolute path such as `/platform`.

- [ ] **Step 6: Confirm the hub composes the real content**

```bash
cd ../rammp-docs/website && npm run build
ls out/sheppy/getting-started/index.html out/sheppy/guides/sheppyd/index.html out/sheppy/install.sh
ls out/sheppy/ | grep -i -E 'agents|claude' && echo "GUIDANCE PAGE LEAKED" || echo "guidance not published"
```

Expected: the compose log reads `compose: sheppy <- .../sheppy/docs (symlinked)`, the three paths exist, and the last line prints `guidance not published`. If it leaked, add `AGENTS` and `CLAUDE` to sheppy's `_meta.js` with `display: 'hidden'`, or rename them to `AGENTS.txt`.

- [ ] **Step 7: Commit and push sheppy**

```bash
cd ../sheppy
git add -A
git commit -m "Move docs to docs/ and drop the site scaffold

The docs site is now built by rammp-org.github.io, which composes this
repo's docs/ into the shared tree."
git push
```

- [ ] **Step 8: Disable sheppy's Pages deploy**

```bash
gh api -X DELETE repos/rammp-org/sheppy/pages
gh api repos/rammp-org/sheppy/pages 2>&1 | head -2
```

Expected: the second call reports 404. `/sheppy` is now free for the hub to own.

- [ ] **Step 9: Commit the hub side if anything changed**

```bash
cd ../rammp-docs && git status --short
```

Expected: clean, since composed content is gitignored. If `website/content/_meta.js` or `sources.yml` needed a tweak, commit it now.

---

### Task 8: Internal link checker

**Files:**
- Create: `website/scripts/check-links.mjs`
- Test: `website/tests/check-links.test.mjs`
- Modify: `website/package.json`

**Interfaces:**
- Consumes: a built `out/` directory.
- Produces:
  - `htmlFiles(outDir: string) => Promise<string[]>`
  - `internalHrefs(html: string) => string[]`
  - `brokenLinks(outDir: string) => Promise<{ file: string, href: string }[]>`
  - `staleLinks(outDir: string) => Promise<{ file: string, href: string }[]>`

- [ ] **Step 1: Write the failing tests**

Create `website/tests/check-links.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { internalHrefs, brokenLinks, staleLinks } from '../scripts/check-links.mjs'

test('internalHrefs keeps root-relative links and drops the rest', () => {
  const html = '<a href="/sheppy/">a</a><a href="https://example.com">b</a><a href="//cdn/x">c</a><a href="#top">d</a>'
  assert.deepEqual(internalHrefs(html), ['/sheppy/'])
})

test('brokenLinks reports a link with no matching output file', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'links-'))
  await mkdir(path.join(out, 'sheppy'), { recursive: true })
  await writeFile(path.join(out, 'sheppy', 'index.html'), '<a href="/nope/">x</a>')
  const broken = await brokenLinks(out)
  assert.equal(broken.length, 1)
  assert.equal(broken[0].href, '/nope/')
})

test('brokenLinks accepts a link resolving to an index.html', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'links-'))
  await mkdir(path.join(out, 'sheppy'), { recursive: true })
  await writeFile(path.join(out, 'index.html'), '<a href="/sheppy/">x</a>')
  await writeFile(path.join(out, 'sheppy', 'index.html'), 'ok')
  assert.deepEqual(await brokenLinks(out), [])
})

test('brokenLinks ignores fragments and query strings', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'links-'))
  await mkdir(path.join(out, 'sheppy'), { recursive: true })
  await writeFile(path.join(out, 'index.html'), '<a href="/sheppy/?x=1#top">x</a>')
  await writeFile(path.join(out, 'sheppy', 'index.html'), 'ok')
  assert.deepEqual(await brokenLinks(out), [])
})

test('staleLinks reports any href back to the site as an absolute URL', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'links-'))
  await writeFile(path.join(out, 'index.html'),
    '<a href="https://rammp-org.github.io/rammp-docs/platform">a</a>' +
    '<a href="https://rammp-org.github.io/sheppy/tui">b</a>')
  assert.equal((await staleLinks(out)).length, 2)
})

test('staleLinks ignores the site URL outside an href, such as a curl command', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'links-'))
  await writeFile(path.join(out, 'index.html'),
    '<code>curl -LsSf https://rammp-org.github.io/sheppy/install.sh | sh</code>')
  assert.deepEqual(await staleLinks(out), [])
})
```

The last two tests encode the rule: a *link* to our own site written absolutely should be a path, but the documented `curl` command is a shell command, not a link, and must keep its absolute URL.

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd website && node --test tests/check-links.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/check-links.mjs'`.

- [ ] **Step 3: Implement the checker**

Create `website/scripts/check-links.mjs`:

```js
import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE_HOST = 'rammp-org.github.io'

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
    .filter(href => href.startsWith('/') && !href.startsWith('//'))
}

function resolves(outDir, href) {
  const clean = href.split('#')[0].split('?')[0]
  const target = path.join(outDir, clean)
  return existsSync(target) || existsSync(`${target}.html`) || existsSync(path.join(target, 'index.html'))
}

export async function brokenLinks(outDir) {
  const broken = []
  for (const file of await htmlFiles(outDir)) {
    const html = await readFile(file, 'utf8')
    for (const href of internalHrefs(html)) {
      if (!resolves(outDir, href)) broken.push({ file: path.relative(outDir, file), href })
    }
  }
  return broken
}

export async function staleLinks(outDir) {
  const stale = []
  for (const file of await htmlFiles(outDir)) {
    const html = await readFile(file, 'utf8')
    for (const match of html.matchAll(/href="([^"]*)"/g)) {
      if (match[1].includes(SITE_HOST)) {
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
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `cd website && node --test tests/check-links.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add the script and run it against the real build**

In `website/package.json`, add to `scripts`:

```json
"check:links": "node scripts/check-links.mjs"
```

Run: `cd website && npm run build && npm run check:links`
Expected: `links ok`. Any failure names the exact file and href — fix the link in its source repo, do not relax the checker.

- [ ] **Step 6: Commit**

```bash
git add website/scripts/check-links.mjs website/tests/check-links.test.mjs website/package.json
git commit -m "Check internal links in the built output

Nothing else enforces the link conventions: a within-repo link written
root-absolute silently 404s once the content is mounted under a slug."
```

---

### Task 9: Search coverage check

**Files:**
- Create: `website/scripts/check-search.mjs`
- Modify: `website/package.json`

**Interfaces:**
- Consumes: `htmlFiles` from Task 8, and `out/_pagefind/pagefind-entry.json` produced by the existing `postbuild` script.
- Produces: a check that fails when pagefind's index does not cover every published page.

- [ ] **Step 1: Implement the check**

Create `website/scripts/check-search.mjs`:

```js
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
```

- [ ] **Step 2: Add the script**

In `website/package.json`, add to `scripts`:

```json
"check:search": "node scripts/check-search.mjs"
```

- [ ] **Step 3: Run it against the real build**

Run: `cd website && npm run build && npm run check:search`
Expected: PASS, printing a count that includes sheppy pages.

The `UNINDEXED` list was measured against a real build of this site: Next emits `404.html`, `404/index.html` and `_not-found/index.html`, none of which pagefind indexes. On the pre-change baseline the build produced 8 HTML files while pagefind reported `page_count: 5` — those three exclusions reconcile it exactly.

If the counts still differ, the message prints both. Identify the specific page and add it to `UNINDEXED` by path. Do not replace the equality with an inequality — the equality is what proves every composed page is searchable.

- [ ] **Step 4: Confirm cross-repo search by hand, once**

```bash
cd website && npx serve out
```

From the hub's landing page, search for a sheppy-only term such as `sheppyd`. Expected: a result under `/sheppy/`. This is the behaviour the whole design exists to produce; see it work before trusting the automated proxy for it.

- [ ] **Step 5: Commit**

```bash
git add website/scripts/check-search.mjs website/package.json
git commit -m "Check that search covers every composed page

A unified index is the main thing aggregation buys, so a page silently
missing from it should fail the build."
```

---

### Task 10: CI, dispatch, and the rebuild round trip

**Files:**
- Modify: `.github/workflows/docs.yml`
- Create (in `../sheppy`): `.github/workflows/docs-dispatch.yml`

**Interfaces:**
- Consumes: `npm test`, `npm run build`, `npm run check:links`, `npm run check:search`.
- Produces: a `docs-updated` `repository_dispatch` entry point that every source repo triggers.

- [ ] **Step 1: Add the new triggers**

In `.github/workflows/docs.yml`, replace the `on:` block with:

```yaml
on:
  push:
    branches: [main]
    paths: ['website/**', 'sources.yml', '.github/workflows/docs.yml']
  pull_request:
    paths: ['website/**', 'sources.yml', '.github/workflows/docs.yml']
  repository_dispatch:
    types: [docs-updated]
  schedule:
    - cron: '0 */6 * * *'
  workflow_dispatch:
```

The cron is a backstop: if a source repo's dispatch fails, the tree goes stale for at most six hours rather than indefinitely.

- [ ] **Step 2: Run the checks in the build job**

In the `build` job, after the `npm run build` step, add:

```yaml
      - run: npm test
      - run: npm run check:links
      - run: npm run check:search
```

`npm run build` runs compose, which clones each source repo over HTTPS. Every repo in `sources.yml` must be public for this to work without a token.

- [ ] **Step 3: Keep pull requests from deploying**

On the `deploy` job, add:

```yaml
    if: github.event_name != 'pull_request'
```

- [ ] **Step 4: Push and confirm the deployed tree**

```bash
git add .github/workflows/docs.yml
git commit -m "Build the composed tree in CI and verify it on pull requests

A source repo doc change reaches the site through repository_dispatch,
with a six-hourly cron as the backstop."
git push
gh run watch
```

Expected: the run succeeds. Then `https://rammp-org.github.io/sheppy/` serves sheppy's docs and `https://rammp-org.github.io/sheppy/install.sh` returns the script.

- [ ] **Step 5: Create the dispatch token**

Create a fine-grained personal access token scoped to the `rammp-org` organisation with `contents: read` and `metadata: read`, plus permission to dispatch on `rammp-org/rammp-org.github.io`. Add it as an organisation secret named `DOCS_DISPATCH_TOKEN`, visible to all repositories.

```bash
gh secret list --org rammp-org
```

Expected: `DOCS_DISPATCH_TOKEN` is listed.

- [ ] **Step 6: Add the dispatch workflow to sheppy**

Create `../sheppy/.github/workflows/docs-dispatch.yml`:

```yaml
name: docs dispatch

on:
  push:
    branches: [main]
    paths: ['docs/**', 'install.sh']
  workflow_dispatch:

jobs:
  dispatch:
    runs-on: ubuntu-latest
    steps:
      - uses: peter-evans/repository-dispatch@v3
        with:
          token: ${{ secrets.DOCS_DISPATCH_TOKEN }}
          repository: rammp-org/rammp-org.github.io
          event-type: docs-updated
```

```bash
cd ../sheppy && git add .github/workflows/docs-dispatch.yml
git commit -m "Rebuild the docs hub when docs change"
git push
```

- [ ] **Step 7: Verify the round trip end to end**

Push a trivial docs edit in sheppy, then:

```bash
gh run list --repo rammp-org/rammp-org.github.io --limit 3
```

Expected: a run whose event is `repository_dispatch`, and the edit visible at `https://rammp-org.github.io/sheppy/` once it finishes. This is the check that the coupling actually works — without it, sheppy's docs only publish on the six-hourly cron.

---

### Task 11: Mount dojo and the module template

**Files:**
- Modify: `sources.yml`, `website/content/_meta.js`, `website/.gitignore`
- Create (in `../dojo`): `docs/index.md`, `docs/_meta.js`, `.github/workflows/docs-dispatch.yml`
- Create (in `../rammp-module-template`): `docs/index.md`, `docs/_meta.js`, `.github/workflows/docs-dispatch.yml`

**Interfaces:**
- Consumes: everything from Tasks 2–10.
- Produces: a three-repo tree.

- [ ] **Step 1: Give dojo a landing page and an order**

Create `../dojo/docs/index.md`:

```markdown
# Dojo

The Dojo is the arm cell: a Kinova arm, its cameras, and the props on the
bench. These pages cover getting access, what is in the cell, and how the
cameras are set up.
```

Create `../dojo/docs/_meta.js`:

```js
export default {
  index: 'Overview',
  'the-cell': 'The cell',
  cameras: 'Cameras',
  'git-access': 'Git access'
}
```

- [ ] **Step 2: Give the module template the same**

Create `../rammp-module-template/docs/index.md`:

```markdown
# Module template

Scaffolding for a RAMMP module: a Dockerfile, a fragment declaring what the
module speaks, and the tests that check it.
```

Create `../rammp-module-template/docs/_meta.js`:

```js
export default {
  index: 'Overview',
  interface: 'The interface'
}
```

- [ ] **Step 3: Add the dispatch workflow to both repos**

Copy `../sheppy/.github/workflows/docs-dispatch.yml` into each, changing the `paths` list to drop `install.sh`:

```yaml
    paths: ['docs/**']
```

- [ ] **Step 4: Add both to the manifest**

Append to `sources.yml`:

```yaml
- repo: rammp-org/dojo
  slug: dojo
  title: Dojo

- repo: rammp-org/rammp-module-template
  slug: module-template
  title: Module template
```

- [ ] **Step 5: Mount them in the sidebar and ignore their output**

Add to `website/content/_meta.js`, after `sheppy`:

```js
  dojo: 'Dojo',
  'module-template': 'Module template'
```

Append to `website/.gitignore`:

```
content/dojo/
content/module-template/
public/dojo/
public/module-template/
```

- [ ] **Step 6: Confirm Markdown pages render**

```bash
cd website && npm run build && npm run check:links && npm run check:search
ls out/dojo/cameras/index.html out/module-template/interface/index.html
```

Expected: all commands succeed and both paths exist. Dojo and the module template ship `.md` rather than `.mdx`; this is the step that proves Nextra routes them. If they do not render, rename the files to `.mdx` — the content needs no other change.

Note that `check-search` still measures composed pages by the `sheppy/` prefix only. Update that filter to count every mounted slug:

```js
const slugs = ['sheppy', 'dojo', 'module-template']
const composed = pages.filter(file =>
  slugs.some(slug => path.relative(outDir, file).startsWith(`${slug}${path.sep}`)))
```

- [ ] **Step 7: Commit all three repos**

```bash
cd ../dojo && git add -A && git commit -m "Add a docs landing page, ordering and rebuild dispatch" && git push
cd ../rammp-module-template && git add -A && git commit -m "Add a docs landing page, ordering and rebuild dispatch" && git push
cd ../rammp-docs && git add sources.yml website/content/_meta.js website/.gitignore website/scripts/check-search.mjs
git commit -m "Mount dojo and the module template

Three repos now publish into one tree with one search index."
git push
```

- [ ] **Step 8: Verify the deployed tree**

```bash
gh run watch --repo rammp-org/rammp-org.github.io
```

Expected: `https://rammp-org.github.io/` shows the hub pages plus `sheppy`, `Dojo` and `Module template` sections, and searching a dojo-only term such as `cameras` from the landing page returns a `/dojo/` result.
