import { defineConfig } from 'tsdown'

/** Bundle the Cordis and explicit Native GitHub ingress entries. */
export default defineConfig({
  entry: {
    index: 'lib/types/index.js',
    native: 'lib/types/host/native.js',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
