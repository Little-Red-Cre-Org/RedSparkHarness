/** Scenario-local Goal owner and interruption controls for both native SDK clients. */
import { randomUUID } from 'node:crypto'

export const plugin = {
  apiVersion: 1,
  name: 'sdk-goal-control-fixture',
  targets: ['host'],
  requires: ['activeSessions', 'goals', 'goalContinuation'],
  provides: [],
  resolve(config) {
    return context => {
      const sessions = context.require('activeSessions')
      const goals = context.require('goals')
      const continuation = context.require('goalContinuation')
      const tasks = new Set()
      const failures = []
      const agentTokens = new WeakMap()
      const tokenForAgent = agent => {
        let token = agentTokens.get(agent)
        if (token === undefined) {
          token = randomUUID()
          agentTokens.set(agent, token)
        }
        return token
      }
      const track = operation => {
        const task = operation.catch(async failure => {
          failures.push(failure)
          try {
            await report('/goal-failure', { name: failure instanceof Error ? failure.name : typeof failure,
              message: failure instanceof Error ? failure.message : String(failure),
              stack: failure instanceof Error ? failure.stack : undefined,
              cause: failure instanceof Error && failure.cause instanceof Error
                ? { name: failure.cause.name, message: failure.cause.message, stack: failure.cause.stack } : undefined })
          } catch (reportFailure) { failures.push(reportFailure) }
        })
        tasks.add(task)
        void task.then(() => tasks.delete(task))
      }
      const report = async (path, value) => {
        const response = await fetch(`${config.controlUrl}${path}`, { method: 'POST',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
        if (!response.ok) throw new Error(`sdk-goal-control-fixture: ${path} returned ${response.status}`)
      }
      const cleanup = new Map()
      context.own(sessions.onAttached(async owner => {
        if (owner.invocation !== 'root' || owner.session.id !== config.sessionId) return
        const ownerToken = randomUUID()
        const agentToken = tokenForAgent(owner.agent)
        let pausedGoalId
        let pauseRequested = false
        let initialized = false
        const removeEvent = owner.onEvent(event => {
          if (event.type === 'goal/change') track(report('/goal-change', { ownerToken, event }))
          if (event.type === 'user/message' && event.data.source.kind === 'goal' && event.data.source.round === 1) {
            const source = event.data.source
            const goal = goals.get(owner.agent)
            if (pauseRequested || goal?.objective !== config.objective || goal.id !== source.goalId
              || goal.revision !== source.revision || goal.roundsStarted !== source.round) return
            pauseRequested = true
            track((async () => {
              await report('/goal-pause-stage', { stage: 'requesting controlled pause claim', ownerToken, agentToken,
                goalId: source.goalId, revision: source.revision, round: source.round })
              const response = await fetch(`${config.controlUrl}/goal-pause-claim`, { signal: context.signal })
              if (!response.ok) throw new Error(`sdk-goal-control-fixture: pause claim returned ${response.status}`)
              const claim = await response.text()
              await report('/goal-pause-stage', { stage: 'received controlled pause claim', ownerToken, agentToken,
                goalId: source.goalId, revision: source.revision, claim })
              if (claim !== 'pause') throw new Error(`sdk-goal-control-fixture: unexpected pause claim ${claim}`)
              const current = goals.get(owner.agent)
              if (current === undefined || current.id !== source.goalId || current.revision !== source.revision) {
                throw new Error('sdk-goal-control-fixture: Goal changed before the controlled pause')
              }
              await report('/goal-pause-stage', { stage: 'verified current Goal reference before pause', ownerToken,
                agentToken, goalId: current.id, revision: current.revision, phase: current.phase,
                roundsStarted: current.roundsStarted })
              pausedGoalId = current.id
              await report('/goal-pause-stage', { stage: 'calling continuation.pause', ownerToken, agentToken,
                goalId: current.id, revision: current.revision })
              const paused = await continuation.pause(owner, { id: current.id, revision: current.revision })
              await report('/goal-pause-stage', { stage: 'continuation.pause resolved', ownerToken, agentToken,
                goal: paused })
            })())
          } else if (event.type === 'user/message' && event.data.source.kind === 'user'
            && event.data.content.some(block => block.type === 'text'
              && [config.humanText, config.wakeText].includes(block.text))) {
            const text = event.data.content.find(block => block.type === 'text')?.text
            track(report('/goal-human-consumed', { ownerToken, agentToken, id: event.data.id, text }))
          } else if (event.type === 'turn/end' && pausedGoalId !== undefined
            && event.data.reason.kind === 'aborted' && event.data.reason.reason.kind === 'hook'
            && event.data.reason.reason.reason === 'goal-pause') {
            track(report('/goal-pause-settled', { ownerToken, agentToken, id: pausedGoalId, turn: event.data.turn }))
          }
        })
        const removeAdmission = owner.beforeStep(async (admission, next) => {
          if (admission.owner !== owner) return next()
          let goal = goals.get(owner.agent)
          if (!initialized) {
            if (goal === undefined) goal = await continuation.create(owner,
              { objective: config.objective, maxGoalRounds: 2 })
            initialized = true
            await report('/goal-owner-attached', { ownerToken, agentToken, sessionId: owner.session.id, goal })
          }
          if (!admission.candidates.some(message => message.source.kind === 'user'
            && message.content.some(block => block.type === 'text' && block.text === config.resumeText))) return next()
          if (goal?.phase !== 'paused') throw new Error('sdk-goal-control-fixture: explicit resume requires a paused Goal')
          const resumed = await continuation.resume(owner, { id: goal.id, revision: goal.revision }, 1, 'human')
          await report('/goal-human-rearmed', { ownerToken, agentToken, goal: resumed })
          return next()
        }, 650)
        cleanup.set(owner, async () => { removeEvent(); await removeAdmission() })
      }))
      context.own(sessions.onDetached(async owner => { await cleanup.get(owner)?.(); cleanup.delete(owner) }))
      context.own(async () => {
        await Promise.allSettled([...cleanup.values()].map(release => release()))
        await Promise.all([...tasks])
        if (failures.length > 0) throw new AggregateError(failures, 'sdk-goal-control-fixture: cleanup failed')
      })
    }
  },
}
