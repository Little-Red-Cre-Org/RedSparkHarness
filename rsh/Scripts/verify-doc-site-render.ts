/**
 * Verify that VitePress server rendering produced page markup. A render error
 * inside VitePress's SSR pass is logged rather than thrown, so a broken Vue
 * runtime still exits 0 and writes every page with an empty `#app` (or a
 * document layout without its content) while link and fragment checks pass.
 *
 * Locale home pages render only VitePress's `<Content />` container: their
 * projection keeps frontmatter alone (`layout: false` plus a redirect), so
 * markup, not text, is what a healthy build emits there. Every other page except
 * the client-rendered `404.html` must carry document text.
 *
 * This runs as part of `docs:build` and can also run directly after a build
 * with `tsx rsh/Scripts/verify-doc-site-render.ts`.
 */

import { globSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { JSDOM } from 'jsdom'
import { docsPages } from '../Docs/website/docs.ts'

const root = resolve(import.meta.dirname, '..', '..')

/** One built page whose server-rendered markup is missing or empty. */
export interface EmptySiteRender {
  /** Site-relative HTML file. */
  file: string
  /** Why the page does not count as rendered. */
  reason: string
}

/** Result of checking the server-rendered markup of every built page. */
export interface SiteRenderReport {
  /** Number of server-rendered HTML pages inspected. */
  checked: number
  /** Pages, including absent home pages, without rendered markup. */
  empty: EmptySiteRender[]
}

function posixPath(path: string): string {
  return path.split(sep).join('/')
}

function excerpt(markup: string): string {
  const compact = markup.replace(/\s+/g, ' ').trim()
  return JSON.stringify(compact.length > 80 ? `${compact.slice(0, 80)}…` : compact)
}

function hasText(element: Element | null): boolean {
  return (element?.textContent ?? '').trim() !== ''
}

// VitePress writes the not-found page with an empty `#app` and renders it in the browser.
const clientRenderedPages = new Set(['404.html'])

function emptyReason(html: string, home: boolean): string | undefined {
  const app = new JSDOM(html).window.document.getElementById('app')
  if (app === null) return 'no #app container'
  if (app.childElementCount === 0) return `#app has no rendered markup: ${excerpt(app.innerHTML)}`
  if (home) return undefined
  return hasText(app.querySelector('.vp-doc')) ? undefined : '#app renders no document content (.vp-doc is absent or empty)'
}

/**
 * Locale home pages as built HTML files: the publication manifest entries
 * without a sidebar, which VitePress renders with `layout: false`.
 *
 * @returns Site-relative HTML files, one per locale home.
 */
export function homePageFiles(): string[] {
  return docsPages.filter(page => page.sidebar === null).map(page => page.route.replace(/\.md$/, '.html')).sort()
}

/**
 * Check the server-rendered `#app` markup of every page in a VitePress output directory.
 *
 * @param distRoot - Directory containing generated HTML files.
 * @param homeFiles - Site-relative home pages that must exist and render the content container.
 * @returns Counted pages and every page whose render is missing or empty.
 * @throws When the directory contains no HTML files.
 */
export function inspectSiteRender(distRoot: string, homeFiles: readonly string[]): SiteRenderReport {
  const files = globSync('**/*.html', { cwd: distRoot }).map(posixPath).sort()
  if (files.length === 0) {
    throw new Error(`verify-doc-site-render: no HTML files found under ${distRoot}; run docs:build first.`)
  }
  const homes = new Set(homeFiles)
  const empty: EmptySiteRender[] = homeFiles
    .filter(file => !files.includes(file))
    .map(file => ({ file, reason: 'home page was not emitted' }))
  let checked = 0
  for (const file of files) {
    if (clientRenderedPages.has(file)) continue
    checked++
    const reason = emptyReason(readFileSync(resolve(distRoot, file), 'utf8'), homes.has(file))
    if (reason !== undefined) empty.push({ file, reason })
  }
  return { checked, empty }
}

function main(): number {
  const distRoot = resolve(root, 'rsh/Docs/website/.dist')
  const homes = homePageFiles()
  const report = inspectSiteRender(distRoot, homes)
  if (report.empty.length === 0) {
    console.log(
      `verify-doc-site-render: ${report.checked} page(s) carry server-rendered markup,`
      + ` including home page(s) ${homes.join(', ')}.`,
    )
    return 0
  }
  console.error(`verify-doc-site-render: ${report.empty.length} page(s) without server-rendered markup:`)
  // Home pages first: they are the pages a reader lands on.
  const ordered = [
    ...report.empty.filter(item => homes.includes(item.file)),
    ...report.empty.filter(item => !homes.includes(item.file)),
  ]
  for (const item of ordered.slice(0, 20)) console.error(`  ${item.file}: ${item.reason}`)
  if (report.empty.length > 20) console.error(`  … and ${report.empty.length - 20} more`)
  console.error('A VitePress render error is logged, not thrown; check the build log and that vue and every @vue/* package resolve to one version.')
  return 1
}

if (import.meta.main) process.exitCode = main()
