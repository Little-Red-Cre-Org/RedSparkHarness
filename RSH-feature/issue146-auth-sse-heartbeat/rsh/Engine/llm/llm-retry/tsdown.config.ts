import { defineConfig } from 'tsdown'

/** Build the Cordis and native installers over one shared retry core, plus the independent invariant companion. */
export default defineConfig([
  {
    entry: ['lib/types/{index,native}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    outputOptions: { chunkFileNames: 'shared-[hash].js' },
  },
  {
    entry: ['lib/types/invariant.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])
