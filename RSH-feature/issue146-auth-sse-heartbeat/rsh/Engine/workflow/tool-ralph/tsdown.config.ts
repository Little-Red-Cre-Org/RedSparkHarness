import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/native.js', 'lib/types/runtime.js'],
  outputOptions: { chunkFileNames: 'shared-[hash].js' },
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
})
