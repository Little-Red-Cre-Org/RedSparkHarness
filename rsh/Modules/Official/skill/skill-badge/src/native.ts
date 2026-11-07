/**
 * Native Provider for the bundled `dsh-badge` skill.
 *
 * The skill body and its assets ship beside this file, so the row needs no Host
 * service beyond the skill registry itself; the only Native-specific part is
 * the registration scope the registry requires.
 *
 * @module @redspark/rsh-skill-badge/native
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { NativePlugin } from '@redspark/rsh-native-runtime'
// Type-only: resolves the `skills` service the row registers into.
import type {} from '@redspark/rsh-skill/native'
// Subpaths, not the package root: the root is the Cordis entry, and a Native
// source may not reach it. These two carry the vocabulary and the bundled rank.
import { BUNDLED_SKILL_RANK } from '@redspark/rsh-skill/shared'
import type { SkillCandidate, SkillDefinition, SkillProvider } from '@redspark/rsh-skill/types'

const PROVIDER_NAME = 'dsh-badge'
const SKILL_BODY_URL = new URL('../assets/dsh-badge.md', import.meta.url)
const RESOURCE_BASE = {
  kind: 'directory',
  path: fileURLToPath(new URL('../assets/', import.meta.url)),
} as const
const INVOCATION = { modelInvocable: true, userInvocable: true } as const
const DESCRIPTION = 'Add the official "powered by dsh" badge to documents, pull requests, merge requests, and other content produced with Red Spark Harness. Use whenever creating a pull request or merge request. Also use when the user asks for a dsh badge, powered-by-dsh attribution, or a reusable dsh badge asset or snippet.'
const CANDIDATE: SkillCandidate = {
  name: 'dsh-badge',
  description: DESCRIPTION,
  invocation: INVOCATION,
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  rank: BUNDLED_SKILL_RANK,
  locator: SKILL_BODY_URL,
}

const provider: SkillProvider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve([CANDIDATE]),
  async get(): Promise<SkillDefinition> {
    return {
      name: CANDIDATE.name,
      description: CANDIDATE.description,
      invocation: CANDIDATE.invocation,
      provider: CANDIDATE.provider,
      source: CANDIDATE.source,
      resourceBase: RESOURCE_BASE,
      content: await readFile(SKILL_BODY_URL, 'utf8'),
    }
  },
}

/** Native `dsh-badge` skill provider. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-skill-badge',
  targets: ['host'],
  requires: ['skills'],
  provides: [],
  resolve: () => (context) => {
    const skills = context.require('skills')
    const remove = skills.registerProvider(context.scope, () => provider)
    context.own(() => { void remove() })
  },
}
