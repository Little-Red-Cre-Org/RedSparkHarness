import { defineConfig } from 'tsdown'

/** Publish native and Cordis title services with shared title facts. */
export default defineConfig({
  entry: ['lib/types/{index,invariant,native}.js'],
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
  outputOptions: { chunkFileNames: 'shared-[hash].js' },
})
