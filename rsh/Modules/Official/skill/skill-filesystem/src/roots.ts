import { join, win32, posix } from 'node:path'
import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill/shared'
import type { SkillSource } from '@deepseek-ai/dsh-skill/types'
import type { ResolvedConfig } from './config.ts'

const PROJECT_DSH_RANK = 100
const PROJECT_AGENTS_RANK = 200
const CUSTOM_RANK = 300
const USER_DSH_RANK = 400
const USER_AGENTS_RANK = 500

/** One configured source directory and its catalog precedence. */
export interface SkillRoot {
  readonly path: string
  readonly source: SkillSource
  readonly rank: number
  readonly skipSystem?: boolean
  readonly projectRoot?: string
  readonly trustedHost?: boolean
}

/** Build project, custom, user, and explicitly bundled roots in their discovery order.
 * @param config - resolved filesystem skill roots and bundle settings.
 * @param projectRoot - selected project's root, when workspace roots are enabled.
 * @returns ordered roots for the provider's discovery pass.
 */
export function buildSkillRoots(config: ResolvedConfig, projectRoot?: string): SkillRoot[] {
  const roots: SkillRoot[] = []
  if (config.includeDefaultRoots && projectRoot !== undefined) {
    roots.push(
      { path: joinInWorld(projectRoot, '.dsh/skills'), source: 'project-dsh', rank: PROJECT_DSH_RANK, projectRoot },
      { path: joinInWorld(projectRoot, '.agents/skills'), source: 'project-agents', rank: PROJECT_AGENTS_RANK, projectRoot },
    )
  }
  roots.push(...config.customSkillDirs.map(path => ({ path, source: 'custom' as const, rank: CUSTOM_RANK })))
  if (config.includeDefaultRoots) {
    roots.push(
      { path: join(config.dshHome, 'skills'), source: 'user-dsh', rank: USER_DSH_RANK, skipSystem: true },
      { path: join(config.agentsHome, 'skills'), source: 'user-agents', rank: USER_AGENTS_RANK },
    )
  }
  if (config.bundledSkillDir !== undefined) {
    roots.push({ path: config.bundledSkillDir, source: 'bundled', rank: BUNDLED_SKILL_RANK, trustedHost: true })
  }
  return roots
}

function joinInWorld(base: string, child: string): string {
  const paths = /^[A-Za-z]:[\\/]/.test(base) || base.includes('\\') ? win32 : posix
  return paths.join(base, child)
}
