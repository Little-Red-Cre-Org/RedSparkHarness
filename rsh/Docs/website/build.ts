/** Production documentation-site build with project-owned output preparation. */

import { lstatSync, realpathSync, rmSync, unlinkSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { format } from 'node:util'
import { build } from 'vitepress'

const websiteRoot = resolve(import.meta.dirname)
type DocSiteBuildOptions = NonNullable<Parameters<typeof build>[1]>

function escapesRoot(root: string, candidate: string): boolean {
  const child = relative(root, candidate)
  return child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)
}

function nearestExistingAncestor(path: string): string {
  let ancestor = path
  for (;;) {
    if (lstatSync(ancestor, { throwIfNoEntry: false }) !== undefined) return ancestor
    const parent = dirname(ancestor)
    if (parent === ancestor) {
      throw new Error(`rsh/Docs/website/build: no existing ancestor found for ${JSON.stringify(path)}.`)
    }
    ancestor = parent
  }
}

/**
 * Remove one documentation build output without traversing a link-shaped output or an outside parent.
 * @param siteRoot - VitePress site root that owns the output.
 * @param outDir - Resolved VitePress output directory.
 * @throws When `outDir` is not a proper child of `siteRoot` or its existing parent resolves outside it.
 */
export function cleanDocSiteOutput(siteRoot: string, outDir: string): void {
  const root = resolve(siteRoot)
  const output = resolve(outDir)
  const child = relative(root, output)
  if (child === '' || escapesRoot(root, output)) {
    throw new Error(`rsh/Docs/website/build: output directory ${JSON.stringify(output)} must be a child of site root ${JSON.stringify(root)}.`)
  }

  const realRoot = realpathSync(root)
  const realParent = realpathSync(nearestExistingAncestor(dirname(output)))
  if (escapesRoot(realRoot, realParent)) {
    throw new Error(`rsh/Docs/website/build: output directory ${JSON.stringify(output)} must resolve inside site root ${JSON.stringify(realRoot)}.`)
  }

  const outputStats = lstatSync(output, { throwIfNoEntry: false })
  if (outputStats?.isSymbolicLink()) {
    unlinkSync(output)
    return
  }
  rmSync(output, { recursive: true, force: true })
}

/**
 * Create VitePress build options that remove the resolved output directory before bundling.
 * @param siteRoot - VitePress site root to build.
 * @param mpa - Whether to use VitePress's multi-page application build.
 * @returns VitePress options with project-owned output preparation.
 */
export function docSiteBuildOptions(siteRoot: string, mpa: boolean): DocSiteBuildOptions {
  const root = resolve(siteRoot)
  return {
    ...mpa ? { mpa: 'true' } : {},
    onAfterConfigResolve(siteConfig) {
      cleanDocSiteOutput(root, siteConfig.outDir)
    },
  }
}

/**
 * Errors Vue and VitePress log, instead of throwing, while server rendering a
 * page; each one leaves that page's `#app` empty or partial in a build that
 * still succeeds.
 */
export const ssrRenderErrorSignatures: readonly RegExp[] = [
  /vitepress data not properly injected in app/,
  /Cannot read properties of null \(reading 'ce'\)/,
]

/**
 * Run a build and fail it when server rendering logged a known render error.
 * Messages still reach the original `console.error`.
 * @param run - Build to observe.
 * @returns The build's result.
 * @throws When any `console.error` call during `run` matches {@link ssrRenderErrorSignatures}.
 */
export async function failOnSsrRenderErrors<T>(run: () => Promise<T>): Promise<T> {
  const original = console.error
  const matched: string[] = []
  console.error = (...args: unknown[]) => {
    const message = format(...args)
    if (ssrRenderErrorSignatures.some(signature => signature.test(message))) matched.push(message.split('\n')[0] ?? message)
    original.apply(console, args)
  }
  try {
    const result = await run()
    if (matched.length > 0) {
      throw new Error(
        `rsh/Docs/website/build: server rendering logged ${matched.length} render error(s), so pages were written without content: `
        + `${[...new Set(matched)].slice(0, 3).join('; ')}. Check that vue and every @vue/* package resolve to one version.`,
      )
    }
    return result
  } finally {
    console.error = original
  }
}

async function buildDocSite(siteRoot: string, mpa: boolean): Promise<void> {
  const root = resolve(siteRoot)
  await failOnSsrRenderErrors(() => build(root, docSiteBuildOptions(root, mpa)))
}

function parseMpa(args: string[]): boolean {
  if (args.length === 0) return false
  if (args.length === 1 && args[0] === '--mpa') return true
  throw new Error(`rsh/Docs/website/build: expected no arguments or --mpa, got ${JSON.stringify(args)}.`)
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  await buildDocSite(websiteRoot, parseMpa(process.argv.slice(2)))
}
