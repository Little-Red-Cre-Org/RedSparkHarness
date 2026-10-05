/** Real terminal cancellation must keep the application alive through model cleanup. */
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { controllerProof } from './controller-proof.ts'
import { terminalFixture } from './pty-profile.ts'

it('cancels through the actual TTY and drains cleanup before ordinary exit', async () => {
  const fixture = terminalFixture(true)
  try {
    await controllerProof(fixture.workspace)
    const terminal = fixture.launch()
    let exited = false
    void terminal.done.then(() => { exited = true })
    await terminal.waitFor('Ready')
    await terminal.submit('cancel input')
    await vi.waitFor(() => { expect(existsSync(join(fixture.home, 'started')), terminal.output()).toBe(true) }, { timeout: 30000 })
    terminal.write('\x03')
    await vi.waitFor(() => { expect(existsSync(join(fixture.home, 'aborted'))).toBe(true) }, { timeout: 30000 })
    expect(exited).toBe(false)
    expect(existsSync(join(fixture.home, 'cleaned'))).toBe(false)
    await terminal.submit('/exit')
    expect(exited).toBe(false)
    writeFileSync(join(fixture.home, 'release'), 'release')
    expect((await terminal.done).exitCode).toBe(0)
    expect(existsSync(join(fixture.home, 'cleaned'))).toBe(true)
  } finally { await fixture.cleanup() }
}, 45000)
