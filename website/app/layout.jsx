import { Footer, Layout, Navbar } from 'nextra-theme-docs'
import { Head } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import 'nextra-theme-docs/style.css'

export const metadata = {
  title: { default: 'RAMMP', template: '%s – RAMMP' },
  description: 'Documentation for the RAMMP assistive robotics platform.'
}

const navbar = (
  <Navbar
    logo={<span style={{ fontWeight: 700 }}>RAMMP</span>}
    projectLink="https://github.com/rammp-org"
  />
)

const footer = <Footer>RAMMP {new Date().getFullYear()}</Footer>

export default async function RootLayout({ children }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head />
      <body>
        <Layout
          navbar={navbar}
          pageMap={await getPageMap()}
          docsRepositoryBase="https://github.com/rammp-org/rammp-org.github.io/tree/main/website"
          footer={footer}
          editLink="Edit this page on GitHub"
          sidebar={{ defaultMenuCollapseLevel: 2 }}
        >
          {children}
        </Layout>
      </body>
    </html>
  )
}
