import { defineConfig } from 'tsdown'

// Both registration and direct composition use the same local backend implementation.
export default defineConfig({
  entry: ['lib/types/{index,native,runtime,backend}.js'],
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
  outputOptions: { chunkFileNames: 'shared-[hash].js' },
})
