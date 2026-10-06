import { defineConfig } from 'tsdown'

/** Build the compatibility Definition, native Definition, errors, and durable types as public entries. */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/invariant.js', 'lib/types/native.js', 'lib/types/errors.js', 'lib/types/types.js'],
  outputOptions: { chunkFileNames: 'shared-[hash].js' },
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
})
