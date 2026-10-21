import { defineConfig } from 'tsdown'

// Shared chunks keep FsError constructor identity equal across the root and direct operations entries.
export default defineConfig({
  entry: ['lib/types/{index,native,runtime,runtime-definition,operations,types}.js', 'lib/types/invariant.js'],
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
  outputOptions: { chunkFileNames: 'shared-[hash].js' },
})
