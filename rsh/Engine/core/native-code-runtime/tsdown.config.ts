import { defineConfig } from 'tsdown'

export default defineConfig([
  { entry: ['lib/types/index.js', 'lib/types/native.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024', fixedExtension: false, dts: false, clean: false },
  { entry: ['lib/types/worker.js'], outDir: 'lib', format: ['cjs'], platform: 'node', target: 'es2024', fixedExtension: false, dts: false, clean: false },
])
