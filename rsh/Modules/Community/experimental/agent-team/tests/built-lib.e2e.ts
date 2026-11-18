/** Plain-Node smoke for the built Agent Teams Native installer. */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const root = resolve(packageDir, '../../../../..')
const artifact = (path: string): string => join(root, path)
const artifactUrl = (path: string): string => pathToFileURL(artifact(path)).href

const requiredArtifacts = existsSync(artifact('rsh/Modules/Community/experimental/agent-team/lib/index.js'))

describe.skipIf(!requiredArtifacts)('Agent Teams built Native installer', () => {
  it('loads the Native installer under plain Node', async () => {
    const url = artifactUrl('rsh/Modules/Community/experimental/agent-team/lib/index.js')
    const script = `
      const native = await import(${JSON.stringify(url)})
      console.log(JSON.stringify({
        name: native.plugin.name,
        provides: native.plugin.provides,
        requires: native.plugin.requires,
      }))
    `

    const result = await runPlainNode(script)
    expect(result.exitCode, `stderr:\n${result.stderr}`).toBe(0)
    const output = JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}') as {
      name: string
      provides: string[]
      requires: string[]
    }
    expect(output).toEqual({
      name: '@redspark/rsh-experimental-agent-team',
      provides: ['agentTeams'],
      requires: ['agents', 'activeSessions', 'sessionPersistence', 'sessionProjections', 'subagents'],
    })
  })
})

function runPlainNode(script: string): Promise<{
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
}> {
  return new Promise((resolveRun) => {
    execFile(process.execPath, ['--input-type=module', '-e', script], {
      cwd: packageDir,
      encoding: 'utf8',
      timeout: 30_000,
    }, (error, stdout, stderr) => {
      resolveRun({
        exitCode: error === null ? 0 : typeof error.code === 'number' ? error.code : null,
        stdout,
        stderr,
      })
    })
  })
}
