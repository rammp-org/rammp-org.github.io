# RAMMP docs site

[Nextra](https://nextra.site) (docs theme) + Next.js, statically exported and
deployed to GitHub Pages at <https://rammp-org.github.io/rammp-docs> by
`.github/workflows/docs.yml` on every push to `main` that touches `website/`.

Content lives in `content/` as MDX; `_meta.js` files control sidebar order and
titles.

```bash
npm install
npm run dev                          # http://localhost:3000/rammp-docs
npm run build                        # static export -> out/ (+ pagefind index)
DOCS_BASE_PATH= npm run build && npm start   # preview without the /rammp-docs prefix
```

Note: `zod` is pinned to 4.1.x via `overrides` — nextra-theme-docs 4.6 breaks
on newer zod.
