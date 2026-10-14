/** Keyless fixture for a parent credential Provider and child Native consumers. */
const AUTHORIZATION_KEY = 'credential-notification-fixture/authorized'
const ACCOUNT_KEY = 'deepseek-account/default'
const ACCOUNT_TOKEN = 'credential-notification-fixture-token'
export const plugin = {
  apiVersion: 1,
  name: 'native-credential-notification-fixture',
  targets: ['host'],
  requires: ['activeSessions', 'modelSelection', 'credentials', 'authorization', 'deepseekAccount', 'modelSettings', 'modelDirectory'],
  provides: [],
  resolve(input) {
    if (typeof input !== 'object' || input === null || typeof input.accountDestination !== 'string'
      || Object.keys(input).some(key => key !== 'accountDestination')) {
      throw new Error('credential-notification: fixture requires only accountDestination')
    }
    const accountDestination = input.accountDestination
    return context => {
      const activeSessions = context.require('activeSessions')
      const selection = context.require('modelSelection')
      const credentials = context.require('credentials')
      const authorization = context.require('authorization')
      const account = context.require('deepseekAccount')
      const modelSettings = context.require('modelSettings')
      const modelDirectory = context.require('modelDirectory')
      let update = Promise.withResolvers()
      context.on('llm/adapters-updated', () => { update.resolve() })
      const removeFlow = authorization.registerFlow({
        key: AUTHORIZATION_KEY,
        label: 'Credential notification fixture',
        methods: [{ id: 'fixture', label: 'Fixture authorization' }],
        async run({ signal }) {
          await credentials.modifyRecord(AUTHORIZATION_KEY,
            () => Promise.resolve({ kind: 'grant', payload: { authorized: true } }), { signal })
        },
      })
      context.effect(removeFlow)
      context.effect(activeSessions.onAttached(async owner => {
        context.effect(owner.admission.register(async (request, next) => {
          const decision = await next()
          if (request.step === 1 && decision.kind === 'enter') {
            if (await credentials.readRecord(AUTHORIZATION_KEY) !== undefined) {
              throw new Error('credential-notification: authorization fixture must start without a record')
            }
            if (await credentials.readRecord(ACCOUNT_KEY) !== undefined) {
              throw new Error('credential-notification: account fixture must start without a record')
            }
            if (await account.resolveToken(accountDestination) !== undefined) {
              throw new Error('credential-notification: account fixture must start without a token')
            }
            const outcome = await authorization.begin({ key: AUTHORIZATION_KEY, signal: request.signal }).outcome
            if (outcome.status !== 'authorized') throw new Error('credential-notification: authorization did not settle authorized')
            if (!(await credentials.describeRecord(AUTHORIZATION_KEY)).configured) {
              throw new Error('credential-notification: authorization record was not committed')
            }
            console.log('credential-notification: authorization=authorized')

            update = Promise.withResolvers()
            await credentials.modifyRecord(ACCOUNT_KEY, () => Promise.resolve({ kind: 'grant', payload: {
              version: 1, token: ACCOUNT_TOKEN, issuer: 'https://platform.deepseek.com',
            } }), { signal: request.signal })
            let timer
            try {
              await Promise.race([update.promise, new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('credential-notification: child model consumer did not refresh')), 5000)
              })])
            } finally {
              clearTimeout(timer)
            }
            const token = await account.resolveToken(accountDestination, request.signal)
            if (token !== ACCOUNT_TOKEN) throw new Error('credential-notification: account token did not resolve after update')
            if (!modelSettings.configurableProviders().some(row => row.provider === 'deepseek-account')) {
              throw new Error('credential-notification: configured account route is missing')
            }
            await modelDirectory.resolve('deepseek-account', 'deepseek-flash', request.signal)
            console.log('credential-notification: account-route=ready')
          }
          if (request.step === 2 && decision.kind === 'enter') {
            const state = await selection.state(owner, request.signal)
            await selection.select(owner, { selected: { provider: 'deepseek-account', model: 'deepseek-flash' },
              expectedRevision: state.revision }, request.signal)
          }
          return decision
        }, 0))
      }))
    }
  },
}
