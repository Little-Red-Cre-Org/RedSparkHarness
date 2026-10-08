import { defineConfig } from 'tsdown'

/** Publish the Cordis listener and native settlement policy over one repeat detector. */
export default defineConfig({
  entry: ['lib/types/{index,native}.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false, outputOptions: { chunkFileNames: 'shared-[hash].js' },
})
