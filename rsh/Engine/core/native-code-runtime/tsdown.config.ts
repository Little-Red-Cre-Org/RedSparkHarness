import { defineConfig } from 'tsdown'

export default defineConfig([
  { entry: ['lib/types/index.js', 'lib/types/native.js', 'lib/types/process-child.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024', fixedExtension: false, dts: false, clean: false, outputOptions: { chunkFileNames: 'shared-[hash].js' } },
  { entry: ['lib/types/worker.js'], outDir: 'lib', format: ['cjs'], platform: 'node', target: 'es2024', fixedExtension: false, dts: false, clean: false },
])
