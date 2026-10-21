import { defineConfig } from 'tsdown'
import { typertPlugin } from '../../../Core/typert/generator/lib/types/tsdown-plugin.js'

/** Bundle the Cordis API and Cordis-free Native records and Definitions. */
export default defineConfig({
  entry: ['lib/types/{index,records}.js'],
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
  outputOptions: { chunkFileNames: 'shared-[hash].js' },
  plugins: [typertPlugin({ mode: 'workspace', faces: ['host'] })],
})
