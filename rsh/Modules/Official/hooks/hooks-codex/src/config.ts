/**
 * Parse Codex's five-event hook subset into shared {@link MatcherGroup}s. Only synchronous command
 * hooks run; Windows selects `commandWindows` or its `command_windows` alias when present. Other
 * hook types and `async: true` commands are recorded as skipped. The bridge does not substitute
 * values into command strings.
 * @module @deepseek-ai/dsh-hooks-codex/config
 */

import { matcherDiagnostic, type MatcherGroup } from '@deepseek-ai/dsh-hook-protocol'

/** Hook event names in the current Codex hooks reference. */
export const CODEX_EVENTS = [
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PreCompact',
  'PostCompact',
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'Interrupt',
] as const

/** Events with a matching harness interception point in this bridge. */
export const CODEX_SUPPORTED_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'SessionStart',
  'UserPromptSubmit',
  'Stop',
] as const

/** A Codex event implemented by this bridge. */
export type CodexSupportedEvent = typeof CODEX_SUPPORTED_EVENTS[number]

const knownEvents = new Set<string>(CODEX_EVENTS)
const supportedEvents = new Set<string>(CODEX_SUPPORTED_EVENTS)

/** A parsed Codex config: event name → its matcher groups (command hooks only). */
export type CodexHookConfig = Record<string, MatcherGroup[]>

/** An unrun configured event or hook, surfaced so the bridge can warn. */
export interface SkippedHook {
  event: string
  reason: string
}

/** The outcome of parsing one Codex config file. */
export interface ParsedCodexConfig {
  config: CodexHookConfig
  skipped: SkippedHook[]
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * Parse a wrapped or bare Codex event map. Unknown and currently unsupported events are returned
 * in `skipped` so the bridge can report configuration that it cannot run; malformed entries are
 * ignored rather than failing boot. Unsupported event payloads are not interpreted. On Windows,
 * `commandWindows` takes precedence over the `command_windows` TOML alias; other platforms use
 * `command`. Matcher fields on UserPromptSubmit and Stop are discarded because those events have no
 * matcher subject. A
 * matcher-bearing runnable group with an invalid regex throws a `SyntaxError`, allowing the bridge
 * to reject the complete config before listener registration.
 * @param raw - the parsed JSON config: a `{ hooks: … }` wrapper or the bare event map.
 * @param platform - selects the Windows command override; defaults to the current process platform.
 * @returns the runnable per-event groups plus the skipped hooks with their reasons.
 */
export function parseCodexConfig(raw: unknown, platform: 'windows' | 'other' = process.platform === 'win32' ? 'windows' : 'other'): ParsedCodexConfig {
  const config: CodexHookConfig = {}
  const skipped: SkippedHook[] = []
  const root = asObject(raw)
  const hooksMap = root ? asObject(root.hooks) ?? root : undefined
  if (!hooksMap) return { config, skipped }

  for (const [event, rawGroups] of Object.entries(hooksMap)) {
    // Matcher-group parsing remains dialect-local because the supported hook
    // shapes and skip reasons differ from Claude Code's.
    /* jscpd:ignore-start */
    if (!Array.isArray(rawGroups)) continue
    if (!knownEvents.has(event)) {
      if (rawGroups.length > 0) skipped.push({ event, reason: 'unknown Codex hook event' })
      continue
    }
    if (!supportedEvents.has(event)) {
      if (rawGroups.length > 0) skipped.push({ event, reason: 'event unsupported by this bridge' })
      continue
    }
    const groups: MatcherGroup[] = []
    for (const rawGroup of rawGroups) {
      const group = asObject(rawGroup)
      if (!group || !Array.isArray(group.hooks)) continue
      const commands: MatcherGroup['hooks'] = []
      for (const rawHook of group.hooks) {
        const hook = asObject(rawHook)
        if (!hook) continue
        const type = typeof hook.type === 'string' ? hook.type : 'command'
        if (type !== 'command') { skipped.push({ event, reason: `unsupported "${type}" hook` }); continue }
        /* jscpd:ignore-end */
        if (hook.async === true) { skipped.push({ event, reason: 'async hook' }); continue }
        const windowsCommand = typeof hook.commandWindows === 'string'
          ? hook.commandWindows
          : hook.command_windows
        const command = platform === 'windows' && typeof windowsCommand === 'string'
          ? windowsCommand
          : hook.command
        if (typeof command !== 'string') continue
        // Codex accepts `timeout` or the `timeoutSec` alias.
        const timeout = typeof hook.timeout === 'number' ? hook.timeout
          : typeof hook.timeoutSec === 'number' ? hook.timeoutSec : undefined
        commands.push({ command, ...timeout !== undefined ? { timeoutSec: timeout } : {} })
      }
      if (commands.length === 0) continue
      const matcher = event === 'UserPromptSubmit' || event === 'Stop'
        ? undefined
        : typeof group.matcher === 'string' ? group.matcher : undefined
      const diagnostic = matcherDiagnostic(matcher, 'codex')
      if (diagnostic !== undefined) throw new SyntaxError(`${diagnostic} on event ${JSON.stringify(event)}`)
      groups.push({ ...matcher !== undefined ? { matcher } : {}, hooks: commands })
    }
    if (groups.length > 0) config[event] = groups
  }

  return { config, skipped }
}
