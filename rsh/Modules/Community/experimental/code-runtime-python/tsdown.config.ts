import { defineConfig } from 'tsdown'

/**
 * Cordis and Native entries share the runtime chunk. The Python-side code is
 * not TypeScript and ships verbatim under `py/`.
 */
export default defineConfig({
  entry: ['lib/types/{index,native}.js'],
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
  outputOptions: { chunkFileNames: 'shared-[hash].js' },
})
