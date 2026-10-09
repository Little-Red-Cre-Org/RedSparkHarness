import { defineConfig } from 'tsdown'

/** Keep native authorization free of the Cordis entry at runtime. */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/native.js', 'lib/types/invariant.js'],
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
  outputOptions: { chunkFileNames: 'shared-[hash].js' },
})
