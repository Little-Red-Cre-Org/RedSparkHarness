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

/** Build self-contained Loader entries so the package needs no private chunks. */
export default defineConfig([
  { ...nodeOutput, entry: ['lib/types/native.js'] },
  { ...nodeOutput, entry: ['lib/types/index.js'] },
])
