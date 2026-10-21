import { defineConfig } from 'tsdown'

/** Publish the Cordis wrapper and native execution policy over one timeout identity. */
export default defineConfig({
  entry: ['lib/types/{index,native}.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false, outputOptions: { chunkFileNames: 'shared-[hash].js' },
})
