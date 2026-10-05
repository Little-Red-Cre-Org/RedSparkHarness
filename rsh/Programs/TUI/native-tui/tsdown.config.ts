import { defineConfig } from 'tsdown'
export default defineConfig({ entry: ['lib/types/{index,native}.js'], outDir: 'lib', outputOptions: { chunkFileNames: 'shared-[hash].js' }, format: ['esm'], platform: 'node', target: 'es2024', fixedExtension: false, dts: false, clean: false })
