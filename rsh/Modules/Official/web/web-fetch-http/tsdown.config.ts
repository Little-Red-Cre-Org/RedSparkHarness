import { defineConfig } from 'tsdown'

/** Build the Cordis and native HTTP fetch Providers over shared policy and decoding. */
export default defineConfig({
  entry: ['lib/types/{index,native}.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false, outputOptions: { chunkFileNames: 'shared-[hash].js' },
})
