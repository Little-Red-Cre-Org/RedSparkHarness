import { defineConfig } from 'tsdown'

const shared = {
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  outputOptions: { codeSplitting: false },
} as const

/** Bundle each editor entry on its own so the shared operations stay inlined. */
export default defineConfig([
  { ...shared, entry: ['lib/types/index.js'] },
  { ...shared, entry: ['lib/types/native.js'] },
])
