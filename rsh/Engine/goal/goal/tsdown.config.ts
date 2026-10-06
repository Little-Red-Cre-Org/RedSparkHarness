import { defineConfig } from 'tsdown'

/** Build the package root and invariant companion as independent bundles. */
export default defineConfig([
  {
    entry: ['lib/types/projection.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'browser',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
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
  {
    entry: ['lib/types/invariant.js'],
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
