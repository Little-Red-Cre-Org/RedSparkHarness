import { defineConfig } from 'tsdown'

/**
 * The dsh CLI ships its profile launcher and the private Desktop planning library.
 * Entries use emitted launcher and planning modules; their reachable code bundles with them.
 * Declarations come from `tsc -b` (dts: false), matching every package.
 */
export default defineConfig({
  entry: ['lib/types/bin.js', 'lib/types/native-profile.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: ['lib/*.js'],
})
