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
