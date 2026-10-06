import { defineConfig } from 'tsdown'

/** Build compatibility and native consumers with shared pure helpers. */
export default defineConfig({ entry: ['lib/types/index.js', 'lib/types/native.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024', fixedExtension: false, dts: false, clean: false, outputOptions: { chunkFileNames: 'shared-[hash].js' } })
