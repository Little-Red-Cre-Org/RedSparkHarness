import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createSchedulerController, type SchedulerApi } from '../src/client/controller.ts'
import type { SchedulerSnapshot } from '../src/gui-types.ts'

const owner = { id: SessionId('one'), title: 'Project', workspace: 'E:/project', model: 'mock', permission: 'read-only' }
const empty: SchedulerSnapshot = { tasks: [], runs: [], minEverySeconds: 300 }
function harness() {
  const api: SchedulerApi = { deleteRun: vi.fn().mockResolvedValue(empty),
    owners: vi.fn().mockResolvedValue([owner]), list: vi.fn().mockResolvedValue(empty),
    create: vi.fn().mockResolvedValue(empty), change: vi.fn().mockResolvedValue(empty) }
  return { api, controller: createSchedulerController(api) }
}
describe('task GUI state', () => {
  it('rechecks live owners before creating and clears a recovered missing-owner error', async () => {
    const { api, controller } = harness()
    const input = { title: 'Check', prompt: 'Run tests', at: '2026-10-01T00:00:00Z' }
    vi.mocked(api.owners).mockResolvedValue([])
    expect(await controller.create(input)).toBe(false)
    expect(api.create).not.toHaveBeenCalled()
    vi.mocked(api.owners).mockResolvedValue([owner])
    await controller.refresh()
    expect(controller.store.getSnapshot().error).toBeNull()
    vi.mocked(api.owners).mockResolvedValue([{ ...owner, id: SessionId('replacement') }])
    expect(await controller.create(input)).toBe(true)
    expect(api.create).toHaveBeenCalledWith(SessionId('replacement'), input)
    controller.dispose()
  })
  it('keeps input enabled during a slow refresh and ignores stale data after a mutation', async () => {
    const { api, controller } = harness()
    await controller.refresh()
    let finish!: (value: SchedulerSnapshot) => void
    vi.mocked(api.list).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const polling = controller.refresh()
    expect(controller.store.getSnapshot().busy).toBe(false)
    const latest = { ...empty, minEverySeconds: 600 }
    vi.mocked(api.change).mockResolvedValue(latest)
    expect(await controller.change('task', 'pause')).toBe(true)
    finish(empty)
    await polling
    expect(controller.store.getSnapshot()).toMatchObject({ busy: false, data: latest, notice: 'changed' })
  })
  it('loads the selected owner and submits creation without a model tool call', async () => {
    const { api, controller } = harness()
    await controller.refresh()
    expect(controller.store.getSnapshot().owner).toBe(owner.id)
    const input = { title: 'Check', prompt: 'Run tests', at: '2026-10-01T00:00:00Z' }
    expect(await controller.create(input)).toBe(true)
    expect(api.create).toHaveBeenCalledWith(owner.id, input)
    expect(controller.store.getSnapshot()).toMatchObject({ notice: 'created', busy: false, error: null })
  })
  it('does not claim creation succeeded when the server rejects it', async () => {
    const { api, controller } = harness()
    await controller.refresh()
    vi.mocked(api.create).mockRejectedValue(new Error('at must be future'))
    expect(await controller.create({ title: 'bad', prompt: 'check', at: 'past' })).toBe(false)
    expect(controller.store.getSnapshot()).toMatchObject({ notice: null, busy: false, error: 'at must be future' })
  })
  it('serializes gestures and ignores responses after plugin disposal', async () => {
    const { api, controller } = harness()
    await controller.refresh()
    let finish!: (value: SchedulerSnapshot) => void
    vi.mocked(api.change).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const pending = controller.change('task', 'pause')
    expect(await controller.change('task', 'delete')).toBe(false)
    expect(api.change).toHaveBeenCalledTimes(1)
    controller.dispose()
    finish(empty)
    expect(await pending).toBe(false)
    expect(controller.store.getSnapshot().notice).toBeNull()
  })
  it('loads global tasks and permits management without an open conversation', async () => {
    const { api, controller } = harness()
    vi.mocked(api.owners).mockResolvedValue([])
    await controller.refresh()
    expect(api.list).toHaveBeenCalledWith()
    expect(controller.store.getSnapshot()).toMatchObject({ owner: null, data: empty, busy: false })
    expect(await controller.change('closed-owner-task', 'pause')).toBe(true)
    expect(api.change).toHaveBeenCalledWith('closed-owner-task', 'pause')
    expect(await controller.deleteRun('receipt')).toBe(true)
    expect(api.deleteRun).toHaveBeenCalledWith('receipt')
  })
})
