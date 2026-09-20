/** Runtime source selection for scoped-event discovery after the physical layout migration. */

import { describe, expect, it } from 'vitest'
import { isScopedEventSource } from './gen-scoped-events.ts'

describe('scoped-event source discovery', () => {
  it.each([
    'rsh/Engine/core/scope/src/index.ts',
    'rsh/Core/storage/example/src/index.ts',
    'rsh/Modules/Official/shell/example/src/index.ts',
    'rsh/Modules/Community/experimental/example/src/index.ts',
    'rsh/Compatibility/DSH/bundle/example/src/index.ts',
    'rsh/Programs/CLI/src/bin.ts',
    'rsh/Programs/SDK/packages/server/src/server.ts',
    'rsh/Tests/test-support/example/src/index.ts',
  ])('includes runtime source %s', (path) => {
    expect(isScopedEventSource(path)).toBe(true)
  })

  it.each([
    'rsh/Modules/Community/experimental/webworker-runtime/tests/fixtures/vfs-example/workspace/src/preview.ts',
    'rsh/Engine/core/scope/tests/fixtures/src/index.ts',
    'rsh/Core/vendor/cordis/src/index.ts',
    'rsh/Core/native/system/packages/entry/src/flock.ts',
    'node_modules/example/src/index.ts',
    'rsh/Programs/Web/application/tests/example.spec.ts',
  ])('excludes non-runtime source %s', (path) => {
    expect(isScopedEventSource(path)).toBe(false)
  })
})
