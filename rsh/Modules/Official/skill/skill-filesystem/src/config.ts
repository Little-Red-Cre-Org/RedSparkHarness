import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  DEFAULT_WATCH_MAX_PROJECTS,
  DEFAULT_WATCH_POLL_INTERVAL_MS,
  DEFAULT_WATCH_STABILITY_THRESHOLD_MS,
  type SkillWatchConfigInput,
} from './watch.ts'

/** Local filesystem skill provider configuration. */
export interface Config extends SkillWatchConfigInput {
  /** Unique provider name. Defaults to `filesystem`. */
  providerName?: string
  /** Whether project and user roots are included around custom roots. */
  includeDefaultRoots?: boolean
  /** RedSpark Harness config root. Defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome?: string
  /** Shared agent config root. Defaults to `$DSH_AGENTS_HOME` or `~/.agents`. */
  agentsHome?: string
  /** Additional skill roots scanned after project roots and before user roots. */
  customSkillDirs?: string[]
  /** Bundled skill root; defaults to `$DSH_BUNDLED_SKILL_DIR` when default roots are included, otherwise mounts none. */
  bundledSkillDir?: string
}

/** Schemastery configuration schema shared by Cordis and Native entries. */
export const Config: Schema<Config> = z.object({
  providerName: z.string().min(1).default('filesystem'),
  includeDefaultRoots: z.boolean().default(true),
  dshHome: z.string(),
  agentsHome: z.string(),
  customSkillDirs: z.array(z.string()).default([]),
  watch: z.boolean().default(true),
  watchUsePolling: z.boolean().default(false),
  watchStabilityThresholdMs: z.number().default(DEFAULT_WATCH_STABILITY_THRESHOLD_MS),
  watchPollIntervalMs: z.number().default(DEFAULT_WATCH_POLL_INTERVAL_MS),
  watchMaxProjects: z.number().default(DEFAULT_WATCH_MAX_PROJECTS),
  watchFollowSymlinks: z.boolean().default(true),
  bundledSkillDir: z.string(),
})

/** Explicit roots and watcher values captured before provider activation. */
export interface ResolvedConfig {
  readonly providerName: string
  readonly includeDefaultRoots: boolean
  readonly dshHome: string
  readonly agentsHome: string
  readonly customSkillDirs: readonly string[]
  readonly watch: boolean
  readonly watchUsePolling: boolean
  readonly watchStabilityThresholdMs: number
  readonly watchPollIntervalMs: number
  readonly watchMaxProjects: number
  readonly watchFollowSymlinks: boolean
  readonly bundledSkillDir?: string
}

const CONFIG_FIELDS = new Set([
  'providerName', 'includeDefaultRoots', 'dshHome', 'agentsHome', 'customSkillDirs', 'watch',
  'watchUsePolling', 'watchStabilityThresholdMs', 'watchPollIntervalMs', 'watchMaxProjects',
  'watchFollowSymlinks', 'bundledSkillDir',
])

/** Validate Native configuration and resolve filesystem roots before registration.
 * @param input - raw package configuration.
 * @returns immutable-shape values with resolved absolute host paths.
 */
export function resolveSkillFilesystemConfig(input: unknown): ResolvedConfig {
  if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
    throw new Error('skill-filesystem: configuration must be an object')
  }
  const fields = input as Record<string, unknown> | undefined
  for (const key of Object.keys(fields ?? {})) {
    if (!CONFIG_FIELDS.has(key)) throw new Error(`skill-filesystem: unknown configuration field ${key}`)
  }
  const config = Config(fields ?? {})
  const includeDefaultRoots = config.includeDefaultRoots ?? true
  const bundledSkillDir = config.bundledSkillDir ?? (includeDefaultRoots ? process.env.DSH_BUNDLED_SKILL_DIR : undefined)
  return {
    providerName: config.providerName ?? 'filesystem',
    includeDefaultRoots,
    dshHome: resolveDshHome(config.dshHome),
    agentsHome: resolve(config.agentsHome ?? process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents')),
    customSkillDirs: (config.customSkillDirs ?? []).map(path => resolve(path)),
    watch: config.watch ?? true,
    watchUsePolling: config.watchUsePolling ?? false,
    watchStabilityThresholdMs: config.watchStabilityThresholdMs ?? DEFAULT_WATCH_STABILITY_THRESHOLD_MS,
    watchPollIntervalMs: config.watchPollIntervalMs ?? DEFAULT_WATCH_POLL_INTERVAL_MS,
    watchMaxProjects: config.watchMaxProjects ?? DEFAULT_WATCH_MAX_PROJECTS,
    watchFollowSymlinks: config.watchFollowSymlinks ?? true,
    ...bundledSkillDir === undefined ? {} : { bundledSkillDir: resolve(bundledSkillDir) },
  }
}
