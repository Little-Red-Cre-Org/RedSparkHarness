import { defineConfig } from 'tsdown'

/** Build the Cordis adapter and native installer over one file backend. */
export default defineConfig({
  entry: ['lib/types/{index,native,backend}.js'],
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
  outputOptions: { chunkFileNames: 'shared-[hash].js' },
})
