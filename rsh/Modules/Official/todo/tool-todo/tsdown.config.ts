import { defineConfig } from 'tsdown'

/** Publish native and Cordis consumers with shared todo normalization. */
export default defineConfig({
  entry: ['lib/types/{index,invariant,native}.js'],
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
  outputOptions: { chunkFileNames: 'shared-[hash].js' },
})
