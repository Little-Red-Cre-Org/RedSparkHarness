import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import type { Plugin } from 'vite'
import { expect, it } from 'vitest'
import { createWebViteConfig } from '../vite.config.ts'

const loaderSource = fileURLToPath(new URL('../../../../Core/vendor/loader/src/index.ts', import.meta.url))

it('rejects vendored and scoped Cordis ids through the Native Vite configuration', async () => {
  const inputFile = fileURLToPath(new URL('./native-browser-graph-input.html', import.meta.url))
  const injectedModule: Plugin = {
    name: 'test-native-browser-graph-input',
    enforce: 'pre',
    resolveId(id) {
      if (id === '@deepseek-ai/cordis-plugin-loader') return { id: loaderSource, external: true }
      if (id === '@deepseek-ai/cordis') return { id, external: true }
      return undefined
    },
  }
  const native = createWebViteConfig(false)
  const buildOptions = native.build ?? {}
  await expect(build({
    ...native,
    configFile: false,
    plugins: [...(native.plugins ?? []), injectedModule],
    build: {
      ...buildOptions,
      write: false,
      emptyOutDir: false,
      rollupOptions: { ...buildOptions.rollupOptions, input: inputFile },
    },
  })).rejects.toThrow(/native browser graph contains Cordis modules/)
})
