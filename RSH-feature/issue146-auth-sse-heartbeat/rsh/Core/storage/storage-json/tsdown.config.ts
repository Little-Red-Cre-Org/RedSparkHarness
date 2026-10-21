import { defineConfig } from 'tsdown'

export default defineConfig({ tsconfig: 'tsconfig.json', entry: ['lib/types/index.js', 'lib/types/native.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024', fixedExtension: false, dts: false, clean: false, outputOptions: { chunkFileNames: 'shared-[hash].js' } })
