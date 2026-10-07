import { defineConfig } from 'tsdown'

/** Build the package root and invariant companion as independent bundles. */
export default defineConfig([
  {
    entry: ['lib/types/index.js', 'lib/types/compat-settings.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])
