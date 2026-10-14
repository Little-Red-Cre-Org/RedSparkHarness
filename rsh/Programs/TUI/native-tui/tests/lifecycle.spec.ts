/** Real terminal cancellation must keep the application alive through model cleanup. */
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { controllerProof } from './controller-proof.ts'
import { terminalFixture } from './pty-profile.ts'
import { NativeTuiApplication } from '../src/native.ts'
import { TerminalController } from '../src/controller.ts'
import type { ReplayEntry } from '@deepseek-ai/dsh-llm-replay'

it.each([false, true])('cancels through the actual TTY and releases Ink after drain (cleanup failure: %s)', async (cleanupFailure) => {
  const script = [{ kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'Post-cancel answer.' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'Post-cancel answer.' } },
    { type: 'finish', reason: { kind: 'stop' } },
  ] }] satisfies ReplayEntry[]
  const fixture = terminalFixture(true, script, cleanupFailure)
  try {
    await controllerProof(fixture.workspace)
    if (cleanupFailure) {
      const execution = new Error('execution cleanup failed')
      const terminalCleanup = new Error('terminal cleanup failed')
      const close = vi.spyOn(TerminalController.prototype, 'close').mockRejectedValueOnce(execution)
      const subject = Object.create(NativeTuiApplication.prototype) as NativeTuiApplication
      const unmount = vi.fn()
      Object.defineProperty(subject, 'ink', { value: { waitUntilExit: () => Promise.reject(terminalCleanup), unmount } })
      try {
        await expect(subject.close()).rejects.toMatchObject({ errors: [execution, terminalCleanup] })
        expect(unmount).toHaveBeenCalledOnce()
      } finally { close.mockRestore() }
    }
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
    if (cleanupFailure) {
      await terminal.submit('/exit')
      expect(exited).toBe(false)
    }
    writeFileSync(join(fixture.home, 'release'), 'release')
    if (cleanupFailure) {
      expect((await terminal.done).exitCode).toBe(1)
      expect(terminal.output()).toContain('fixture executor cleanup failed')
      expect(existsSync(join(fixture.home, 'cleaned'))).toBe(true)
      return
    }
    await vi.waitFor(() => { expect(existsSync(join(fixture.home, 'cleaned'))).toBe(true) }, { timeout: 30000 })
    await vi.waitFor(() => { expect(terminal.output().lastIndexOf('Ready'))
      .toBeGreaterThan(terminal.output().lastIndexOf('Working')) }, { timeout: 30000 })
    expect(exited).toBe(false)
    await terminal.submit('continue after cancel')
    const continuationOutput = terminal.output().length
    await terminal.waitFor('Post-cancel answer.', continuationOutput)
    await vi.waitFor(() => { expect(existsSync(join(fixture.home, 'continuation-finish-started')), terminal.output()).toBe(true) }, { timeout: 30000 })
    await terminal.waitFor('Working · 0 queued', continuationOutput)
    const idleOutput = terminal.output().length
    writeFileSync(join(fixture.home, 'release-continuation-finish'), 'release')
    await terminal.waitFor('Ready · 0 queued', idleOutput)
    expect(exited).toBe(false)
    terminal.write('\x03')
    expect((await terminal.done).exitCode).toBe(0)
    expect(exited).toBe(true)
    expect(existsSync(join(fixture.home, 'cleaned'))).toBe(true)
  } finally { await fixture.cleanup() }
}, 45000)
