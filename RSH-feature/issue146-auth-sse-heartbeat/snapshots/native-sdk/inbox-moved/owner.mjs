import { readFileSync, writeFileSync } from 'node:fs'

const messages = {
  queuedBefore: { id: 'queued-before', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'leave queued before' }] },
  target: { id: 'promoted-target', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'original target text' }] },
  queuedAfter: { id: 'queued-after', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'leave queued after' }] },
  stepBefore: { id: 'step-before', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'keep next-step before' }] },
}

const text = message => message.content.filter(block => block.type === 'text').map(block => block.text).join('')
const summary = message => ({ id: message.id, source: message.source, text: text(message) })
const publicTasks = new Set([
  'Start the Native SDK Inbox move fixture.',
  'Restore the Native SDK Inbox Session after a process restart.',
])

export const plugin = {
  apiVersion: 1,
  name: 'native-sdk-inbox-owner-fixture',
  targets: ['host'],
  requires: ['activeSessions'],
  provides: [],
  resolve(input) {
    return context => {
      const sessions = context.require('activeSessions')
      const cleanup = new Map()
      context.effect(sessions.onAttached(async owner => {
        if (owner.invocation !== 'root' || owner.session.id !== input.sessionId) return
        let initialized = false
        const removeAdmission = owner.beforeStep(async (admission, next) => {
          const decision = await next()
          if (admission.owner !== owner || initialized || decision.kind !== 'enter') return decision
          const publicPrompt = admission.candidates.find(message => message.source.kind === 'user'
            && publicTasks.has(text(message))
            && decision.messages.some(selected => selected.id === message.id))
          if (publicPrompt === undefined) return decision
          const history = await owner.readEvents({ signal: admission.signal })
          const moveCount = history.filter(event => event.type === 'agent/inbox/moved'
            && event.data.messageId === messages.target.id).length
          if (text(publicPrompt) === 'Restore the Native SDK Inbox Session after a process restart.') {
            if (moveCount !== 1) throw new Error('native-sdk Inbox cold owner expected one durable move')
            const state = JSON.parse(readFileSync(input.statePath, 'utf8'))
            state.recovery = { moveCount,
              nextTurn: owner.messages('next-turn').map(summary), nextStep: owner.messages('next-step').map(summary) }
            writeFileSync(input.statePath, JSON.stringify(state))
            initialized = true
            return decision
          }
          if (moveCount !== 0 || text(publicPrompt) !== 'Start the Native SDK Inbox move fixture.') return decision
          if (!history.some(event => event.type === 'agent/inbox/spliced'
            && event.data.inserted.some(message => message.id === publicPrompt.id))) return decision

          initialized = true
          await owner.enqueue(messages.queuedBefore, 'next-turn', false, admission.signal)
          await owner.enqueue(messages.target, 'next-turn', false, admission.signal)
          await owner.enqueue(messages.queuedAfter, 'next-turn', false, admission.signal)
          await owner.enqueue(messages.stepBefore, 'next-step', false, admission.signal)
          const edited = await owner.editPendingText(messages.target.id,
            [{ type: 'text', text: 'edited target text' }], admission.signal)
          const promoted = await owner.promotePending(messages.target.id, admission.signal)
          const fixtureIds = new Set(Object.values(messages).map(message => message.id))
          writeFileSync(input.statePath, JSON.stringify({ first: { edited, promoted,
            nextTurn: owner.messages('next-turn').filter(message => fixtureIds.has(message.id)).map(summary),
            nextStep: owner.messages('next-step').filter(message => fixtureIds.has(message.id)).map(summary) } }))
          return decision
        }, 650)
        cleanup.set(owner, removeAdmission)
      }))
      context.effect(sessions.onDetached(async owner => {
        await cleanup.get(owner)?.()
        cleanup.delete(owner)
      }))
    }
  },
}
