import { defineConfig } from 'tsdown'

export default defineConfig({
  tsconfig: 'tsconfig.host.json',
  entry: ['lib/types/index.js', 'lib/types/native.js', 'lib/types/model-selection.js', 'lib/types/model-directory.js', 'lib/types/adapter-directory.js'],
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
  outputOptions: { chunkFileNames: 'shared-[hash].js' },
})
