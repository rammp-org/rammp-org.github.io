import nextra from 'nextra'

const withNextra = nextra({
  defaultShowCopyCode: true
})

// Static export for GitHub Pages (https://rammp-org.github.io/rammp-docs).
// Set DOCS_BASE_PATH="" to build for a root domain / local preview.
const basePath = process.env.DOCS_BASE_PATH ?? '/rammp-docs'

export default withNextra({
  output: 'export',
  basePath,
  images: { unoptimized: true },
  trailingSlash: true
})
