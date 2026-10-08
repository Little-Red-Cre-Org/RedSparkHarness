import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['lib/types/{index,invariant,native,native-definition,client}.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  outputOptions: { chunkFileNames: 'shared-[hash].js' },
})
