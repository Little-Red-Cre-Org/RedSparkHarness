import { defineConfig } from 'tsdown'

/** Bundle Cordis and Native rule runtimes, their invariant, and the Cordis-free Definition entry. */
export default defineConfig({
  entry: {
    index: 'lib/types/index.js',
    invariant: 'lib/types/invariant.js',
    definition: 'lib/types/definition.js',
    native: 'lib/types/native.js',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  outputOptions: { chunkFileNames: 'shared-[hash].js' },
  clean: false,
})
