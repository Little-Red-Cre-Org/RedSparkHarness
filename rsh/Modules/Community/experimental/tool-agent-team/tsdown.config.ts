import { defineConfig } from 'tsdown'

/** Build the Cordis compatibility plugin and the Native tool installer with shared schemas. */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/native.js'],
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
})
