/** First-use compositions for the explicitly selected native profiles. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { profileRuntime, type NativeProfileConfig } from './native-profile-config.ts'

const ROOT = 'root'

interface CliManifest {
  dsh?: { nativeProfileTemplates?: unknown }
}

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as CliManifest
const nativeProfileTemplates = manifest.dsh?.nativeProfileTemplates
if (!Array.isArray(nativeProfileTemplates) || nativeProfileTemplates.some(name => typeof name !== 'string' || name === '')) {
  throw new Error('dsh: CLI package must declare its native profile templates')
}

/** Profile names whose first-use compositions ship with the CLI. */
export const SHIPPED_NATIVE_PROFILES: readonly string[] = nativeProfileTemplates

const NATIVE_WEB_CLIENT_INSTALLATIONS = [
  { id: 'application', plugin: '@deepseek-ai/dsh-client-native-application', config: { maxLiveTextChars: 100000, maxLiveEvents: 100000 } },
  { id: 'renderer', plugin: '@deepseek-ai/dsh-client-ui-renderer' },
  { id: 'connection', plugin: '@deepseek-ai/dsh-client-connection' },
  { id: 'session', plugin: '@deepseek-ai/dsh-client-native-session', config: { maxFollowBufferChars: 1000000 } },
  { id: 'locale', plugin: '@deepseek-ai/dsh-client-locale' },
  { id: 'theme', plugin: '@deepseek-ai/dsh-client-ui-theme' },
  { id: 'session-presentation', plugin: '@deepseek-ai/dsh-client-ui-session' },
  { id: 'layout', plugin: '@deepseek-ai/dsh-client-ui-layout' },
  { id: 'sidebar', plugin: '@deepseek-ai/dsh-client-ui-sidebar' },
  { id: 'sidebar-right', plugin: '@deepseek-ai/dsh-client-ui-sidebar-right' },
] as const

function nativeWorkflowInstallations(subagentProvider: string, structuredOutput = true) {
  return [
    { id: 'workflow', plugin: '@deepseek-ai/dsh-workflow', scope: ROOT },
    { id: 'workflow-worker', plugin: '@deepseek-ai/dsh-workflow-worker-thread', scope: ROOT,
      config: { subagentProvider } },
    { id: 'workflow-tool', plugin: '@deepseek-ai/dsh-tool-workflow', scope: ROOT,
      config: { provider: 'worker-thread' } },
    ...(structuredOutput ? [{ id: 'ralph-tool', plugin: '@deepseek-ai/dsh-tool-ralph', scope: ROOT,
      config: { workflowProvider: 'worker-thread', subagentProvider } }] : []),
  ] as const
}

const NATIVE_COMPACTION_INSTALLATIONS = [
  { id: 'token-meter', plugin: '@deepseek-ai/dsh-token-meter', scope: ROOT },
  { id: 'tool-result-pruner', plugin: '@deepseek-ai/dsh-compaction-tool-result-pruner', scope: ROOT },
  { id: 'compaction', plugin: '@deepseek-ai/dsh-compaction-basic', scope: ROOT },
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
  { id: 'session-title', plugin: '@deepseek-ai/dsh-session-title', scope: ROOT,
    config: { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 } },
  { id: 'session-title-llm', plugin: '@deepseek-ai/dsh-session-title-first-prompt-llm', scope: ROOT,
    config: { targetWords: 5, targetCjkCharacters: 10, maxInputBytes: 4096, maxOutputTokens: 64, timeoutMs: 60000 } },
] as const

function cliRuntimeRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..')
}

function isShippedNativeProfile(name: string): boolean {
  return SHIPPED_NATIVE_PROFILES.includes(name)
}

/**
 * Resolve a shipped native composition for the selected platform.
 * @param home - Harness home used by durable providers.
 * @param profile - shipped profile name.
 * @param platform - target platform for command providers and tools.
 * @returns the profile configuration installed on first use.
 */
export function shippedNativeProfileComposition(
  home: string,
  profile: string,
  platform: NodeJS.Platform = process.platform,
): NativeProfileConfig {
  if (!isShippedNativeProfile(profile)) throw new Error(`dsh: unknown native profile template ${JSON.stringify(profile)}`)
  if (profile === 'native-sdk' || profile === 'native-sdk-dsh-child' || profile === 'native-acp') return {
    formatVersion: 1,
    scopes: [{ id: ROOT }],
    installations: [
      { id: 'app', plugin: profile === 'native-acp' ? '@deepseek-ai/dsh-native-acp' : '@deepseek-ai/dsh-native-sdk-server', scope: ROOT,
        config: { ...(profile === 'native-acp' ? { provider: 'deepseek-official', model: 'deepseek-v4-flash' } : {}),
          systemPrompt: 'You are a helpful coding assistant.', maxSteps: 8 } },
      { id: 'session-execution', plugin: '@deepseek-ai/dsh-native-session-execution', scope: ROOT },
      ...(profile === 'native-acp' ? [{ id: 'model-selection', plugin: '@deepseek-ai/dsh-native-model-selection', scope: ROOT }] : []),
      ...(profile === 'native-acp' ? [{ id: 'approval', plugin: '@deepseek-ai/dsh-native-approval', scope: ROOT }] : []),
      { id: 'jobs', plugin: '@deepseek-ai/dsh-native-jobs', scope: ROOT },
      { id: 'tool-jobs', plugin: '@deepseek-ai/dsh-native-tool-jobs', scope: ROOT },
      { id: 'tools', plugin: '@deepseek-ai/dsh-native-tools', scope: ROOT },
      { id: 'prompt', plugin: '@deepseek-ai/dsh-native-prompt', scope: ROOT },
      { id: 'subagents', plugin: '@deepseek-ai/dsh-native-subagent', scope: ROOT,
        config: { providerName: profile === 'native-sdk-dsh-child' ? 'dsh-sdk' : 'spawn' } },
      ...(profile === 'native-sdk-dsh-child' ? [
        { id: 'child-subprocess', plugin: '@deepseek-ai/dsh-subprocess-local', scope: ROOT },
        { id: 'sandbox-policy', plugin: '@deepseek-ai/dsh-native-sandbox-policy', scope: ROOT,
          config: { mode: 'workspace-write', workspaceRoot: process.cwd() } },
        { id: 'process-sandbox', plugin: '@deepseek-ai/dsh-sandbox-local', scope: ROOT },
        { id: 'approval', plugin: '@deepseek-ai/dsh-native-approval', scope: ROOT, config: { policy: 'ask' } },
        { id: 'dsh-sdk-child', plugin: '@deepseek-ai/dsh-sdk-child', scope: ROOT,
          config: { providerName: 'dsh-sdk' } },
      ] : []),
      { id: 'subagent-controls', plugin: '@deepseek-ai/dsh-tool-subagent-control', scope: ROOT },
      { id: 'subagent-directory', plugin: '@deepseek-ai/dsh-native-tool-subagent-list-agents', scope: ROOT },
      { id: 'subagent-tool', plugin: '@deepseek-ai/dsh-tool-subagent', scope: ROOT,
        config: { toolName: 'subagent', maxDepth: 3 } },
      ...nativeWorkflowInstallations(profile === 'native-sdk-dsh-child' ? 'dsh-sdk' : 'spawn', profile !== 'native-sdk-dsh-child'),
      { id: 'agents', plugin: '@deepseek-ai/dsh-native-agent', scope: ROOT },
      { id: 'model-execution', plugin: '@deepseek-ai/dsh-native-model-execution', scope: ROOT },
      { id: 'llm-retry', plugin: '@deepseek-ai/dsh-llm-retry', scope: ROOT },
      { id: 'timeout-policy', plugin: '@deepseek-ai/dsh-tool-call-timeout-policy', scope: ROOT },
      { id: 'repeat-tool-reminder', plugin: '@deepseek-ai/dsh-repeat-tool-reminder', scope: ROOT,
        config: { thresholds: [3, 5, 8], argumentsPreviewChars: 500 } },
      { id: 'storage', plugin: '@deepseek-ai/dsh-session-persistence-jsonl', scope: ROOT,
        config: { root: join(home, 'sessions'), compression: 'none' } },
      { id: 'attachments', plugin: '@deepseek-ai/dsh-attachment-local', scope: ROOT,
        config: { dshHome: home } },
      { id: 'fs', plugin: profile === 'native-sdk-dsh-child' ? '@deepseek-ai/dsh-fs-sandbox' : '@deepseek-ai/dsh-fs-local', scope: ROOT },
      { id: 'credentials', plugin: '@deepseek-ai/dsh-credentials-local', scope: ROOT },
      { id: 'pi-ai', plugin: '@deepseek-ai/dsh-llm-pi-ai', scope: ROOT,
        config: { providers: { 'deepseek-official': { apiKeyEnv: 'DEEPSEEK_API_KEY', api: 'openai-completions',
          baseURL: 'https://api.deepseek.com/v1', models: [{ id: 'deepseek-v4-flash' }] } } } },
    ],
  }
  const windows = platform === 'win32'
  return {
    formatVersion: 1,
    scopes: profile === 'native-tui' ? [{ id: ROOT }, { id: 'standard', parent: ROOT }, { id: 'minimal', parent: ROOT }] : [{ id: ROOT }],
    installations: [
      {
        id: 'app',
        plugin: profile === 'native-web'
          ? '@deepseek-ai/dsh-native-web-host'
          : profile === 'native-tui' ? '@deepseek-ai/dsh-native-tui' : '@deepseek-ai/dsh-native-headless',
        scope: ROOT,
        config: profile === 'native-web'
          ? { projectDir: join(home, 'profiles', profile), runtimeDir: cliRuntimeRoot(), clientReload: 'live', maxRequestBodyBytes: 300 * 1024 * 1024 }
          : { provider: 'deepseek', model: 'deepseek-v4-flash', systemPrompt: 'You are a helpful coding assistant.', maxSteps: 8, ...(profile === 'native-tui' ? { cwd: process.cwd(), locale: 'en', background: '#000000', maxQueuedInputs: 32, maxHistoryEvents: 100000, maxTranscriptEvents: 500, maxStreamChunks: 1000, maxPendingHumanRequests: 32 } : {}) },
      },
      ...(profile === 'native-web' ? [{ id: 'model-selection', plugin: '@deepseek-ai/dsh-native-model-selection', scope: ROOT }] : []),
      ...(profile === 'native-web' ? [{
        id: 'session-controller',
        plugin: '@deepseek-ai/dsh-native-web-session-controller',
        scope: ROOT,
        config: { cwd: process.cwd(), provider: 'deepseek', model: 'deepseek-v4-flash', systemPrompt: 'You are a helpful coding assistant.', maxSteps: 8, maxPendingRequests: 32, maxHistoryEvents: 100000, maxPromptChars: 100000, maxFollowBufferBytes: 4000000, maxFollowers: 32, maxPendingHumanRequests: 32 },
      }] : []),
      ...(profile === 'native-tui' ? [{ id: 'model-selection', plugin: '@deepseek-ai/dsh-native-model-selection', scope: ROOT }] : []),
      ...(profile === 'native-tui' ? [
        { id: 'user-questions', plugin: '@deepseek-ai/dsh-user-questions', scope: ROOT },
        { id: 'ask-user-tool', plugin: '@deepseek-ai/dsh-tool-ask-user', scope: ROOT },
        { id: 'commands', plugin: '@deepseek-ai/dsh-commands', scope: ROOT },
        { id: 'command-goal', plugin: '@deepseek-ai/dsh-command-goal', scope: ROOT },
        { id: 'command-compact', plugin: '@deepseek-ai/dsh-command-compact', scope: ROOT },
        { id: 'plan-mode', plugin: '@deepseek-ai/dsh-plan-mode', scope: ROOT, config: { section: PLAN_MODE_SECTION } },
        { id: 'agent-presets', plugin: '@deepseek-ai/dsh-agent-presets', scope: ROOT, config: { default: 'standard' } },
        { id: 'preset-standard', plugin: '@deepseek-ai/dsh-agent-preset-standing', scope: 'standard',
          config: { id: 'standard', name: 'Standard', description: 'Goal planning and task tracking tools.' } },
        { id: 'preset-minimal', plugin: '@deepseek-ai/dsh-agent-preset-standing', scope: 'minimal',
          config: { id: 'minimal', name: 'Minimal', description: 'Task tracking tools without Goal tools.' } },
      ] : []),
      { id: 'agents', plugin: '@deepseek-ai/dsh-native-agent', scope: ROOT },
      { id: 'session-execution', plugin: '@deepseek-ai/dsh-native-session-execution', scope: ROOT },
      ...(profile === 'native-web' || profile === 'native-tui' ? NATIVE_SESSION_TITLE_INSTALLATIONS : []),
      ...(profile === 'native-headless' ? [
        { id: 'goal', plugin: '@deepseek-ai/dsh-goal', scope: ROOT },
        { id: 'goal-round-driver', plugin: '@deepseek-ai/dsh-goal-round-driver', scope: ROOT },
        { id: 'tool-goal', plugin: '@deepseek-ai/dsh-tool-goal', scope: ROOT },
      ] : []),
      ...(profile === 'native-tui' ? [
        { id: 'goal', plugin: '@deepseek-ai/dsh-goal', scope: ROOT },
        { id: 'goal-round-driver', plugin: '@deepseek-ai/dsh-goal-round-driver', scope: ROOT },
        { id: 'tool-goal', plugin: '@deepseek-ai/dsh-tool-goal', scope: 'standard' },
      ] : []),
      ...(profile === 'native-web' ? [
        { id: 'goal', plugin: '@deepseek-ai/dsh-goal', scope: ROOT },
        { id: 'goal-round-driver', plugin: '@deepseek-ai/dsh-goal-round-driver', scope: ROOT },
        { id: 'tool-goal', plugin: '@deepseek-ai/dsh-tool-goal', scope: ROOT },
      ] : []),
      { id: 'jobs', plugin: '@deepseek-ai/dsh-native-jobs', scope: ROOT },
      { id: 'tools', plugin: '@deepseek-ai/dsh-native-tools', scope: ROOT },
      { id: 'prompt', plugin: '@deepseek-ai/dsh-native-prompt', scope: ROOT },
      { id: 'subagents', plugin: '@deepseek-ai/dsh-native-subagent', scope: ROOT, config: { providerName: 'spawn' } },
      ...nativeWorkflowInstallations('spawn'),
      { id: 'agent-instructions', plugin: '@deepseek-ai/dsh-agent-instructions', scope: ROOT,
        config: { maxBytes: 65_536 } },
      { id: 'time-context', plugin: '@deepseek-ai/dsh-native-time-context', scope: ROOT },
      { id: 'tool-jobs', plugin: '@deepseek-ai/dsh-native-tool-jobs', scope: ROOT },
      { id: 'tool-todo', plugin: '@deepseek-ai/dsh-tool-todo', scope: profile === 'native-tui' ? 'standard' : ROOT,
        config: { allowParallelInProgress: true } },
      ...(profile === 'native-tui' ? [{ id: 'tool-todo-minimal', plugin: '@deepseek-ai/dsh-tool-todo', scope: 'minimal',
        config: { allowParallelInProgress: true } }] : []),
      { id: 'model-execution', plugin: '@deepseek-ai/dsh-native-model-execution', scope: ROOT },
      { id: 'llm-retry', plugin: '@deepseek-ai/dsh-llm-retry', scope: ROOT },
      { id: 'timeout-policy', plugin: '@deepseek-ai/dsh-tool-call-timeout-policy', scope: ROOT },
      { id: 'repeat-tool-reminder', plugin: '@deepseek-ai/dsh-repeat-tool-reminder', scope: ROOT,
        config: { thresholds: [3, 5, 8], argumentsPreviewChars: 500 } },
      ...NATIVE_COMPACTION_INSTALLATIONS,
      ...(profile === 'native-web' || profile === 'native-tui' ? [{
        id: 'task-scheduler', plugin: '@deepseek-ai/dsh-task-scheduler', scope: ROOT,
        config: { path: join(home, 'profiles', profile, 'task-scheduler.sqlite') },
      }] : []),
      { id: 'storage', plugin: '@deepseek-ai/dsh-session-persistence-jsonl', scope: ROOT,
        config: { root: join(home, 'sessions'), compression: 'none' } },
      { id: 'attachments', plugin: '@deepseek-ai/dsh-attachment-local', scope: ROOT,
        config: { dshHome: home } },
      { id: 'sandbox-policy', plugin: '@deepseek-ai/dsh-native-sandbox-policy', scope: ROOT,
        config: { mode: 'workspace-write', workspaceRoot: process.cwd() } },
      { id: 'fs', plugin: '@deepseek-ai/dsh-fs-sandbox', scope: ROOT },
      { id: 'policy', plugin: '@deepseek-ai/dsh-fs-observation-policy', scope: ROOT },
      { id: 'file-tools', plugin: '@deepseek-ai/dsh-tool-fs', scope: ROOT },
      { id: 'subprocess', plugin: '@deepseek-ai/dsh-subprocess-local', scope: ROOT },
      { id: 'sandbox', plugin: '@deepseek-ai/dsh-sandbox-local', scope: ROOT },
      { id: 'code-runtime', plugin: '@deepseek-ai/dsh-code-runtime-process-sandbox', scope: ROOT },
      { id: 'shell-env', plugin: '@deepseek-ai/dsh-shell-env', scope: ROOT },
      { id: 'bash', plugin: windows ? '@deepseek-ai/dsh-pwsh-sandbox' : '@deepseek-ai/dsh-bash-sandbox', scope: ROOT },
      { id: 'spill-store', plugin: '@deepseek-ai/dsh-spill-local', scope: ROOT },
      { id: 'search-tools', plugin: '@deepseek-ai/dsh-tool-fs-search', scope: ROOT,
        config: { sampleOverCapGlobResults: false } },
      { id: 'web', plugin: '@deepseek-ai/dsh-web', scope: ROOT,
        config: { searchProvider: 'deepseek-official', fetchProvider: 'http' } },
      { id: 'web-search-deepseek', plugin: '@deepseek-ai/dsh-web-search-deepseek', scope: ROOT,
        config: { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
      { id: 'web-fetch-http', plugin: '@deepseek-ai/dsh-web-fetch-http', scope: ROOT },
      { id: 'tool-web', plugin: '@deepseek-ai/dsh-tool-web', scope: ROOT,
        config: { fetch: true, searchTimeoutMs: 60000 } },
      ...(profile === 'native-web' ? [{ id: 'user-questions', plugin: '@deepseek-ai/dsh-user-questions', scope: ROOT },
        { id: 'tool-ask-user', plugin: '@deepseek-ai/dsh-tool-ask-user', scope: ROOT }] : []),
      { id: 'approval', plugin: '@deepseek-ai/dsh-native-approval', scope: ROOT },
      { id: 'bash-tool', plugin: windows ? '@deepseek-ai/dsh-tool-pwsh' : '@deepseek-ai/dsh-tool-bash', scope: ROOT },
      { id: 'credentials', plugin: '@deepseek-ai/dsh-credentials-local', scope: ROOT },
      { id: 'settings', plugin: '@deepseek-ai/dsh-settings-file', scope: ROOT,
        config: { dshHome: home } },
      { id: 'pi-ai', plugin: '@deepseek-ai/dsh-llm-pi-ai', scope: ROOT,
        config: { providers: { deepseek: { apiKeyEnv: 'DEEPSEEK_API_KEY' } } } },
    ],
  }
}

/**
 * Create the shipped native profile once without replacing an existing user directory.
 * @param name - requested profile name.
 * @param home - Harness home containing the profile and Session store.
 */
export function ensureShippedNativeProfile(name: string, home: string = resolveDshHome()): void {
  if (!isShippedNativeProfile(name)) return
  const profiles = join(home, 'profiles')
  const directory = join(profiles, name)
  if (existsSync(directory)) {
    if (profileRuntime(name, home) !== 'native') {
      throw new Error(`dsh: existing ${name} profile is not a complete native profile`)
    }
    return
  }
  mkdirSync(profiles, { recursive: true })
  mkdirSync(directory)
  writeFileSync(join(directory, 'rsh.profile.json'), `${JSON.stringify(shippedNativeProfileComposition(home, name), null, 2)}\n`, { flag: 'wx' })
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify({
    name: `dsh-profile-${name}`, private: true,
    dsh: { profile: { runtime: 'native', config: 'rsh.profile.json', configReload: name === 'native-web' ? 'live' : 'startup' } },
  }, null, 2)}\n`, { flag: 'wx' })
  if (name === 'native-web') {
    writeFileSync(join(directory, 'rsh.client.json'), `${JSON.stringify({
      formatVersion: 1, installations: NATIVE_WEB_CLIENT_INSTALLATIONS,
    }, null, 2)}\n`, { flag: 'wx' })
  }
}
