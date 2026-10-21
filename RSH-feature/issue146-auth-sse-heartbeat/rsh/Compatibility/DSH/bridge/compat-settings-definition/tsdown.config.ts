import { defineConfig } from 'tsdown'

/** Publish Cordis Settings declaration and event entry points. */
export default defineConfig({
  entry: ['lib/types/{index,events}.js'],
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
  outputOptions: { chunkFileNames: 'shared-[hash].js' },
})
