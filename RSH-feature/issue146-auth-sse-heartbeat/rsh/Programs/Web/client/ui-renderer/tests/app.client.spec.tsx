// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { buildRenderApp } from '../src/client/app.tsx'

let runtime: SlotTestRuntime | undefined

afterEach(async () => {
  cleanup()
  await runtime?.dispose()
  runtime = undefined
})

async function bench() {
  runtime = await SlotTestRuntime.create()
  await runtime.root.declare({}, () => <div data-testid="frame" />)
  return { runtime, renderApp: buildRenderApp({ slots: runtime.slots }) }
}

describe('buildRenderApp', () => {
  it('renders the root slot tree', async () => {
    const b = await bench()
    const view = render(<>{b.renderApp()}</>)
    expect(view.getByTestId('frame')).toBeTruthy()
  })

})
