import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { z } from 'zod'

const reportSchema = z.object({ description: z.string(), runs: z.array(z.object({ state: z.string(), detail: z.string() })),
  goal: z.object({ blocked: z.string(), completed: z.string(), sameSession: z.boolean() }),
  gui: z.object({ listedOwner: z.boolean(), guiOtherDenied: z.boolean(),
    guiPaused: z.string(), guiResumed: z.string(), guiDeleted: z.boolean() }),
  management: z.object({ paused: z.string(), resumed: z.string(), deleted: z.string(),
    otherSessionDenied: z.boolean(), scheduledHasManagementTool: z.boolean() }),
})

it('boots the real plugin and records a real Agent turn using only a mocked model', async () => {
  let report: z.infer<typeof reportSchema> | undefined
  const driver = fileURLToPath(new URL('./fixtures/loader/driver.ts', import.meta.url))
  await runLoaderSmoke({ label: 'task scheduler smoke', tempDirPrefix: 'scheduler-loader-',
    binScript: driver, libBinScript: driver,
    configPath: fileURLToPath(new URL('./fixtures/loader/cordis.yml', import.meta.url)),
    tsconfigPath: fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url)),
    processTimeoutMs: 60000,
    inspect: async (cwd) => { report = reportSchema.parse(JSON.parse(await readFile(join(cwd, 'scheduler-report.json'), 'utf8'))) },
  })
  expect(report?.description).toMatchSnapshot('scheduled task management instructions')
  expect(report?.runs).toHaveLength(1)
  expect(report?.goal).toEqual({ blocked: 'blocked', completed: 'completed', sameSession: true })
  expect(report?.runs[0]).toMatchObject({ state: 'completed' })
  expect(report?.runs[0]?.detail).toContain('not a certification')
  expect(report?.management).toEqual({ paused: 'paused', resumed: 'active', deleted: 'deleted', otherSessionDenied: true, scheduledHasManagementTool: false })
  expect(report?.gui).toEqual({ listedOwner: true, guiOtherDenied: true, guiPaused: 'paused', guiResumed: 'active', guiDeleted: true })
}, 75000)
