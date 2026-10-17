import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import type { Plugin, PluginOption, UserConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { clientBuildEnvironmentDefines } from '../../../Scripts/client-build-environment.ts'

const src = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url))
const STANDALONE_ERROR = 'rsh/Programs/Web/application is not a standalone application: bare Vite cannot inject window.__DSH_BOOT__. '
  + 'From a repository checkout, run `pnpm dsh web`; an installed package uses `dsh web`. '
  + 'For client-plugin HMR, run `pnpm dsh web` together with `pnpm run dev:web`.'

const CORDIS_BROWSER_PACKAGES = new Set([
  '@deepseek-ai/cordis', '@deepseek-ai/cordis-plugin-group', '@deepseek-ai/cordis-plugin-hmr',
  '@deepseek-ai/cordis-plugin-include', '@deepseek-ai/cordis-plugin-loader',
  '@deepseek-ai/cordis-plugin-logger-console', '@deepseek-ai/cordis-plugin-timer',
])
const CORDIS_VENDOR_SOURCE = /(?:^|\/)rsh\/Core\/vendor\/(?:cordis|group|hmr|include|loader|logger-console|timer)(?:\/|$)/i

/** Resolve a package name from Vite's module id, including pnpm's nested layout. */
function npmPackageOf(id: string): string | undefined {
  const normalized = id.replaceAll('\\', '/')
  const packagePath = normalized.includes('/node_modules/')
    ? normalized.split('/node_modules/').at(-1)
    : normalized.startsWith('@deepseek-ai/') ? normalized : undefined
  if (packagePath === undefined) return undefined
  const [first, second] = packagePath.split('/')
  if (first === undefined) return undefined
  if (first.startsWith('@')) return second === undefined ? undefined : `${first}/${second}`
  return first
}

/** Reject Cordis packages and vendored source from the default browser graph. */
function nativeBrowserGraphPlugin(): Plugin {
  return {
    name: 'dsh-native-browser-graph',
    buildEnd() {
      const forbidden = [...this.getModuleIds()].filter(id => {
        const normalized = id.replaceAll('\\', '/')
        return CORDIS_BROWSER_PACKAGES.has(npmPackageOf(id) ?? id) || CORDIS_VENDOR_SOURCE.test(normalized)
      })
      if (forbidden.length > 0) {
        throw new Error(`native browser graph contains Cordis modules: ${forbidden.join(', ')}`)
      }
    },
  }
}
const DEFAULT_CLIENT_TITLE = 'RedSpark Harness'

/** Escape build-time text before placing it in the HTML title element. */
function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Project the public build title into the initial HTML document. */
function clientDocumentTitle(): Plugin {
  const title = escapeHtmlText(process.env.DSH_CLIENT_TITLE ?? DEFAULT_CLIENT_TITLE)
  return {
    name: 'dsh-client-document-title',
    transformIndexHtml(html) {
      return html.replace('<title>RedSpark Harness</title>', `<title>${title}</title>`)
    },
  }
}

/** Fail before a Vite dev or preview server can expose a shell without its Host bootstrap. */
function rejectStandaloneServe(): Plugin {
  return {
    name: 'dsh-reject-standalone-web-serve',
    config(_config, env) {
      if (env.command === 'serve') throw new Error(STANDALONE_ERROR)
    },
  }
}

/** Add the worker bootstrap entry to the separately published preview page. */
function emitPreviewPage(): Plugin {
  let bootstrapFile: string | undefined
  let write = true
  let outDir = src('./dist')
  return {
    name: 'dsh-emit-preview-page',
    configResolved(config) {
      write = config.build.write
      outDir = config.build.outDir
    },
    generateBundle(_options, bundle) {
      if (!write) return
      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk' && item.isEntry && item.name === 'bootstrap') bootstrapFile = item.fileName
      }
      if (bootstrapFile === undefined) throw new Error('vite: preview bootstrap entry missing from the bundle')
    },
    async closeBundle() {
      if (!write || bootstrapFile === undefined) return
      const page = await readFile(join(outDir, 'index.html'), 'utf8')
      const anchor = page.indexOf('<script type="module"')
      if (anchor === -1) throw new Error('vite: built index.html lost its module entry tag')
      const tag = `<script type="module" crossorigin src="./${bootstrapFile}"></script>`
      await writeFile(join(outDir, 'preview.html'), `${page.slice(0, anchor)}${tag}${page.slice(anchor)}`)
    },
  }
}

/** Exact npm package names assigned to the shared browser vendor chunk. */
const VENDOR_PACKAGES: ReadonlySet<string> = new Set([
  'katex', 'shiki', 'mdast-util-from-markdown', 'mdast-util-gfm', 'mdast-util-math',
  'micromark-core-commonmark', 'micromark-extension-gfm', 'micromark-extension-math',
  'micromark-factory-space', 'micromark-util-character', 'micromark-util-classify-character',
  'micromark-util-sanitize-uri', 'micromark-util-symbol', 'micromark-util-types',
])

/** Shiki grammars imported at startup; lazy grammars keep individual chunks. */
const BOOT_GRAMMAR_FILES = ['dist/typescript.mjs', 'dist/shellscript.mjs', 'dist/json.mjs'] as const
const FONT_EXTENSIONS = ['.woff2', '.woff', '.ttf'] as const
/** Publish the compatibility shell at its package's stable index path. */
function renameCompatibilityIndex(): Plugin {
  return {
    name: 'dsh-compatibility-index',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const page = Object.values(bundle).find(item => item.type === 'asset' && item.fileName === 'legacy.html')
      if (page === undefined) throw new Error('vite: compatibility legacy.html entry was not emitted')
      delete bundle[page.fileName]
      page.fileName = 'index.html'
      bundle['index.html'] = page
    },
  }
}

/** Configure one browser flavor over the shared application source. */
export function createWebViteConfig(compatibility: boolean): UserConfig {
  const outDir = compatibility
    ? src('../../../Compatibility/DSH/web/frontend/dist')
    : src('./dist')
  const plugins: PluginOption[] = [rejectStandaloneServe(), clientDocumentTitle(), react()]
  if (compatibility) plugins.push(renameCompatibilityIndex(), emitPreviewPage())
  else plugins.push(nativeBrowserGraphPlugin())

  return {
    root: src('.'),
    mode: compatibility ? 'compatibility' : 'native',
    base: './',
    plugins,
    build: {
      outDir,
      ...(compatibility ? { emptyOutDir: true } : {}),
      target: 'es2022',
      sourcemap: true,
      rollupOptions: {
        input: compatibility
          ? { index: src('./legacy.html'), bootstrap: src('./src/preview.ts') }
          : { index: src('./index.html') },
        output: {
          entryFileNames(chunk): string {
            return compatibility && chunk.name === 'bootstrap' ? 'preview/[name]-[hash].js' : 'assets/[name]-[hash].js'
          },
          chunkFileNames(chunk): string {
            if (chunk.name === 'index' || chunk.name === 'vendor') return 'assets/[name]-[hash].js'
            const isLangChunk = chunk.moduleIds.some(id => id.includes('/node_modules/@shikijs/langs/'))
            return isLangChunk ? 'assets/langs/[name]-[hash].js' : 'assets/[name]-[hash].js'
          },
          assetFileNames(asset): string {
            const fileName = asset.names[0] ?? ''
            const isFont = FONT_EXTENSIONS.some(ext => fileName.endsWith(ext))
            return isFont ? 'assets/fonts/[name]-[hash][extname]' : 'assets/[name]-[hash][extname]'
          },
          manualChunks(id: string): string | undefined {
            const pkg = npmPackageOf(id)
            if (pkg === undefined) return undefined
            if (pkg === '@shikijs/langs') {
              return BOOT_GRAMMAR_FILES.some(file => id.endsWith(`/${file}`)) ? 'vendor' : undefined
            }
            return VENDOR_PACKAGES.has(pkg) ? 'vendor' : undefined
          },
        },
      },
    },
    ...(compatibility ? {
      worker: { rollupOptions: { output: { entryFileNames: 'preview/[name]-[hash].js' } } },
    } : {}),
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: compatibility
        ? [{ find: /^node:module$/, replacement: src('./src/node-module-stub.ts') }]
        : [],
    },
    define: {
      ...clientBuildEnvironmentDefines(process.env),
      ...(compatibility ? {
        'process.versions.node': '"0.0.0"',
        'process.execArgv': '[]',
        'process.env.CORDIS_SHARED': 'undefined',
      } : {}),
    },
  }
}

export default defineConfig(({ mode }) => createWebViteConfig(mode === 'compatibility'))
