import { defineConfig } from 'tsdown'

// Both entries share the platform runner and its cached grant state implementation.
export default defineConfig({
  entry: ['lib/types/{index,native}.js'],
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
  outputOptions: { chunkFileNames: 'shared-[hash].js' },
})
