import { expect, it } from 'vitest'
import * as packaged from '@deepseek-ai/cordis'
import * as sourced from '../../../../Core/vendor/cordis/src/index.ts'

it('resolves Cordis imports to the same source module', () => {
  expect(packaged.Context).toBe(sourced.Context)
  expect(packaged.FiberState.ACTIVE).toBe(sourced.FiberState.ACTIVE)
  expect(sourced.FiberState.ACTIVE).toBe(2)
})
