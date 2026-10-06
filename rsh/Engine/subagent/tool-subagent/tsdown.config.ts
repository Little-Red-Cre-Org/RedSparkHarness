import { defineConfig } from 'tsdown'

const nodeOutput = {
  outDir: 'lib',
  format: ['esm'] as const,
  platform: 'node' as const,
  target: 'es2024' as const,
  fixedExtension: false,
  dts: false,
  clean: false,
}

/** Build literal Loader entries with the lazy Cordis chunk publishable. */
export default defineConfig([
  { ...nodeOutput, entry: ['lib/types/native.js'] },
  {
    ...nodeOutput,
    entry: ['lib/types/index.js'],
    outputOptions: { chunkFileNames: 'shared-[hash].js' },
  },
  { ...nodeOutput, entry: ['lib/types/model-selection-settings.js'] },
  { ...nodeOutput, entry: ['lib/types/invariant.js'] },
])
