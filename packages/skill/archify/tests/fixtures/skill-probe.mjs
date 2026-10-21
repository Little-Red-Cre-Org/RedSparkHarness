import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const name = 'archify-skill-probe'
export const inject = ['skills']

export async function apply(ctx) {
  const output = process.env.ARCHIFY_DSH_PROBE_OUT
  if (!output) throw new Error('ARCHIFY_DSH_PROBE_OUT is required')
  const cwd = process.cwd()
  const skills = await ctx.skills.list({ cwd })
  const definition = await ctx.skills.get('archify', { cwd })
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, `${JSON.stringify({
    skills: skills.map(skill => ({ name: skill.name, provider: skill.provider, invocation: skill.invocation })),
    definition: definition && {
      name: definition.name,
      provider: definition.provider,
      invocation: definition.invocation,
      contentLength: definition.content.length,
    },
  }, undefined, 2)}\n`)
  const exit = ctx.cmdlineArgs?.exit ?? ctx.appExit
  if (typeof exit !== 'function') throw new Error('Archify Skill probe cannot stop the host')
  exit(0)
}
