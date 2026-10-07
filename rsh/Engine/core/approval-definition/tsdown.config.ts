import { defineConfig } from 'tsdown'

/** Publish the branded identifiers and policy list from the owning compiler output. */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/legacy.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
})
