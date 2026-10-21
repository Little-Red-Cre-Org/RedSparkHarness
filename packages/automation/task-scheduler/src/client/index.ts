/** Plugin-owned GUI mounted through the existing Settings and Remote extension points. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import contribution from '@deepseek-ai/dsh-task-scheduler/remote'
import { createSchedulerController } from './controller.ts'
import { SchedulerPanel } from './Panel.tsx'
import { NoticePanel } from './NoticePanel.tsx'
import { createNoticeController } from './notices.ts'
import { nativeNoticeContent, noticeStatus } from './native-notice.ts'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { en, zh, type SchedulerKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    taskScheduler: SchedulerKey
  }
}

/** Services required to add the Settings page and mount its generated Remote methods. */
export const inject = ['slots', 'locale', 'remote']

function value<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/**
 * Mount generated transport methods and a localized task-management page.
 * @param ctx - Client context owning registrations and pending view state.
 * @returns Cleanup for the Remote contribution and the controller.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(contribution)
  ctx.inject(['remote', 'remote.taskScheduler', 'slots', 'locale', 'sessions', 'uiWorkspace'], (uiCtx) => {
    const controller = createSchedulerController({
      owners: async () => value(await uiCtx.remote.taskScheduler.owners()),
      list: async () => {
        const snapshot = value(await uiCtx.remote.taskScheduler.overview())
        const sessions = uiCtx.sessions.list.getSnapshot()
        if (snapshot.runs.some(run => run.sessionId && !sessions.byId[run.sessionId as SessionId])) {
          await uiCtx.sessions.refresh()
        }
        return snapshot
      },
      create: async (owner, input) => value(await uiCtx.remote.taskScheduler.create(owner, input)),
      change: async (id, action) => value(await uiCtx.remote.taskScheduler.updateTask(id, action)),
      deleteRun: async id => value(await uiCtx.remote.taskScheduler.removeRun(id)),
    })
    uiCtx.effect(() => () => { controller.dispose() })
    uiCtx.effect(() => uiCtx.locale.register('taskScheduler', { zh, en }))
    const t = uiCtx.locale.bind('taskScheduler')
    uiCtx.inject(['workspaces'], (workspaceCtx) => {
      const workspaces = workspaceCtx.get('workspaces') as IWorkspaces
      workspaceCtx.effect(() => workspaces.list.subscribe(() => { void controller.refresh() }))
    })
    let preparing: Promise<void> | undefined
    const prepareSession = (): Promise<void> => {
      if (preparing) return preparing
      preparing = (async () => {
        const owners = value(await uiCtx.remote.taskScheduler.owners())
        if (owners.length) { await controller.refresh(); return }
        const workspaces = uiCtx.get('workspaces') as IWorkspaces
        if (workspaces.list.getSnapshot().phase !== 'ready') throw new Error(t('busy'))
        let workspace = workspaces.list.getSnapshot().items[0]
        if (!workspace) {
          const path = await uiCtx.uiWorkspace.pickDirectory()
          if (!path) throw new Error(t('noOwners'))
          workspace = await workspaces.create({ path })
        }
        let sessionId = await uiCtx.uiWorkspace.connectWorkspace(workspace.workspaceId)
        if (sessionId.startsWith('scheduled-')) sessionId = await uiCtx.sessions.create({ workspaceId: workspace.workspaceId })
        // A blank session in the persisted catalog may not have a live Host Agent after restart.
        if (!value(await uiCtx.remote.taskScheduler.owners()).some(owner => owner.id === sessionId)) {
          await uiCtx.sessions.create({ workspaceId: workspace.workspaceId, sessionId })
        }
        await controller.refresh()
        await controller.select(sessionId)
        if (!controller.store.getSnapshot().owners.some(owner => owner.id === sessionId)) throw new Error(t('noOwners'))
      })().finally(() => { preparing = undefined })
      return preparing
    }
    uiCtx.inject(['uiWorkspace', 'slots'], (noticeCtx) => {
      const notifications = new Set<Notification>()
      const notices = createNoticeController({
        dismiss: (id) => {
          const desktop = (globalThis as unknown as { dshDesktop?: { notifyTask?: (value: unknown) => Promise<void> } }).dshDesktop
          void desktop?.notifyTask?.({ dismissId: id }).catch(() => {})
          for (const notification of notifications) if (notification.tag === `task-scheduler:${id}`) notification.close()
        },
        list: async () => {
          const items = value(await uiCtx.remote.taskScheduler.notifications())
          const sessions = uiCtx.sessions.list.getSnapshot()
          if (items.some(item => item.sessionId && !sessions.byId[item.sessionId as SessionId])) {
            await uiCtx.sessions.refresh()
          }
          return items
        },
        acknowledge: async id => value(await uiCtx.remote.taskScheduler.acknowledge(id)),
        remove: async id => value(await uiCtx.remote.taskScheduler.deleteNotification(id)),
        notify: (item, open) => {
          if (item.phase === 'due') return
          const content = nativeNoticeContent(item, t)
          const desktop = (globalThis as unknown as { dshDesktop?: {
            notifyTask?: (value: { id: string; title: string; body: string; status: string; time: number }) => Promise<void>
          } }).dshDesktop
          if (desktop?.notifyTask) {
            void desktop.notifyTask({ id: item.id, title: item.title, body: item.directReminder ? item.body : t('nativeOpenResult'),
              status: t(noticeStatus(item)), time: item.time })
              .catch(() => { open() })
            return
          }
          if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
          const notification = new Notification(content.title, {
            body: content.body, tag: `task-scheduler:${item.id}`, silent: false,
          })
          notifications.add(notification)
          notification.onclose = () => { notifications.delete(notification) }
          notification.onclick = () => { window.focus(); open(); notification.close() }
        },
      })
      noticeCtx.effect(() => {
        notices.start()
        return () => { notices.dispose(); for (const notification of notifications) notification.close(); notifications.clear() }
      })
      noticeCtx.inject(['workspaces'], (workspaceCtx) => {
        const workspaces = workspaceCtx.get('workspaces') as IWorkspaces
        workspaceCtx.effect(() => workspaces.list.subscribe(() => { void notices.refresh() }))
      })
      noticeCtx.slots.inject('sidebar.header.action', () => noticeCtx.slots.register({
        name: 'sidebar.header.action', id: 'task-reminders', order: 20, label: () => t('scheduledTask'), locale: 'taskScheduler',
        inject: () => ({ open: notices.open, close: notices.close, refresh: notices.refresh,
          acknowledge: notices.acknowledge, remove: notices.remove,
          prepareSession, refreshTasks: controller.refresh, select: controller.select, create: controller.create,
          change: controller.change, deleteRun: controller.deleteRun,
          viewSession: (id: string) => { noticeCtx.uiWorkspace.openSession(id as SessionId) },
          hooks: { notices: notices.store, snapshot: controller.store } }),
      }, NoticePanel))
    })
    uiCtx.inject(['uiWorkspace'], panelCtx => panelCtx.slots.inject('settings.section', () => panelCtx.slots.register({
      name: 'settings.section', id: 'task-scheduler', order: 5, label: () => t('title'), locale: 'taskScheduler',
      inject: () => ({ prepareSession, refresh: controller.refresh, select: controller.select,
        create: controller.create, change: controller.change,
        deleteRun: controller.deleteRun, viewSession: (id: string) => { panelCtx.uiWorkspace.openSession(id as SessionId) },
        hooks: { snapshot: controller.store } }),
    }, SchedulerPanel)))
  })
  return unmount
}
