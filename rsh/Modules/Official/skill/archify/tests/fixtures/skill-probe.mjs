import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const name = 'archify-skill-probe'
export const inject = ['skills']

export function apply(ctx) {
  const output = process.env.ARCHIFY_DSH_PROBE_OUT
  if (!output) throw new Error('ARCHIFY_DSH_PROBE_OUT is required')
  if (!ctx.appReady) throw new Error('Archify Skill probe requires launcher readiness')
  const exit = ctx.cmdlineArgs?.exit ?? ctx.appExit
  if (typeof exit !== 'function') throw new Error('Archify Skill probe cannot stop the host')
  ctx.appReady.onReady(() => {
    void (async () => {
      const cwd = process.cwd()
      const definition = await ctx.skills.get('archify', { cwd })
      const skills = await ctx.skills.list({ cwd })
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
      exit(0)
    })().catch(error => {
      process.stderr.write(`Archify Skill probe failed: ${error instanceof Error ? error.message : String(error)}\n`)
      exit(1)
    })
  })
}
