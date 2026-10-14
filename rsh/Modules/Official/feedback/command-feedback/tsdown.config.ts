import { defineConfig } from 'tsdown'
import { typertPlugin } from '../../../../Core/typert/generator/lib/types/tsdown-plugin.js'

/** Bundle the Cordis Remote and Cordis-free Native command entries. */
export default defineConfig({
  entry: ['lib/types/{index,native}.js'],
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
  outputOptions: { chunkFileNames: 'shared-[hash].js' },
  plugins: [typertPlugin({ mode: 'workspace', faces: ['host'] })],
})
