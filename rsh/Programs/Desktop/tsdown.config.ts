import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: { 'ide-extension': 'lib/types/ide-extension.js' }, outDir: 'lib',
    format: ['cjs'], platform: 'node', target: 'es2024', fixedExtension: false,
    dts: false, clean: false, deps: { neverBundle: ['vscode'] },
  },
  {
    entry: ['lib/types/main.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: ['electron'] },
  },
  ...(['preload', 'preload-app', 'preload-pet'] as const).map(name => ({
    // Sandboxed Electron preloads run as CommonJS even though the application package is ESM.
    entry: { [name]: `lib/types/${name}.js` },
    outDir: 'lib',
    format: ['cjs'] as const,
    platform: 'node' as const,
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: ['electron'] },
  })),
])
