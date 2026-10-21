import { defineConfig } from 'tsdown'

/** Bundle the Cordis adapter and Cordis-free Native Consumer. */
export default defineConfig({
  entry: ['lib/types/{index,native}.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  outputOptions: { chunkFileNames: 'shared-[hash].js' },
})
