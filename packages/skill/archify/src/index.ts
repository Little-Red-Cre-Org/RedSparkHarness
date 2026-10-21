/**
 * Low-overhead automatic routing for the upstream Archify Skill.
 *
 * @module @deepseek-ai/dsh-archify
 */

import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { BashEnvContributor } from '@deepseek-ai/dsh-shell-env'
import {
  BUNDLED_SKILL_RANK,
  isUserInvocable,
  renderSkillContent,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'

export const name = 'archify'
export const inject = ['agents', 'skills', 'shellEnv']

const PROVIDER_NAME = 'archify'
const SKILL_NAME = 'archify'
const DEFAULT_MAX_USER_TEXT_CHARS = 4_096
const DEFAULT_REQUEST_PHRASES = [
  '生成', '输出', '绘制', '画出', '导出', '交付',
  'generate', 'create', 'render', 'draw', 'deliver', 'export',
]
const DEFAULT_DIAGRAM_PHRASES = [
  '架构图', '架构', '流程图', '时序图', '数据流', '生命周期', '状态机', '运行链路', '调用链', '拓扑', 'mermaid',
  'architecture', 'workflow', 'sequence diagram', 'data flow', 'lifecycle', 'state machine', 'runtime flow', 'call graph', 'topology', 'diagram',
]
const EXPLICIT_ARCHIFY_GESTURE = /(^|\s)\/archify(?=\s|$)/u
const require = createRequire(import.meta.url)
const archifyManifest = require.resolve('@tt-a1i/archify-dsh/package.json')
const ARCHIFY_SKILL_DIRECTORY = join(dirname(archifyManifest), 'skills', SKILL_NAME)
const ARCHIFY_SKILL_FILE = join(ARCHIFY_SKILL_DIRECTORY, 'SKILL.md')
const ARCHIFY_SKILL_DIRECTORY_ENV = 'DSH_ARCHIFY_SKILL_DIR' as const
const RESOURCE_BASE = {
  kind: 'opaque',
  description: `the pinned Archify package directory, available to shell commands as ${ARCHIFY_SKILL_DIRECTORY_ENV}`,
} as const
const INVOCATION = { modelInvocable: false, userInvocable: true } as const
const DESCRIPTION = 'Create validated architecture, workflow, sequence, data-flow, and lifecycle diagrams with the pinned Archify CLI. This hidden built-in skill is automatically loaded only for explicit diagram-delivery requests; use /archify to load it manually.'
const CANDIDATE: SkillCandidate = {
  name: SKILL_NAME,
  description: DESCRIPTION,
  invocation: INVOCATION,
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  rank: BUNDLED_SKILL_RANK,
  locator: ARCHIFY_SKILL_FILE,
}
const shellEnv: BashEnvContributor = {
  name: 'archify',
  variables: {
    [ARCHIFY_SKILL_DIRECTORY_ENV]: { description: 'Absolute directory containing the pinned Archify Skill resources and CLI.' },
  },
  resolve: () => ({ [ARCHIFY_SKILL_DIRECTORY_ENV]: ARCHIFY_SKILL_DIRECTORY }),
}

/** Automatic Archify routing controls. */
export interface Config {
  /** Whether matching direct user requests load Archify automatically; manual `/archify` remains available. */
  autoInvoke?: boolean
  /** Maximum direct-user characters scanned for one proposed step. */
  maxUserTextChars?: number
  /** Case-insensitive action phrases; one must occur before automatic loading. */
  requestPhrases?: string[]
  /** Case-insensitive diagram-domain phrases; one must occur before automatic loading. */
  diagramPhrases?: string[]
}

/** Validate the deployment-owned routing controls. */
export const Config: z<Config> = z.object({
  autoInvoke: z.boolean().default(true),
  maxUserTextChars: z.number().step(1).min(1).default(DEFAULT_MAX_USER_TEXT_CHARS),
  requestPhrases: z.array(z.string()).default([...DEFAULT_REQUEST_PHRASES]),
  diagramPhrases: z.array(z.string()).default([...DEFAULT_DIAGRAM_PHRASES]),
})

/** Durable source for one host-selected Archify instruction injection. */
export interface ArchifyAutoInvocationSource {
  readonly kind: 'archify-auto-invocation'
  /** The Skill body is injected as model instructions. */
  readonly form: 'instructions'
  /** The exact deterministic route that selected Archify. */
  readonly reason: 'diagram-delivery-request'
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'archify-auto-invocation': ArchifyAutoInvocationSource
  }
}

const provider: SkillProvider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve([CANDIDATE]),
  async get(_candidate, options): Promise<SkillDefinition> {
    options.signal?.throwIfAborted()
    const raw = await readFile(ARCHIFY_SKILL_FILE, { encoding: 'utf8', signal: options.signal })
    options.signal?.throwIfAborted()
    const [schemas, examples] = await Promise.all([
      readdir(join(ARCHIFY_SKILL_DIRECTORY, 'schemas')),
      readdir(join(ARCHIFY_SKILL_DIRECTORY, 'examples')),
    ])
    options.signal?.throwIfAborted()
    return { ...CANDIDATE, content: `${resourceInstructions(schemas, examples)}\n\n${skillBody(raw)}` }
  },
}

/** Register the hidden Archify Skill and deterministic automatic instruction route. */
export function apply(ctx: Context, config: Config = {}): void {
  const autoInvoke = config.autoInvoke ?? true
  const maxUserTextChars = config.maxUserTextChars ?? DEFAULT_MAX_USER_TEXT_CHARS
  const requestPhrases = normalizedPhrases(config.requestPhrases ?? DEFAULT_REQUEST_PHRASES, 'requestPhrases')
  const diagramPhrases = normalizedPhrases(config.diagramPhrases ?? DEFAULT_DIAGRAM_PHRASES, 'diagramPhrases')
  if (!Number.isInteger(maxUserTextChars) || maxUserTextChars < 1) {
    throw new Error('archify: maxUserTextChars must be a positive integer')
  }

  ctx.skills.registerProvider(() => provider)
  ctx.shellEnv.register(shellEnv)
  if (!autoInvoke) return

  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || !matchesDiagramDelivery(messages, maxUserTextChars, requestPhrases, diagramPhrases)) {
      return decision
    }
    signal.throwIfAborted()
    const skill = await ctx.skills.get(SKILL_NAME, { cwd: agent.session.header.cwd, signal, scope: agent })
    signal.throwIfAborted()
    if (skill === undefined || !isUserInvocable(skill)) return decision
    return {
      ...decision,
      messages: [...decision.messages, createUserMessage({
        content: [{ type: 'text', text: renderSkillContent(skill) }],
        source: { kind: 'archify-auto-invocation', form: 'instructions', reason: 'diagram-delivery-request' },
      })],
    }
  })
}

/** Explain the managed shell directory without persisting a host-specific package path. */
function resourceInstructions(schemas: readonly string[], examples: readonly string[]): string {
  return [
    '# Harness resource access — complete this before the upstream authoring steps',
    'Archify is already installed with Harness, outside the user repository. Searching the workspace or PATH for archify does not determine availability.',
    `First use the existing shell tool to obtain the resource directory: PowerShell: $env:${ARCHIFY_SKILL_DIRECTORY_ENV} | ConvertTo-Json -Compress; Bash: printf '%s\\n' "$${ARCHIFY_SKILL_DIRECTORY_ENV}".`,
    'The returned directory is the base for every schemas/, examples/, references/, assets/ and bin/ path below. File-read tools do not expand shell environment variables. Pass the resolved absolute path, never resolve these paths against the user workspace.',
    'When passing Windows paths through JavaScript or JSON, escape backslashes or use forward slashes; an unescaped backslash can become a tab or carriage return. run_code orchestrates tools; do not use require or assume process.env is the shell environment.',
    'Keep the shell workdir at the user workspace. Resolve candidate and output paths there; do not change into the installed Skill directory to write outputs.',
    'PowerShell examples (each command is self-contained):',
    '```powershell',
    `Get-Content -Raw -LiteralPath (Join-Path $env:${ARCHIFY_SKILL_DIRECTORY_ENV} 'schemas/common.schema.json')`,
    `Get-Content -Raw -LiteralPath (Join-Path $env:${ARCHIFY_SKILL_DIRECTORY_ENV} 'examples/web-app.architecture.json')`,
    `node (Join-Path $env:${ARCHIFY_SKILL_DIRECTORY_ENV} 'bin/archify.mjs') doctor`,
    `node (Join-Path $env:${ARCHIFY_SKILL_DIRECTORY_ENV} 'bin/archify.mjs') deliver architecture ./output/candidate.json ./output/diagram.html --quality showcase --json`,
    '```',
    'Bash equivalents:',
    '```bash',
    `cat "$${ARCHIFY_SKILL_DIRECTORY_ENV}/schemas/common.schema.json"`,
    `node "$${ARCHIFY_SKILL_DIRECTORY_ENV}/bin/archify.mjs" doctor`,
    `node "$${ARCHIFY_SKILL_DIRECTORY_ENV}/bin/archify.mjs" deliver architecture ./output/candidate.json ./output/diagram.html --quality showcase --json`,
    '```',
    'Installed JSON resources (choose matching names; do not invent architecture.json or lifecycle.json):',
    ...schemas.filter(file => file.endsWith('.json')).sort().map(file => `- schemas/${file}`),
    ...examples.filter(file => file.endsWith('.json')).sort().map(file => `- examples/${file}`),
    'When delegating diagram work, include this resource-access guidance and the resolved directory in the child task; a fresh child may not inherit these instructions.',
    'If a resource read or CLI command fails, report its exact path and error. Follow the existing permission policy for a denial; never bypass it. Do not claim Archify is unavailable solely because it is absent from PATH or the user repository.',
  ].join('\n')
}

/** Strip the fixed upstream Skill frontmatter without reparsing third-party metadata. */
function skillBody(raw: string): string {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0 || raw.slice(0, firstLineEnd).replace(/\r$/u, '') !== '---') {
    throw new Error('archify: upstream SKILL.md is missing YAML frontmatter')
  }
  let lineStart = firstLineEnd + 1
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    if (raw.slice(lineStart, lineEnd).replace(/\r$/u, '') === '---') {
      return raw.slice(nextNewline < 0 ? raw.length : nextNewline + 1).trim()
    }
    if (nextNewline < 0) break
    lineStart = nextNewline + 1
  }
  throw new Error('archify: upstream SKILL.md has unclosed YAML frontmatter')
}

/** Normalize deployment phrases once at load so each step only uses bounded substring checks. */
function normalizedPhrases(phrases: readonly string[], field: string): string[] {
  const result = phrases.map(phrase => phrase.trim().toLowerCase()).filter(Boolean)
  if (result.length === 0 || new Set(result).size !== result.length) {
    throw new Error(`archify: ${field} must contain unique non-empty phrases`)
  }
  return result
}

/** Match only direct user text that combines an explicit action with a diagram domain. */
function matchesDiagramDelivery(
  messages: readonly UserMessage[],
  maxUserTextChars: number,
  requestPhrases: readonly string[],
  diagramPhrases: readonly string[],
): boolean {
  let remaining = maxUserTextChars
  let hasRequest = false
  let hasDiagram = false
  for (const message of messages) {
    if ((message.source as { kind?: unknown }).kind !== 'user') continue
    for (const block of message.content) {
      if (block.type !== 'text' || remaining === 0) continue
      const text = block.text.slice(0, remaining)
      remaining -= text.length
      if (EXPLICIT_ARCHIFY_GESTURE.test(text)) return false
      const normalized = text.toLowerCase()
      hasRequest ||= requestPhrases.some(phrase => normalized.includes(phrase))
      hasDiagram ||= diagramPhrases.some(phrase => normalized.includes(phrase))
      if (hasRequest && hasDiagram) return true
    }
  }
  return false
}
