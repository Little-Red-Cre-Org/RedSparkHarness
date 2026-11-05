import { defineConfig } from 'tsdown'

/**
 * Node-only host half. The `./shared` subpath (route paths and wire payload
 * types for the browser package) resolves the tsc-emitted tree directly. Both
 * carriers are entries: the Cordis row and the Native row each ship as their
 * own module, so a Native profile can load the one it has a listener for.
 */
export default defineConfig([
  {
    entry: ['lib/types/index.js', 'lib/types/native.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    outputOptions: { chunkFileNames: 'shared-[hash].js' },
  },
])
