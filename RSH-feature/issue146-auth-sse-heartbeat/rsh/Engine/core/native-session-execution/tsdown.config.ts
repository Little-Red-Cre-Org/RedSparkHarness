import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/root-route.js', 'lib/types/read-history.js'],
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
  outputOptions: { chunkFileNames: 'shared-[hash].js' },
})
