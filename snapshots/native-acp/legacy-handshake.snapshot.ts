/** Recorded ACP handshake through the shipped profile. No model turn. */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { execa } from 'execa'
import { JsonRpcLineTransport } from '@redspark/rsh-json-rpc-line'

const root = fileURLToPath(new URL('../../', import.meta.url))

it('replays the recorded ACP handshake on the shipped profile', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-native-acp-handshake-'))
  const workspace = join(home, 'workspace')
  mkdirSync(workspace)
  const child = execa(process.execPath, [join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'acp'], {
    cwd: workspace, env: { ...process.env, RSH_HOME: home, RSH_TELEMETRY_DISABLED: '1' },
    reject: false, timeout: 30_000, killSignal: 'SIGKILL',
  })
  const transport = new JsonRpcLineTransport(child.stdout, child.stdin)
  transport.start()
  const signal = AbortSignal.timeout(20_000)
  try {
    const initialized = await transport.request('initialize', {
      protocolVersion: 1, clientCapabilities: {},
    }, signal) as {
      protocolVersion: number
      agentInfo: { name: string }
      agentCapabilities: { promptCapabilities: { image: boolean }; sessionCapabilities: Record<string, unknown> }
    }
    expect(initialized.protocolVersion).toBe(1)
    expect(initialized.agentInfo.name).toBe('redspark-harness-native-acp')
    expect(initialized.agentCapabilities.promptCapabilities.image).toBe(true)
    expect(initialized.agentCapabilities.sessionCapabilities).toMatchObject({ close: {}, list: {}, resume: {} })
    const created = await transport.request('session/new', { cwd: workspace, mcpServers: [] }, signal) as {
      sessionId: string
      configOptions: { id: string; currentValue: string }[]
    }
    expect(created.sessionId).toEqual(expect.any(String))
    expect(created.configOptions[0]).toMatchObject({
      id: 'model', currentValue: JSON.stringify(['deepseek-official', 'deepseek-v4-flash']),
    })
    await expect(transport.request('session/new', {
      cwd: workspace, mcpServers: [], additionalDirectories: ['/extra-dir'],
    }, signal)).rejects.toThrow('additionalDirectories is not supported')
    expect(await transport.request('session/new', {
      cwd: workspace, mcpServers: [], additionalDirectories: [],
    }, signal)).toMatchObject({ sessionId: expect.any(String) })
  } finally {
    child.stdin.end()
    const exited = await child
    transport.close()
    expect(exited.exitCode, exited.stderr).toBe(0)
    rmSync(home, { recursive: true, force: true })
  }
})
