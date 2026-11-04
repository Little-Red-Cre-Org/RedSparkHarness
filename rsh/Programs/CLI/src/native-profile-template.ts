/** First-use compositions for the explicitly selected native profiles. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveRshHome } from '@redspark/rsh-home-paths'
import { type NativeProfileConfig } from './native-profile-config.ts'

const ROOT = 'root'
const STANDARD_PROFILE_COMPOSITIONS: Readonly<Record<string, string>> = {
  headless: 'native-headless',
  web: 'native-web',
  sdk: 'native-sdk',
  acp: 'native-acp',
  rsh: 'native-tui',
}

/**
 * Profile names whose first-use compositions ship with the CLI.
 *
 * Read on demand rather than at module load. A host that bundles this module cannot resolve the
 * CLI package from its own location, so a load-time manifest read would throw there even when it
 * never asks for a template.
 * @returns the declared `dsh.nativeProfileTemplates` names.
 */
function shippedNativeProfiles(): readonly string[] {
  const declared = cliNativeProfileTemplates()
  if (!Array.isArray(declared) || declared.some(name => typeof name !== 'string' || name === '')) {
    throw new Error('dsh: CLI package must declare its native profile templates')
  }
  return declared as readonly string[]
}

/** Profile names whose first-use compositions ship with the CLI. */
export function SHIPPED_NATIVE_PROFILES(): readonly string[] {
  return shippedNativeProfiles()
}

const NATIVE_WEB_CLIENT_INSTALLATIONS = [
  { id: 'application', plugin: '@redspark/rsh-client-native-application', config: { maxLiveTextChars: 100000, maxLiveEvents: 100000 } },
  { id: 'renderer', plugin: '@redspark/rsh-client-ui-renderer' },
  { id: 'connection', plugin: '@redspark/rsh-client-connection' },
  { id: 'session', plugin: '@redspark/rsh-client-native-session', config: { maxFollowBufferChars: 1000000 } },
  { id: 'locale', plugin: '@redspark/rsh-client-locale' },
  { id: 'theme', plugin: '@redspark/rsh-client-ui-theme' },
  { id: 'session-presentation', plugin: '@redspark/rsh-client-ui-session' },
  { id: 'layout', plugin: '@redspark/rsh-client-ui-layout' },
  { id: 'sidebar', plugin: '@redspark/rsh-client-ui-sidebar' },
  { id: 'sidebar-right', plugin: '@redspark/rsh-client-ui-sidebar-right' },
  { id: 'brand-official', plugin: '@redspark/rsh-client-ui-brand-official' },
  { id: 'input-trigger', plugin: '@redspark/rsh-client-ui-input-trigger' },
  { id: 'jobs', plugin: '@redspark/rsh-client-ui-jobs' },
  { id: 'message-feedback', plugin: '@redspark/rsh-client-ui-message-feedback' },
] as const

/** One shipped browser Client installation used by a native Web profile. */
export type NativeProfileClientInstallation = typeof NATIVE_WEB_CLIENT_INSTALLATIONS[number]

/**
 * Return the browser Client rows written for a shipped native profile.
 * @param name - requested standard or native profile name.
 * @returns the profile's Client installations, or an empty list without a Client composition.
 */
export function shippedNativeProfileClientComposition(name: string): readonly NativeProfileClientInstallation[] {
  const profile = STANDARD_PROFILE_COMPOSITIONS[name] ?? name
  return profile === 'native-web' ? NATIVE_WEB_CLIENT_INSTALLATIONS : []
}

function nativeWorkflowInstallations(subagentProvider: string, structuredOutput = true) {
  return [
    { id: 'workflow', plugin: '@redspark/rsh-workflow', scope: ROOT },
    { id: 'workflow-worker', plugin: '@redspark/rsh-workflow-worker-thread', scope: ROOT,
      config: { subagentProvider } },
    { id: 'workflow-tool', plugin: '@redspark/rsh-tool-workflow', scope: ROOT,
      config: { provider: 'worker-thread' } },
    ...(structuredOutput ? [{ id: 'ralph-tool', plugin: '@redspark/rsh-tool-ralph', scope: ROOT,
      config: { workflowProvider: 'worker-thread', subagentProvider } }] : []),
  ] as const
}

const NATIVE_COMPACTION_INSTALLATIONS = [
  { id: 'token-meter', plugin: '@redspark/rsh-token-meter', scope: ROOT },
  { id: 'tool-result-pruner', plugin: '@redspark/rsh-compaction-tool-result-pruner', scope: ROOT },
  { id: 'compaction', plugin: '@redspark/rsh-compaction-basic', scope: ROOT },
] as const

/** Plan guidance shared with the Cordis base bundle's `plan-mode` installation. */
const PLAN_MODE_SECTION = [
  'You are in plan mode. Stay in plan mode until exit_plan_mode succeeds or the user switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user\'s conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.\n\n',
  'Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.\n\n',
  'The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed only to keep the request shape stable. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.\n\n',
  'Resolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.\n\n',
  'Make the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.\n\n',
  'When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask "should I proceed?" through prose or ask_user_question. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable or aborted, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation.\n',
].join('')

/** Session titles: deterministic fallback plus the first-prompt model provider, as in the Cordis base bundle. */
const NATIVE_SESSION_TITLE_INSTALLATIONS = [
  { id: 'session-title', plugin: '@redspark/rsh-session-title', scope: ROOT,
    config: { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 } },
  { id: 'session-title-llm', plugin: '@redspark/rsh-session-title-first-prompt-llm', scope: ROOT,
    config: { targetWords: 5, targetCjkCharacters: 10, maxInputBytes: 4096, maxOutputTokens: 64, timeoutMs: 60000 } },
] as const

const STANDARD_PERSONA = {
  prefix: 'You are a coding agent powered by the {{model}} model.',
  suffix: 'Your working directory is {{cwd}}.',
} as const

const CREATION_PERSONA = {
  prefix: "You are a coding agent powered by the {{model}} model, running on the RedSpark Harness.\n\nYou author Native modules and Agent presets. Do not write cordis.yml, and do not call cordis_define, cordis_run, cordis_inspect, or cordis_mount.\n\nA Native module is a package the Host resolves. package.json sets \"type\": \"module\" and dsh.native with apiVersion 1, entry \"./native\", targets, requires, optional, and provides. src/native.ts exports plugin with the same name, targets, requires, and provides. resolve(input) returns (context) => { ... }. context.require reads a service named in requires. context.effect registers work the Host disposes. The manifest requires list must equal the plugin requires list.\n\nWriting a package does not install it. The profile must already resolve the package name before an installation row can load it.\n\nA preset is one directory under the Harness home's `.agent-presets/<id>/` directory with preset.yml and agent.native.json. Resolve that home at runtime rather than assuming a name, and take the real path of an existing preset from the roster. agent.native.json uses formatVersion 1. Each installation has id, plugin, and optional config and disabled. The Host installs those rows into that preset's scope. Shared services stay in rsh.profile.json. A preset owns only the rows that should apply to sessions that select it.\n\nDo not edit or delete shipped presets. Copy one into a new directory under .agent-presets and edit the copy.\n\nLoad editing-native-presets before changing a preset. Load native-module-development before creating a Native module.",
  suffix: 'Your working directory is {{cwd}}.',
} as const

const NATIVE_AGENT_PRESET_INSTALLATIONS = [
  { id: 'agent-presets', plugin: '@redspark/rsh-agent-presets', scope: ROOT, config: { default: 'standard' } },
  { id: 'preset-standard', plugin: '@redspark/rsh-agent-preset-standing', scope: 'standard',
    config: { id: 'standard', name: 'Standard', description: 'Goal planning and task tracking tools.' } },
  { id: 'preset-minimal', plugin: '@redspark/rsh-agent-preset-standing', scope: 'minimal',
    config: { id: 'minimal', name: 'Minimal', description: 'Task tracking tools without Goal tools.' } },
  { id: 'preset-ptc', plugin: '@redspark/rsh-agent-preset-standing', scope: 'ptc',
    config: { id: 'ptc', name: 'PTC 模式', description: '功能完整的编码 Agent，但默认不提供 workflow 工具；其他工具通过 PTC 模式 SDK 呈现，让模型用一个 TypeScript 程序组合多步操作。' } },
  { id: 'preset-creation', plugin: '@redspark/rsh-agent-preset-standing', scope: 'creation',
    config: { id: 'creation', name: '创造模式', description: '用于创建自定义 Agent preset 和 Native 模块：具备标准模式的全部能力，并提供 Native 创作指导。' } },
  { id: 'persona-standard', plugin: '@redspark/rsh-native-persona', scope: 'standard', config: STANDARD_PERSONA },
  { id: 'persona-ptc', plugin: '@redspark/rsh-native-persona', scope: 'ptc', config: STANDARD_PERSONA },
  { id: 'persona-creation', plugin: '@redspark/rsh-native-persona', scope: 'creation', config: CREATION_PERSONA },
  { id: 'code-tool-ptc', plugin: '@redspark/rsh-tool-code-runtime', scope: 'ptc',
    config: { sdkPrompt: true, presentation: 'ptc', denyTools: ['workflow'] } },
] as const

/**
 * Root of the CLI package whose manifest declares the shipped profile templates.
 *
 * Defaults to this module's own package. A host that bundles this module into its own program
 * cannot use that default: `import.meta.url` then describes the host's bundle, and the host's
 * `package.json` declares no templates. Such a host names its CLI package through
 * {@link setCliPackageRoot} before it builds a profile.
 */
let cliPackageRoot: string | undefined

/**
 * Point template resolution at one CLI package.
 * @param root - absolute path of the installed CLI package directory.
 */
export function setCliPackageRoot(root: string): void {
  cliPackageRoot = root
}

function cliRuntimeRoot(): string {
  return cliPackageRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), '..')
}

/**
 * Read this CLI package's declared native profile templates at runtime.
 * @returns the `dsh.nativeProfileTemplates` value, or `undefined` when the manifest does not declare it.
 */
function cliNativeProfileTemplates(): unknown {
  const manifest: unknown = JSON.parse(readFileSync(join(cliRuntimeRoot(), 'package.json'), 'utf8'))
  const dsh = typeof manifest === 'object' && manifest !== null && 'dsh' in manifest
    ? (manifest as { dsh?: unknown }).dsh : undefined
  return typeof dsh === 'object' && dsh !== null ? (dsh as { nativeProfileTemplates?: unknown }).nativeProfileTemplates : undefined
}

function isShippedNativeProfile(name: string): boolean {
  return SHIPPED_NATIVE_PROFILES().includes(name)
}

function isHeadlessProfile(profile: string): boolean {
  return profile === 'native-headless' || profile === 'native-headless-query'
}

/**
 * Resolve a shipped native composition for the selected platform.
 * @param home - Harness home used by durable providers.
 * @param name - shipped standard or native profile name.
 * @param platform - target platform for command providers and tools.
 * @param options - Optional paths for the profile.
 * @param options.profileDirectory - Profile directory used by the native Web Host.
 * @returns the profile configuration installed on first use.
 * @remarks Native SDK, SDK-child, ACP and ACP-child profiles install workspace instructions through their selected filesystem Provider.
 */
export function shippedNativeProfileComposition(
  home: string,
  name: string,
  platform: NodeJS.Platform = process.platform,
  options: { readonly profileDirectory?: string } = {},
): NativeProfileConfig {
  if (!isShippedNativeProfile(name)) throw new Error(`dsh: unknown native profile template ${JSON.stringify(name)}`)
  const profile = STANDARD_PROFILE_COMPOSITIONS[name] ?? name
  if (profile === 'native-acp-dsh-child') {
    const parent = shippedNativeProfileComposition(home, 'native-acp', platform)
    const recursiveInstallations = new Set([
      'subagents', 'subagent-controls', 'subagent-directory', 'subagent-tool',
      'workflow', 'workflow-worker', 'workflow-tool', 'ralph-tool',
    ])
    return {
      ...parent,
      installations: parent.installations.flatMap((row) => {
        if (recursiveInstallations.has(row.id)) return []
        if (row.id === 'app') return [{ ...row, config: { ...(row.config as Record<string, unknown>), builtinTools: false, allowedTools: [] } }]
        if (row.id === 'fs') return [
          { id: 'sandbox-policy', plugin: '@redspark/rsh-native-sandbox-policy', scope: ROOT,
            config: { mode: 'workspace-write', workspaceRoot: process.cwd() } },
          { ...row, plugin: '@redspark/rsh-fs-sandbox' },
        ]
        return [row]
      }),
    }
  }
  if (profile === 'native-sdk' || profile === 'native-sdk-dsh-child' || profile === 'native-acp') return {
    formatVersion: 1,
    scopes: [{ id: ROOT }],
    installations: [
      { id: 'app', plugin: profile === 'native-acp' ? '@redspark/rsh-native-acp' : '@redspark/rsh-native-sdk-server', scope: ROOT,
        config: { ...(profile === 'native-acp' ? { provider: 'deepseek-official', model: 'deepseek-v4-flash' } : {}),
          systemPrompt: 'You are a helpful coding assistant.', maxSteps: 8 } },
      { id: 'session-execution', plugin: '@redspark/rsh-native-session-execution', scope: ROOT },
      ...(profile === 'native-acp' ? [{ id: 'model-selection', plugin: '@redspark/rsh-native-model-selection', scope: ROOT }] : []),
      ...(profile === 'native-acp' ? [{ id: 'approval', plugin: '@redspark/rsh-native-approval', scope: ROOT }] : []),
      { id: 'jobs', plugin: '@redspark/rsh-native-jobs', scope: ROOT },
      { id: 'tool-jobs', plugin: '@redspark/rsh-native-tool-jobs', scope: ROOT },
      { id: 'tools', plugin: '@redspark/rsh-native-tools', scope: ROOT },
      { id: 'prompt', plugin: '@redspark/rsh-native-prompt', scope: ROOT },
      { id: 'subagents', plugin: '@redspark/rsh-native-subagent', scope: ROOT,
        config: { providerName: profile === 'native-sdk-dsh-child' ? 'dsh-sdk' : 'spawn' } },
      ...(profile === 'native-sdk-dsh-child' ? [
        { id: 'child-subprocess', plugin: '@redspark/rsh-subprocess-local', scope: ROOT },
        { id: 'sandbox-policy', plugin: '@redspark/rsh-native-sandbox-policy', scope: ROOT,
          config: { mode: 'workspace-write', workspaceRoot: process.cwd() } },
        { id: 'process-sandbox', plugin: '@redspark/rsh-sandbox-local', scope: ROOT },
        { id: 'approval', plugin: '@redspark/rsh-native-approval', scope: ROOT, config: { policy: 'ask' } },
        { id: 'dsh-sdk-child', plugin: '@redspark/rsh-sdk-child', scope: ROOT,
          config: { providerName: 'dsh-sdk' } },
      ] : []),
      { id: 'subagent-controls', plugin: '@redspark/rsh-tool-subagent-control', scope: ROOT },
      { id: 'subagent-directory', plugin: '@redspark/rsh-native-tool-subagent-list-agents', scope: ROOT },
      { id: 'subagent-tool', plugin: '@redspark/rsh-tool-subagent', scope: ROOT,
        config: { toolName: 'subagent', maxDepth: 3 } },
      ...nativeWorkflowInstallations(profile === 'native-sdk-dsh-child' ? 'dsh-sdk' : 'spawn', profile !== 'native-sdk-dsh-child'),
      { id: 'agents', plugin: '@redspark/rsh-native-agent', scope: ROOT },
      { id: 'commands', plugin: '@redspark/rsh-commands', scope: ROOT },
      { id: 'model-execution', plugin: '@redspark/rsh-native-model-execution', scope: ROOT },
      { id: 'llm-retry', plugin: '@redspark/rsh-llm-retry', scope: ROOT },
      ...NATIVE_COMPACTION_INSTALLATIONS,
      { id: 'command-compact', plugin: '@redspark/rsh-command-compact', scope: ROOT },
      { id: 'timeout-policy', plugin: '@redspark/rsh-tool-call-timeout-policy', scope: ROOT },
      { id: 'repeat-tool-reminder', plugin: '@redspark/rsh-repeat-tool-reminder', scope: ROOT,
        config: { thresholds: [3, 5, 8], argumentsPreviewChars: 500 } },
      { id: 'storage', plugin: '@redspark/rsh-session-persistence-jsonl', scope: ROOT,
        config: { root: join(home, 'sessions'), compression: 'none' } },
      { id: 'attachments', plugin: '@redspark/rsh-attachment-local', scope: ROOT,
        config: { rshHome: home } },
      { id: 'fs', plugin: profile === 'native-sdk-dsh-child' ? '@redspark/rsh-fs-sandbox' : '@redspark/rsh-fs-local', scope: ROOT },
      { id: 'agent-instructions', plugin: '@redspark/rsh-agent-instructions', scope: ROOT,
        config: { maxBytes: 65_536 } },
      { id: 'credentials', plugin: '@redspark/rsh-credentials-local', scope: ROOT },
      { id: 'pi-ai', plugin: '@redspark/rsh-llm-pi-ai', scope: ROOT,
        config: { providers: { 'deepseek-official': { apiKeyEnv: 'DEEPSEEK_API_KEY', api: 'openai-completions',
          baseURL: 'https://api.deepseek.com/v1', models: [{ id: 'deepseek-v4-flash' }] } } } },
    ],
  }
  const windows = platform === 'win32'
  return {
    formatVersion: 1,
    scopes: profile === 'native-web' || profile === 'native-tui'
      ? [{ id: ROOT }, { id: 'standard', parent: ROOT }, { id: 'minimal', parent: ROOT }, { id: 'ptc', parent: ROOT }, { id: 'creation', parent: ROOT }]
      : [{ id: ROOT }],
    installations: [
      {
        id: 'app',
        plugin: profile === 'native-web'
          ? '@redspark/rsh-native-web-host'
          : profile === 'native-tui' ? '@redspark/rsh-native-tui' : '@redspark/rsh-native-headless',
        scope: ROOT,
        config: profile === 'native-web'
          ? { projectDir: options.profileDirectory ?? join(home, 'profiles', name), runtimeDir: cliRuntimeRoot(), clientReload: 'live', maxRequestBodyBytes: 300 * 1024 * 1024 }
          : { provider: 'deepseek', model: 'deepseek-flash', systemPrompt: 'You are a helpful coding assistant.', maxSteps: 8,
            ...(profile === 'native-headless' || profile === 'native-headless-query' ? { cwd: process.cwd() } : {}),
            ...(profile === 'native-tui' ? { cwd: process.cwd(), locale: 'en', background: '#000000', maxQueuedInputs: 32, maxHistoryEvents: 100000, maxTranscriptEvents: 500, maxStreamChunks: 500, maxPendingHumanRequests: 32 } : {}) },
      },
      ...(profile === 'native-web' ? [{ id: 'model-selection', plugin: '@redspark/rsh-native-model-selection', scope: ROOT }] : []),
      ...(profile === 'native-web' ? [
        { id: 'storage-hub', plugin: '@redspark/rsh-storage', scope: ROOT },
        { id: 'storage-json', plugin: '@redspark/rsh-storage-json', scope: ROOT,
          config: { root: join(home, 'storages') } },
        { id: 'storage-domain', plugin: '@redspark/rsh-storage-domain', scope: ROOT,
          config: { backend: 'json' } },
      ] : []),
      ...(profile === 'native-web' ? [{
        id: 'session-controller',
        plugin: '@redspark/rsh-native-web-session-controller',
        scope: ROOT,
        config: { cwd: process.cwd(), provider: 'deepseek', model: 'deepseek-flash', systemPrompt: 'You are a helpful coding assistant.', maxSteps: 8, maxPendingRequests: 32, maxHistoryEvents: 100000, maxPromptChars: 100000, maxFollowBufferBytes: 4000000, maxFollowers: 32, maxPendingHumanRequests: 32,
          authorizationKeys: ['llm-pi-ai/openai-codex', 'deepseek-account/default'],
          workspaceRoutes: { maxRoutes: 64, allowedRoots: [process.cwd()] } },
      }] : []),
      ...(profile === 'native-tui' ? [{ id: 'model-selection', plugin: '@redspark/rsh-native-model-selection', scope: ROOT }] : []),
      ...(profile === 'native-tui' ? [
        { id: 'user-questions', plugin: '@redspark/rsh-user-questions', scope: ROOT },
        { id: 'ask-user-tool', plugin: '@redspark/rsh-tool-ask-user', scope: ROOT },
        { id: 'commands', plugin: '@redspark/rsh-commands', scope: ROOT },
        { id: 'command-feedback', plugin: '@redspark/rsh-command-feedback', scope: ROOT },
        { id: 'command-goal', plugin: '@redspark/rsh-command-goal', scope: ROOT },
        { id: 'command-compact', plugin: '@redspark/rsh-command-compact', scope: ROOT },
      ] : []),
      ...(profile === 'native-web' ? [
        { id: 'commands', plugin: '@redspark/rsh-commands', scope: ROOT },
        { id: 'command-feedback', plugin: '@redspark/rsh-command-feedback', scope: ROOT },
        { id: 'command-compact', plugin: '@redspark/rsh-command-compact', scope: ROOT },
        { id: 'message-feedback', plugin: '@redspark/rsh-message-feedback', scope: ROOT, config: { maxNoteBytes: 8192 } },
      ] : []),
      ...(profile === 'native-web' || profile === 'native-tui' ? [
        { id: 'plan-mode', plugin: '@redspark/rsh-plan-mode', scope: ROOT, config: { section: PLAN_MODE_SECTION } },
        ...NATIVE_AGENT_PRESET_INSTALLATIONS,
      ] : []),
      { id: 'agents', plugin: '@redspark/rsh-native-agent', scope: ROOT },
      { id: 'session-execution', plugin: '@redspark/rsh-native-session-execution', scope: ROOT },
      ...(isHeadlessProfile(profile) ? [
        ...(profile === 'native-headless-query' ? [
          { id: 'storage-hub', plugin: '@redspark/rsh-storage', scope: ROOT },
          { id: 'storage-json', plugin: '@redspark/rsh-storage-json', scope: ROOT,
            config: { root: join(home, 'storages') } },
          { id: 'storage-domain', plugin: '@redspark/rsh-storage-domain', scope: ROOT,
            config: { backend: 'json' } },
          { id: 'session-projections', plugin: '@redspark/rsh-session-projection', scope: ROOT },
          { id: 'context-insight', plugin: '@redspark/rsh-context-insight', scope: ROOT },
          { id: 'session-projection-cache', plugin: '@redspark/rsh-session-projection-cache', scope: ROOT,
            config: { writeEveryEvents: 200, writeIntervalMs: 5000 } },
          { id: 'session-query', plugin: '@redspark/rsh-session-query-sqlite', scope: ROOT,
            config: { path: join(home, 'sessions', 'query.sqlite'), openAt: 'first-search' } },
          { id: 'tool-session-query', plugin: '@redspark/rsh-tool-session-query', scope: ROOT },
        ] : [{ id: 'session-query', plugin: '@redspark/rsh-session-query', scope: ROOT }]),
        { id: 'session-reference', plugin: '@redspark/rsh-session-reference', scope: ROOT },
      ] : []),
      ...(profile === 'native-web' || profile === 'native-tui' ? NATIVE_SESSION_TITLE_INSTALLATIONS : []),
      ...(isHeadlessProfile(profile) ? [
        { id: 'goal', plugin: '@redspark/rsh-goal', scope: ROOT },
        { id: 'goal-round-driver', plugin: '@redspark/rsh-goal-round-driver', scope: ROOT },
        { id: 'tool-goal', plugin: '@redspark/rsh-tool-goal', scope: ROOT },
      ] : []),
      ...(profile === 'native-tui' ? [
        { id: 'goal', plugin: '@redspark/rsh-goal', scope: ROOT },
        { id: 'goal-round-driver', plugin: '@redspark/rsh-goal-round-driver', scope: ROOT },
        { id: 'tool-goal', plugin: '@redspark/rsh-tool-goal', scope: 'standard' },
      ] : []),
      ...(profile === 'native-web' ? [
        { id: 'goal', plugin: '@redspark/rsh-goal', scope: ROOT },
        { id: 'goal-round-driver', plugin: '@redspark/rsh-goal-round-driver', scope: ROOT },
        { id: 'tool-goal', plugin: '@redspark/rsh-tool-goal', scope: ROOT },
      ] : []),
      { id: 'jobs', plugin: '@redspark/rsh-native-jobs', scope: ROOT },
      { id: 'tools', plugin: '@redspark/rsh-native-tools', scope: ROOT },
      { id: 'prompt', plugin: '@redspark/rsh-native-prompt', scope: ROOT },
      { id: 'subagents', plugin: '@redspark/rsh-native-subagent', scope: ROOT, config: { providerName: 'spawn' } },
      ...nativeWorkflowInstallations('spawn'),
      { id: 'agent-instructions', plugin: '@redspark/rsh-agent-instructions', scope: ROOT,
        config: { maxBytes: 65_536 } },
      { id: 'time-context', plugin: '@redspark/rsh-native-time-context', scope: ROOT },
      ...(isHeadlessProfile(profile) ? [{ id: 'tmux-context', plugin: '@redspark/rsh-native-tmux-context', scope: ROOT, disabled: true }] : []),
      { id: 'tool-jobs', plugin: '@redspark/rsh-native-tool-jobs', scope: ROOT },
      { id: 'tool-todo', plugin: '@redspark/rsh-tool-todo', scope: profile === 'native-tui' ? 'standard' : ROOT,
        config: { allowParallelInProgress: true } },
      ...(profile === 'native-tui' ? [{ id: 'tool-todo-minimal', plugin: '@redspark/rsh-tool-todo', scope: 'minimal',
        config: { allowParallelInProgress: true } }] : []),
      { id: 'model-execution', plugin: '@redspark/rsh-native-model-execution', scope: ROOT },
      { id: 'llm-retry', plugin: '@redspark/rsh-llm-retry', scope: ROOT },
      ...NATIVE_COMPACTION_INSTALLATIONS,
      ...(profile === 'native-acp' ? [
        { id: 'commands', plugin: '@redspark/rsh-commands', scope: ROOT },
        { id: 'command-feedback', plugin: '@redspark/rsh-command-feedback', scope: ROOT },
        { id: 'command-compact', plugin: '@redspark/rsh-command-compact', scope: ROOT },
      ] : []),
      { id: 'timeout-policy', plugin: '@redspark/rsh-tool-call-timeout-policy', scope: ROOT },
      { id: 'repeat-tool-reminder', plugin: '@redspark/rsh-repeat-tool-reminder', scope: ROOT,
        config: { thresholds: [3, 5, 8], argumentsPreviewChars: 500 } },
      ...(profile === 'native-web' || profile === 'native-tui' ? [{
        id: 'task-scheduler', plugin: '@redspark/rsh-task-scheduler', scope: ROOT,
        config: { path: join(options.profileDirectory ?? join(home, 'profiles', name), 'task-scheduler.sqlite') },
      }] : []),
      ...(profile === 'native-web' ? [{ id: 'schedule-controller', plugin: '@redspark/rsh-native-schedule-controller', scope: ROOT }] : []),
      ...(profile === 'native-web' ? [{ id: 'jobs-controller', plugin: '@redspark/rsh-native-jobs-controller', scope: ROOT }] : []),
      ...(profile === 'native-web' ? [{ id: 'workspace', plugin: '@redspark/rsh-workspace', scope: ROOT }] : []),
      { id: 'storage', plugin: '@redspark/rsh-session-persistence-jsonl', scope: ROOT,
        config: { root: join(home, 'sessions'), compression: 'none' } },
      { id: 'attachments', plugin: '@redspark/rsh-attachment-local', scope: ROOT,
        config: { rshHome: home } },
      { id: 'sandbox-policy', plugin: '@redspark/rsh-native-sandbox-policy', scope: ROOT,
        config: { mode: 'workspace-write', workspaceRoot: process.cwd() } },
      { id: 'fs', plugin: '@redspark/rsh-fs-sandbox', scope: ROOT },
      { id: 'policy', plugin: '@redspark/rsh-fs-observation-policy', scope: ROOT },
      { id: 'file-tools', plugin: '@redspark/rsh-tool-fs', scope: ROOT },
      ...(isHeadlessProfile(profile) || profile === 'native-web'
        ? [{ id: 'file-reference', plugin: '@redspark/rsh-native-file-reference-local', scope: ROOT }]
        : []),
      { id: 'subprocess', plugin: '@redspark/rsh-subprocess-local', scope: ROOT },
      { id: 'sandbox', plugin: '@redspark/rsh-sandbox-local', scope: ROOT },
      { id: 'code-runtime', plugin: '@redspark/rsh-code-runtime-process-sandbox', scope: ROOT },
      { id: 'shell-env', plugin: '@redspark/rsh-shell-env', scope: ROOT },
      { id: 'bash', plugin: windows ? '@redspark/rsh-pwsh-sandbox' : '@redspark/rsh-bash-sandbox', scope: ROOT },
      { id: 'spill-store', plugin: '@redspark/rsh-spill-local', scope: ROOT },
      { id: 'search-tools', plugin: '@redspark/rsh-tool-fs-search', scope: ROOT,
        config: { sampleOverCapGlobResults: false } },
      { id: 'web', plugin: '@redspark/rsh-web', scope: ROOT,
        config: { searchProvider: 'deepseek-official', fetchProvider: 'http' } },
      { id: 'web-search-deepseek', plugin: '@redspark/rsh-web-search-deepseek', scope: ROOT,
        config: { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
      { id: 'web-fetch-http', plugin: '@redspark/rsh-web-fetch-http', scope: ROOT },
      { id: 'tool-web', plugin: '@redspark/rsh-tool-web', scope: ROOT,
        config: { fetch: true, searchTimeoutMs: 60000 } },
      ...(profile === 'native-web' ? [{ id: 'user-questions', plugin: '@redspark/rsh-user-questions', scope: ROOT },
        { id: 'tool-ask-user', plugin: '@redspark/rsh-tool-ask-user', scope: ROOT }] : []),
      { id: 'approval', plugin: '@redspark/rsh-native-approval', scope: ROOT },
      ...(profile === 'native-web' ? [{ id: 'permission-presets', plugin: '@redspark/rsh-permission-presets', scope: ROOT }] : []),
      { id: 'bash-tool', plugin: windows ? '@redspark/rsh-tool-pwsh' : '@redspark/rsh-tool-bash', scope: ROOT },
      { id: 'credentials', plugin: '@redspark/rsh-credentials-local', scope: ROOT },
      { id: 'settings', plugin: '@redspark/rsh-settings-file', scope: ROOT,
        config: { rshHome: home } },
      { id: 'pi-ai', plugin: '@redspark/rsh-llm-pi-ai', scope: ROOT,
        config: { providers: { deepseek: { apiKeyEnv: 'DEEPSEEK_API_KEY', displayName: 'DeepSeek' } } } },
      ...(profile === 'native-web' ? [
        { id: 'authorization', plugin: '@redspark/rsh-authorization', scope: ROOT },
        { id: 'deepseek-account', plugin: '@redspark/rsh-deepseek-account', scope: ROOT },
      ] : []),
    ],
  }
}

/**
 * Create the shipped native profile once without replacing an existing user directory.
 * @param name - requested profile name.
 * @param home - Harness home containing the profile and Session store.
 */
export function ensureShippedNativeProfile(name: string, home: string = resolveRshHome()): void {
  if (!isShippedNativeProfile(name)) return
  const profiles = join(home, 'profiles')
  const directory = join(profiles, name)
  if (existsSync(join(directory, 'package.json'))) return
  mkdirSync(profiles, { recursive: true })
  mkdirSync(directory, { recursive: true })
  const profile = STANDARD_PROFILE_COMPOSITIONS[name] ?? name
  writeFileSync(join(directory, 'rsh.profile.json'), `${JSON.stringify(shippedNativeProfileComposition(home, name), null, 2)}\n`, { flag: 'wx' })
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify({
    name: `dsh-profile-${name}`, private: true,
    dsh: { profile: { runtime: 'native', config: 'rsh.profile.json', configReload: profile === 'native-web' ? 'live' : 'startup' } },
  }, null, 2)}\n`, { flag: 'wx' })
  if (profile === 'native-web') {
    writeFileSync(join(directory, 'rsh.client.json'), `${JSON.stringify({
      formatVersion: 1, installations: NATIVE_WEB_CLIENT_INSTALLATIONS,
    }, null, 2)}\n`, { flag: 'wx' })
  }
}
