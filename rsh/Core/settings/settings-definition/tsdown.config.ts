import { defineConfig } from 'tsdown'

/** Publish the framework-neutral Settings root and Native contract entries. */
export default defineConfig({
  entry: ['lib/types/{index,native,types}.js'],
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
  outputOptions: { chunkFileNames: 'shared-[hash].js' },
})
