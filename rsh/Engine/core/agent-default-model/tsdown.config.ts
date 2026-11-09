import { defineConfig } from 'tsdown'

/** Build the package root, its Native entry and declaration module, and the compatibility settings entry. */
export default defineConfig([
  {
    entry: ['lib/types/index.js', 'lib/types/native.js', 'lib/types/native-definition.js', 'lib/types/compat-settings.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])
