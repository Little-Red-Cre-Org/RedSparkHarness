/** Test-only native Plugin that creates one scheduled Session through the real root executor. */
export const plugin = {
  apiVersion: 1,
  name: 'sdk-scheduled-origin-fixture',
  targets: ['host'],
  requires: ['rootExecution', 'activeSessions', 'taskScheduler', 'tools'],
  provides: [],
  resolve(config) {
    return context => {
      const rootExecution = context.require('rootExecution')
      const sessions = context.require('activeSessions')
      const tools = context.require('tools')
      const report = async (path, value) => {
        const response = await fetch(`${config.controlUrl}${path}`, { method: 'POST',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
        if (!response.ok) throw new Error(`sdk-scheduled-origin-fixture: ${path} returned ${response.status}`)
      }
      context.own(sessions.onAttached(async owner => {
        if (owner.invocation !== 'root' || owner.session.id !== config.sessionId) return
        const toolsVisible = tools.schemas(owner.agent.scope).some(tool => tool.name === 'task_schedule')
        await report('/origin-owner', { sessionId: owner.session.id, invocation: owner.invocation,
          rootOrigin: owner.rootOrigin ?? null, taskScheduleToolVisible: toolsVisible })
      }))
      const loaded = report('/origin-plugin-loaded', {})
      context.own(() => loaded)
      const task = (async () => {
        const response = await fetch(`${config.controlUrl}/await-origin-start`, { signal: context.signal })
        const instruction = await response.text()
        if (instruction !== 'start') return
        await report('/origin-root-ready-waiting', {})
        try {
          await rootExecution.ready(context.signal)
        } catch (failure) {
          let lateFailure
          try { await rootExecution.ready(new AbortController().signal) }
          catch (error) { lateFailure = error }
          if (lateFailure === undefined) throw new Error('SDK root readiness remained available after the Host stopped')
          await report('/origin-root-ready-rejected', {
            first: { message: failure instanceof Error ? failure.message : String(failure) },
            late: { message: lateFailure instanceof Error ? lateFailure.message : String(lateFailure) },
          })
          if (!context.signal.aborted && !(failure instanceof Error && failure.message.includes('closing'))) throw failure
          return
        }
        await rootExecution.maintenance({ route: 'root', id: config.sessionId, resume: false, rootOrigin: 'scheduled' },
          async owner => {
            if (owner.rootOrigin !== 'scheduled') throw new Error('scheduled root origin was not attached before maintenance')
          }, context.signal)
        await report('/origin-ready', { sessionId: config.sessionId })
      })()
      void task.catch(async failure => {
        try {
          await report('/origin-failure', { name: failure instanceof Error ? failure.name : typeof failure,
            message: failure instanceof Error ? failure.message : String(failure),
            stack: failure instanceof Error ? failure.stack : undefined })
        } catch { /* The carrier reports the original failure through the missing readiness receipt. */ }
      })
      context.own(() => task)
    }
  },
}
