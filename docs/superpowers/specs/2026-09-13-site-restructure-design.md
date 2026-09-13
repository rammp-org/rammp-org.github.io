# Docs site restructure — design

Date: 2026-09-13

## Goal

Reorganize rammp-org.github.io so a developer can find, in order: what the
robot is, what software versions it runs, how to set up a machine, how to
work day to day, how to publish a module, and which modules exist. Every
page rewritten in the register of the sheppy docs: plain statements, tables,
commands, no placeholders, no exclamation marks.

## Site structure

Top-level nav, in order. Sidebar folders start collapsed
(`defaultMenuCollapseLevel: 1`).

| Slug | Title | Change |
| --- | --- | --- |
| `index` | Introduction | Rewrite lead to point at Development flow first |
| `platform` | RAMMP Gen 1.5 hardware | Remove the Software baseline table; link to Software versions |
| `software` | Software versions & core repos | New |
| `setup` | Developer setup | Keep; repoint links |
| `development` | Development flow | New folder. Guide content arrives from the user separately. `git-workflow` moves here now. |
| `publishing` | Publishing a module | Renamed from `contributing`. Pages below. |
| `interfaces` | Interfaces | Becomes a folder: overview, `rammp-interfaces-ros2` spec, link to arm interface |
| `sheppy` | sheppy | Composed, unchanged |
| `kinova-gen3-ros2` | Controlling the arm | Composed, unchanged |
| `modules` | Modules registry | New |

Redirect handling: the site is a static export with no server. Old
`/contributing/*` URLs will 404. Add a `contributing/index.mdx` stub that
links to the new locations, so inbound links from the composed repos or
external notes still land somewhere useful. Remove it after one release
cycle.

## Pages

### Software versions & core repos (`software.mdx`)

Two tables and nothing else.

**Versions.** One row per pinned thing. Values known from the repos today:

| Thing | Value | Source |
| --- | --- | --- |
| JetPack | 6.1 or newer, not 6.0 | RAMMP-docker README |
| Jetson Linux | r36.4.x | RAMMP-docker README |
| Ubuntu | 22.04 arm64 | RAMMP-docker README |
| Kernel | 5.15 PREEMPT_RT | platform page |
| CUDA | 12.6 | RAMMP-docker |
| Docker Engine | unknown, to be pinned | setup page placeholder |
| ROS 2 | Humble | RAMMP-docker |
| RMW | Cyclone DDS | RAMMP-docker |
| Python | 3.10 | RAMMP-docker README |
| rammp-base / rammp-cuda | 1.0.0-jp6 | RAMMP-docker Makefile |
| rammp-interfaces-ros2 | v1.0.0 | RAMMP-docker Makefile |
| sheppy | installed from main via install.sh | sheppy docs |

Rows whose value is not known (Docker Engine, exact JetPack on the chair)
say so in the cell rather than carrying a placeholder token.

**Core repos.** The repos you clone to stand the robot and dev environment
up. One row each: repo (linked), what it is for, what depends on it.

- rammp-deployments
- RAMMP-docker
- rammp-interfaces-ros2
- sheppy
- kinova-gen3-driver
- kinova-gen3-ros2
- rammp-suite-software

### RAMMP Gen 1.5 hardware (`platform.mdx`)

Delete the Software baseline subsection. Keep the Real-time subsection but
shorten it to why the chair needs a PREEMPT_RT kernel, linking to Software
versions for the kernel and to Developer setup for the tuning. Keep the
photo placeholders as they are; they are for the user to fill.

### Development flow (`development/`)

Folder with `_meta.js`, an `index.mdx` stub, and `git-workflow.mdx` moved
from contributing. The index is one paragraph saying the guide is coming and
linking to Git workflow, so the build does not ship an empty folder. The
guide itself is written when the user sends it and is out of scope here.

### Publishing a module (`publishing/`)

| Page | Content |
| --- | --- |
| `index` | What publishing means: repo → image on GHCR → manifest entry → docs mounted. The existing diagram and stage table, trimmed. |
| `base-images` | `rammp-base` vs `rammp-cuda`, what each contains, which to pick, the torch warning, how base image releases are cut (tag → CI → GHCR). Source: current how-to sections 1 and "How a release reaches the robot". |
| `build-and-publish` | Module Dockerfile from the RAMMP-docker template, the entrypoint, local build, smoke test, tag and CI to GHCR, run on the robot with the three flags. Source: current how-to "Create a new module" onward. |
| `deploy` | New. Add a node to the rammp-deployments manifest: the node entry, the real and mock alternatives, `publishes`, the container flags the camera nodes use, and `sheppy up` to confirm. Written from `december_2026/sheppy-manifest.yaml`. |
| `checklist` | Trim to repo, image, deployment, docs, PR. Fix `rammp-module-template` to the RAMMP-docker templates. Drop the fill-in review table. |

Remove from this section: `git-workflow` (to Development flow),
`rammp-interfaces` (to Interfaces).

### Interfaces (`interfaces/`)

Becomes a folder.

| Page | Content |
| --- | --- |
| `index` | What an interface is, the two packages in rammp-interfaces-ros2, link to the arm's interface reference. |
| `rammp-interfaces-ros2` | Rewrite of the current spec page against the real repo: the two packages, the line between them, the versioning table, how to pin it in a module. No placeholder tables. Source: the repo README. |

### Modules registry (`modules.mdx`)

Curated by hand. Intro sentence says so and says how to add a row. One
table:

| Module | What it does | Image | Interfaces used | Maintainer |
| --- | --- | --- | --- | --- |

Seed rows: RAMMP-CuRobo, kinova-quest-teleop. Maintainer column left blank
where the repo does not say.

### Introduction (`index.mdx`)

Rewrite the lead and the cards to match the new nav. Order: hardware,
software versions, setup, development flow, publishing, modules registry.

## Style

The sheppy docs are the reference. Concretely:

- One statement per sentence. No "it's time to", no "feel free", no
  exclamation marks.
- Tables for anything with more than two parallel facts.
- Commands in fenced blocks, not in prose.
- No `_[bracketed placeholder]_` tokens or "Fill in" blockquotes. Where a
  fact is unknown, the page says it is unknown.
- Run each rewritten page through unslop before committing.

## Out of scope

- The Development flow guide content.
- The RAMMS simulation repos and firmware repos. They are not modules or
  core repos in the sense above. A third group can be added later.
- Any change to the composed repos' docs.

## Verification

`npm run build && npm test && npm run check:links && npm run check:search`
pass. Every page in the nav renders. No page contains `_[` or `Fill in`.
The old `/contributing/` URL renders the redirect stub.
