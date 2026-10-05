import { defineConfig } from 'tsdown'
export default defineConfig({ entry: { index: 'lib/types/index.js', presentation: 'lib/types/ui.js', utilities: 'lib/types/utils.js' }, outDir: 'lib', outputOptions: { chunkFileNames: 'shared-[hash].js' }, format: ['esm'], platform: 'node', target: 'es2024', fixedExtension: false, dts: false, clean: false })
