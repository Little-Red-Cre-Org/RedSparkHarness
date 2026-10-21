/** Scenario selection request delivered through the Program's actual admitted owner. */
export const plugin = {
  apiVersion: 1, name: 'native-selection-fixture', targets: ['host'], requires: ['activeSessions', 'modelSelection'], provides: [],
  resolve(input) {
    if (input !== undefined) throw new Error('model-choice: fixture configuration is empty')
    return context => {
      const selection = context.require('modelSelection')
      context.effect(context.require('activeSessions').onAttached(async owner => {
        context.effect(owner.admission.register(async (request, next) => {
          const decision = await next()
          if (request.step === 2 && decision.kind === 'enter') {
            const state = await selection.state(owner, request.signal)
            await selection.select(owner, { selected: { provider: 'selection-fixture', model: 'second' }, expectedRevision: state.revision }, request.signal)
          }
          return decision
        }, 0))
      }))
    }
  },
}
