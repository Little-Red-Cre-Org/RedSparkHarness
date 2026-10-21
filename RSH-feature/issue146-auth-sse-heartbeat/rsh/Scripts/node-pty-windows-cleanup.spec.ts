import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(new URL('../Core/subprocess/subprocess-local/package.json', import.meta.url))

describe.skipIf(process.platform !== 'win32')('Windows node-pty natural exit', () => {
  it.each(['', 'process.stdout.write("PTY_FINAL_OUTPUT")'])('releases its host after command %j', (command) => {
    const result = spawnSync(process.execPath, ['-e', `
      const pty = require(${JSON.stringify(require.resolve('node-pty'))});
      const terminal = pty.spawn(process.execPath, ['-e', ${JSON.stringify(command)}], {
        cwd: process.cwd(), cols: 80, rows: 24
      });
      terminal.onData(data => process.stdout.write(data));
      terminal.onExit(({ exitCode }) => {
        process.stdout.write('PTY_EXIT=' + exitCode);
      });
    `], { encoding: 'utf8', timeout: 10_000, windowsHide: true })

    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('PTY_EXIT=0')
    if (command) expect(result.stdout).toContain('PTY_FINAL_OUTPUT')
  })
})
