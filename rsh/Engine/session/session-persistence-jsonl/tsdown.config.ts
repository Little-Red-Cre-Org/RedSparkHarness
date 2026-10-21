import { defineConfig } from 'tsdown'

const output = {
  outDir: 'lib', format: ['esm'] as const, platform: 'node' as const, target: 'es2024' as const,
  fixedExtension: false, dts: false, clean: false,
}

export default defineConfig([
  { ...output, entry: ['lib/types/index.js'] },
  { ...output, entry: ['lib/types/native.js'] },
])
