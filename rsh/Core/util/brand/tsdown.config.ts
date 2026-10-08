import { defineConfig } from 'tsdown'

/** Publish the brand helpers from their canonical TypeScript output. */
export default defineConfig({
  entry: ['lib/types/index.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
})
