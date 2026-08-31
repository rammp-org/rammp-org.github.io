import nextra from 'nextra'

const withNextra = nextra({
  defaultShowCopyCode: true
})

// Static export for GitHub Pages at the org root (https://rammp-org.github.io).
// Set DOCS_BASE_PATH="/some-prefix" to build under a subpath.
const basePath = process.env.DOCS_BASE_PATH ?? ''

export default withNextra({
  output: 'export',
  basePath,
  images: { unoptimized: true },
  trailingSlash: true
})
