/** The standalone SDK-minimal bundle's complete declared Cordis tree. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@redspark/cordis-plugin-include'

function packageName(specifier: string): string {
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!
}

describe('dsh-sdk-minimal bundle', () => {
  it('declares one standalone allowlisted tree with every row dependency', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const patches = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    ) as Array<{ insert?: Array<{ id?: string; inject?: string[]; name?: string; config?: Record<string, unknown>; disabled?: unknown }> }>
    expect(patches).toHaveLength(1)
    const rows = patches[0]?.insert ?? []
    expect(rows.map(row => [row.id, row.name])).toEqual([
      ['sdk-app-startup', '@redspark/rsh-sdk-app'],
      ['sdk-jsonrpc-server', '@redspark/rsh-sdk-jsonrpc-server'],
      ['deepseek-llm-api-extensions', '@redspark/rsh-deepseek-llm-api-extensions'],
      ['session-log-deepseek', '@redspark/rsh-session-log-deepseek'],
      ['plugin-package-inventory-deepseek', '@redspark/rsh-plugin-package-inventory-deepseek'],
      ['llm-deepseek', '@redspark/rsh-llm-deepseek'],
      ['sandbox', '@redspark/rsh-sandbox-local'],
      ['session-projection', '@redspark/rsh-session-projection'],
      ['sandbox-policy', '@redspark/rsh-sandbox-policy'],
      ['subprocess', '@redspark/rsh-subprocess-local'],
      ['pty', '@redspark/rsh-terminal'],
      ['terminal-bash', '@redspark/rsh-terminal-bash'],
      ['terminal-pwsh', '@redspark/rsh-terminal-bash'],
      ['timer', '@redspark/cordis-plugin-timer'],
      ['llm', '@redspark/rsh-llm'],
      ['session', '@redspark/rsh-session'],
      ['session-title', '@redspark/rsh-session-title'],
      ['system-prompt', '@redspark/rsh-system-prompt'],
      ['tools', '@redspark/rsh-tools'],
      ['agent', '@redspark/rsh-agent'],
      ['llm-retry', '@redspark/rsh-llm-retry'],
      ['jobs', '@redspark/rsh-jobs-local'],
      ['invariants', '@redspark/rsh-invariants'],
      ['session-invariant', '@redspark/rsh-session/invariant'],
      ['agent-invariant', '@redspark/rsh-agent/invariant'],
      ['scope-invariant', '@redspark/rsh-scope/invariant'],
      ['agent-loop-invariant', '@redspark/rsh-agent-loop/invariant'],
      ['agent-loop', '@redspark/rsh-agent-loop'],
      ['persistent-bash', '@redspark/rsh-tool-bash-persistent'],
      ['persistent-pwsh', '@redspark/rsh-tool-pwsh-persistent'],
      ['sessions', '@redspark/rsh-session-persistence-jsonl'],
    ])
    expect(rows.find(row => row.id === 'sdk-app-startup')?.config).toEqual({ profile: 'sdk-minimal' })
    expect(rows.find(row => row.id === 'sdk-jsonrpc-server')).toMatchObject({
      inject: ['sdkAppStartup', 'loader'],
      config: { maxTokensAsSuccess: false },
    })
    expect(rows.find(row => row.id === 'llm-deepseek')?.config).toEqual({
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      defaultContextWindow: { __jsExpr: 'Number(process.env.RSH_CONTEXT_WINDOW ?? 1000000)' },
      streamIdleTimeoutMs: 172800000,
    })
    expect(rows.find(row => row.id === 'system-prompt')?.config).toEqual({
      includeHarnessIdentity: false,
      includeRuntimeContext: false,
      personaPrefix: { __jsExpr: "process.env.RSH_SYSTEM_PROMPT ?? 'You are a helpful software engineer assistant.'" },
    })
    expect(rows.find(row => row.id === 'agent-loop')?.config).toEqual({ agents: [] })
    expect(rows.find(row => row.id === 'terminal-bash')).toMatchObject({
      disabled: { __jsExpr: "process.platform === 'win32'" },
    })
    expect(rows.find(row => row.id === 'terminal-pwsh')).toMatchObject({
      disabled: { __jsExpr: "process.platform !== 'win32'" },
      config: { shellDialect: 'pwsh', timeoutMs: 300000 },
    })
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(
      [...new Set(rows.map(row => row.name).filter((name): name is string => name !== undefined).map(packageName))].sort(),
    )
  })
})
