import { defineConfig } from 'tsdown'
export default defineConfig({ entry: ['lib/types/index.js', 'lib/types/descriptor.js', 'lib/types/assistant-output.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024', fixedExtension: false, dts: false, clean: false })
