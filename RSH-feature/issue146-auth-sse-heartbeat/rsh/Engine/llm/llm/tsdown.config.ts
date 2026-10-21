import { defineConfig } from 'tsdown'

/** Build the Cordis runtime, native values, and invariant independently. */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/native.js', 'lib/types/invariant.js'],
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
  outputOptions: { chunkFileNames: 'shared-[hash].js' },
})
