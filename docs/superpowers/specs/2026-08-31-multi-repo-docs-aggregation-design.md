# Multi-repo docs aggregation

Date: 2026-08-31
Status: approved, not yet implemented

## Problem

RAMMP is a polyrepo, and its documentation has followed suit. `rammp-docs` and
`sheppy` each carry a full, near-identical Nextra 4 site: same `next.config.mjs`,
same `app/layout.jsx`, same dependency set, same Pages workflow. Each deploys
separately, to `rammp-org.github.io/rammp-docs` and `rammp-org.github.io/sheppy`.
Three more repos — `dojo`, `rammp-deployments`, `rammp-module-template` — hold
`docs/` directories that are published nowhere.

Two costs follow. The scaffold is duplicated per repo, so every theme or
dependency change is an N-repo change. And the sites are strangers to each
other: searching sheppy's docs cannot find the platform overview, and the
sidebar in one site has no idea the other exists.

`rammp-docs` is meant to be the parent of everything. Today it is a peer that
links out.

## Goals

- One published tree that spans every RAMMP repo, with a single sidebar and a
  single search index.
- The site scaffold exists in exactly one place.
- A doc author writes markdown in their own repo and nothing else, and can
  preview it locally.
- Nothing forecloses giving a repo its own standalone site later.

## Non-goals

- Versioned documentation or a version switcher.
- Publishing docs from anything other than the `main` branch.
- Migrating away from Nextra, or changing how any existing page is authored.
- Standalone per-repo sites in this iteration. See Deferred.

## Decisions

**Audience.** sheppy is designed for use beyond RAMMP, and RAMMP itself is meant
for the broader community; other repos are internal. The architecture must
therefore keep a standalone render cheap to add, even though it does not build
one yet.

**URLs.** `rammp-docs` is renamed to `rammp-org.github.io`, making it the org
Pages site. The hub then serves from the org root: `rammp-org.github.io/` for
its landing page, `rammp-org.github.io/sheppy` for sheppy's docs. `basePath` is
empty in every build.

The rename is what makes the parent actually parental. `rammp-org.github.io/sheppy`
stays a working URL as a side effect, answered by the hub rather than by
sheppy's Pages. The `/rammp-docs` URL disappears, which is free — the site is
days old and nothing links to it.

**One owner per path.** A project Pages site takes precedence over the org
site's same-named path, so sheppy cannot both deploy its own Pages and have the
hub own `/sheppy`. Sheppy therefore disables its Pages deploy. This is the
concession the root hub costs, and it is a cheap one right now: a "standalone"
sheppy hosted at the RAMMP org's own `github.io` does not read as an independent
tool anyway. Sheppy's independent identity wants its own domain, so the
standalone render is worth building when there is a domain to put it on.

**Freshness.** Child docs track `main`. Docs stay current with code and a typo
fix publishes in minutes. The accepted risk is that docs may describe unreleased
behaviour, which is tolerable while the platform is pre-1.0 and readers are
collaborators. Pinning to release tags was rejected because it would require a
release cadence in repos that have none.

**Composition over federation.** The hub build pulls content from source repos
and renders one site. The alternative — every repo keeps its own site behind a
path-routing proxy — preserves deploy independence but delivers neither unified
search nor a unified sidebar, and keeps the duplicated scaffolds.

This couples publishing: a child's doc change requires a hub rebuild. That is
acceptable because the coupling is in publishing, not in content. Content stays
in each source repo, so decoupling later means giving that repo a workflow that
builds the shared scaffold against its own `docs/`.

**Trust boundary.** Composing a source repo's MDX and `_meta.js` into the hub
means Nextra executes them during the hub's Pages-deploying build: MDX compiles
to JS that runs at build time, and `_meta.js` is `import()`ed directly. So
anyone who can push to `main` in a mounted repo can run code in the hub's build
job and publish whatever that code produces at the org root — the composed
tree carries no sandboxing between sources. That is fine for org-internal
repos, where push access to `main` is already a trusted position. It is the
fact that decides whether a repo outside the org's control could ever be
mounted: it could not, without first adding review or sandboxing between
compose and build.

## Architecture

### Repo roles

**Source repos** (`sheppy`, `dojo`, `rammp-module-template`, future module
repos) own a `docs/` directory: MDX or Markdown files plus a `_meta.js`
describing their own ordering. `rammp-deployments` is not mounted yet — its
`docs/` holds only `superpowers/`, so it has nothing to publish. They carry no docs-site
scaffold: no Nextra app, no site `package.json`, no `node_modules`, no Pages
workflow.

**The hub** (`rammp-org.github.io`, renamed from `rammp-docs`) owns everything
else.

```
sources.yml                    # which repos mount where
website/
  scripts/compose.mjs          # pulls docs/ from each source into the tree
  app/                         # the one Nextra app
  content/                     # hub-owned pages (index, platform, interfaces, ...)
  content/<slug>/              # generated by compose, gitignored
  next.config.mjs
  package.json
.github/workflows/
  docs.yml                     # build + deploy
```

### sources.yml

The whole configuration of the tree:

```yaml
- repo: rammp-org/sheppy
  slug: sheppy
  ref: main
  title: sheppy
  assets: [install.sh]        # copied verbatim into out/sheppy/
  exclude: [superpowers]      # default; internal specs and plans
- repo: rammp-org/dojo
  slug: dojo
  ref: main
  title: Dojo
```

`exclude` names subdirectories of `docs/` that are not published. It defaults
to `[superpowers]`, because every repo already keeps its design specs and
implementation plans in `docs/superpowers/` — process records, not user docs.
The hub's own `docs/` follows the same convention.

`assets` lists files outside `docs/` that a source repo needs served alongside
its docs. Sheppy is the case: its docs say `curl -LsSf
https://rammp-org.github.io/sheppy/install.sh | sh`, and that file reaches the
web through a postbuild `cp` in sheppy's site today. The hub takes over serving
it so the documented install command keeps working.

Adding a repo to the tree is one entry here plus one entry in the hub's
`website/content/_meta.js`.

The hub never appears in `sources.yml`. Its own `docs/` holds specs like this
one, not site content; the hub's pages live in `website/content/`.

### compose.mjs

Runs before `next build`, and clears `website/content/<slug>/` for every slug
before writing so removed pages do not linger.

**CI mode.** Shallow-clones each source at its `ref` (`--depth=1
--filter=blob:none`), copies `docs/` to `website/content/<slug>/`.

**Local mode.** If a sibling checkout exists — `../sheppy/docs`, which is how
`~/atdev` is already laid out — compose copies it into `website/content/<slug>/`
instead of cloning, the same way CI does. This preserves local preview for doc
authors, who otherwise lose it when their repo sheds its scaffold: edit
`~/atdev/sheppy/docs/install.mdx`, re-run `npm run dev` (or `npm run compose`),
and the hub's dev server shows it at `/sheppy/install`. One dev server covers
the whole tree, but there is no watcher — `npm run dev` composes once at
startup, so seeing a further edit to a source repo means re-running compose
(or restarting `dev`) yourself.

The Architecture originally called for symlinking the sibling checkout instead
of copying, for zero-latency local preview. That did not ship: Turbopack (Next's
dev bundler) cannot resolve page modules through symlinks, so a symlinked
sibling's pages 404 in `next dev`. Copying is what actually works today. If a
watcher is built later to remove the manual re-run step, it must keep copying
rather than reintroduce symlinking — a symlinked source tree would make
`injectEditUrls` write `editUrl` frontmatter directly into the doc author's own
working tree, corrupting the file they're editing.

**Assets.** Each source's `assets` entries are copied from the repo root into
`website/public/<slug>/`, so they land at `out/<slug>/<name>` beside its docs.

**Frontmatter injection.** Each copied file gets an `editUrl` frontmatter field
pointing at its source repo's edit page, e.g.
`https://github.com/rammp-org/sheppy/edit/main/docs/install.mdx`. The layout
renders "Edit this page" from that field, so a sheppy page sends the reader to
the sheppy repo rather than to the hub. Nextra's global `docsRepositoryBase`
cannot express this, since it is set once for the whole site.

**Validation.** compose fails the build when:

- a slug in `sources.yml` has no entry in the hub's `website/content/_meta.js`
  (it would render, but be unreachable from the sidebar);
- a source repo has no `docs/` directory at its ref;
- a copied file links to another repo's docs with an absolute URL instead of a
  path within the tree. The hub's `content/index.mdx` has one such link to
  sheppy today.

### Link conventions

Everything renders in one build from one root, so:

- **Within a repo: relative.** `./config` in a sheppy page resolves to
  `/sheppy/config`. A root-absolute `/config` would wrongly point at the hub's
  own page of that name.
- **Across repos: root-absolute.** `/platform` from a sheppy page, `/sheppy/install`
  from a hub page.

The link checker in Verification is what enforces both, since either mistake
produces a 404 in the built output.

### Deploys and triggering

- Pages deploys from the hub repo, serving `rammp-org.github.io/`. `basePath`
  is empty; the existing `DOCS_BASE_PATH` variable stays in `next.config.mjs`
  so a future custom domain or path move is a workflow input change.
- Sheppy's Pages deploy is disabled, freeing `/sheppy` for the hub.
- A source repo push to `main` touching `docs/**` fires a `repository_dispatch`
  at the hub. This needs one fine-grained org PAT with permission to dispatch on
  the hub repo.
- A six-hourly cron on the hub is the backstop, so a dispatch that fails
  silently costs staleness rather than a stalled tree.

## Verification

Run in CI on pull requests, without deploying:

1. `npm run compose && npm run build` emits `out/sheppy/index.html`.
2. The pagefind index returns hits for a sheppy-only term and for a hub-only
   term. This is the check that proves search actually spans repos, which is the
   main thing the aggregation buys.
3. A link checker over `out/` reports zero broken internal links.
4. `out/` contains no reference to `rammp-org.github.io/rammp-docs`.
5. `out/sheppy/install.sh` exists, so the documented install command works.

## Migration

In order, each step independently verifiable:

1. Rename `rammp-docs` to `rammp-org.github.io` on GitHub and update the local
   remote. Confirm Pages serves the existing site at the org root with
   `DOCS_BASE_PATH=""`.
2. Add `sources.yml`, `scripts/compose.mjs`, gitignore entries, and hub
   `_meta.js` entries. Mount sheppy from a sibling checkout and verify locally.
3. Wire compose into `docs.yml`; confirm the deployed hub serves `/sheppy`.
4. sheppy: move `website/content/` to `docs/`, replacing the existing
   `docs/index.md` (a pointer page to the old standalone site) with the moved
   `index.mdx`, and leaving `docs/superpowers/` in place. Delete `website/` (including the
   postbuild `cp` that publishes `install.sh`, now handled by `assets`), delete
   its `docs.yml`, disable its Pages deploy, add the dispatch workflow. Move the
   guidance in `website/AGENTS.md` and `website/CLAUDE.md` to the new location.
   Rewrite its outbound links per the conventions above.
5. Add `dojo` and `rammp-module-template` to `sources.yml`, writing a
   `_meta.js` for each — neither has one. Mount `rammp-deployments` once it has
   user-facing docs.

Sheppy is early enough that brief breakage during the migration is acceptable;
these steps do not need to be choreographed to avoid it.

## Deferred

- **Standalone per-repo sites.** Revisit when a custom domain exists, at which
  point sheppy can publish to `sheppy.<domain>`. The mechanism: a `workflow_call`
  workflow in the hub that builds the shared scaffold against one repo's `docs/`,
  which that repo calls in ~8 lines. Splitting a repo out also means converting
  its cross-repo root-absolute links to absolute canonical URLs — mechanical, and
  the link checker finds them.
- **A custom domain.** Would let the hub serve a root it fully controls, so a
  child could hold both a section in the tree and its own subdomain — the
  configuration the `github.io` one-owner-per-path rule forbids today.
- **Versioned docs.** Nextra supports parallel content trees; revisit when
  something ships to outside users on a release cadence.
- **Auto-discovering source repos** by GitHub topic instead of listing them in
  `sources.yml`. Worth it at a dozen module repos, not at four.

## To resolve during implementation

- ~~Whether Next's dev watcher reliably picks up edits through symlinked content
  directories. If it does not, local mode falls back to copying plus a watcher
  that re-runs compose on change.~~ Resolved: Turbopack cannot resolve page
  modules through a symlinked content directory, so local mode copies (see
  Local mode above). The watcher was not built; `npm run dev` composes once,
  and a doc author re-runs it to pick up further edits in the source repo.
