import { defineConfig } from 'tsdown'

const shared = {
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  outputOptions: { codeSplitting: false },
  dts: false,
  clean: false,
} as const

/** Node-only backend: each entry bundles the shared filesystem functions without a second chunk. */
export default defineConfig([
  { ...shared, entry: ['lib/types/index.js'] },
  { ...shared, entry: ['lib/types/native.js'] },
  { ...shared, entry: ['lib/types/browse.js'] },
])
