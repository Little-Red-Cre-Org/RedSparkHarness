import { defineConfig } from 'tsdown'
import { typertPlugin } from './rsh/Core/typert/generator/lib/types/tsdown-plugin.js'

function isBuildFaceClient(value: unknown): boolean {
  if (value === undefined || value === 'host') return false
  if (value === 'client') return true
  throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host or client, received ${String(value)}`)
}

/**
 * The ordinary workspace build consumes JavaScript emitted by the Host
 * TypeScript project and runs Typert. The Client pass selects packages that
 * declare a browser bundle and lets their package-local configs emit both
 * their Node loader entry and browser artifact.
 */
export default defineConfig(({ env }) => {
  const client = isBuildFaceClient(env?.DSH_BUILD_FACE)
  return {
    workspace: client
      ? [
          'rsh/Core/vendor/*',
          'rsh/Core/identity/*',
          'rsh/Core/runtime-diagnostics/*',
          'rsh/Core/settings/*',
          'rsh/Core/storage/*',
          'rsh/Core/subprocess/*',
          'rsh/Core/typert/*',
          'rsh/Core/util/*',
          'rsh/Engine/*/*',
          'rsh/Modules/Official/*/*',
          'rsh/Modules/Community/*/*',
          'rsh/Compatibility/DSH/*/*',
          'rsh/Programs/TUI/*',
          'rsh/Programs/CLI',
          'rsh/Programs/Desktop',
          'rsh/Programs/DesktopHost',
          'rsh/Programs/ACP/packages/*',
          'rsh/Programs/SDK/packages/*',
          'rsh/Programs/Web/api/*',
          'rsh/Programs/Web/client/*',
          'rsh/Programs/Web/host/*',
          'rsh/Tests/test-support/*',
        ]
      : [
          'rsh/Core/vendor/*',
          'rsh/Core/identity/*',
          'rsh/Core/runtime-diagnostics/*',
          'rsh/Core/settings/*',
          'rsh/Core/storage/*',
          'rsh/Core/subprocess/*',
          'rsh/Core/typert/*',
          'rsh/Core/util/*',
          'rsh/Engine/*/*',
          'rsh/Modules/Official/*/*',
          'rsh/Modules/Community/*/*',
          'rsh/Compatibility/DSH/*/*',
          'rsh/Programs/TUI/*',
          'rsh/Programs/CLI',
          'rsh/Programs/Desktop',
          'rsh/Programs/DesktopHost',
          'rsh/Programs/ACP/packages/*',
          'rsh/Programs/SDK/packages/*',
          'rsh/Programs/Web/api/*',
          'rsh/Programs/Web/client/*',
          'rsh/Programs/Web/host/*',
          'rsh/Tests/test-support/*',
        ],
    entry: client ? '' : ['lib/types/{index,invariant,startup,runtime,runtime-definition}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    plugins: client ? [] : [typertPlugin({ mode: 'workspace', faces: ['host'] })],
  }
})
