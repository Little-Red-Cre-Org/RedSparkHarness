import { defineConfig } from 'tsdown'

/** Publish the legacy and native settings definitions without Cordis in the native entry. */
export default defineConfig({
  entry: ['lib/types/{index,invariant,native,types}.js'],
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
  outputOptions: { chunkFileNames: 'shared-[hash].js' },
})
