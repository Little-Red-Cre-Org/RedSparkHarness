import { defineConfig } from 'tsdown'

/** Build the Cordis and native entries over shared file-tool validation and text. */
export default defineConfig({
  entry: ['lib/types/{index,runtime,native,read-image-core}.js'],
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
  outputOptions: { chunkFileNames: 'shared-[hash].js' },
})
