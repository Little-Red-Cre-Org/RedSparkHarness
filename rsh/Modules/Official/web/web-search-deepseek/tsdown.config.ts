import { defineConfig } from 'tsdown'

/** Build the Cordis and native DeepSeek search Providers over shared request construction. */
export default defineConfig({
  entry: ['lib/types/{index,native}.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false, outputOptions: { chunkFileNames: 'shared-[hash].js' },
})
