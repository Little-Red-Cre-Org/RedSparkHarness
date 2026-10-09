/** Cordis-free construction of pi-ai authorization flows. */

import { createModels } from '@earendil-works/pi-ai'
import type { AuthEvent, AuthPrompt, AuthType, Provider } from '@earendil-works/pi-ai'
import type {
  AuthorizationFlow, AuthorizationMethod, AuthorizationPrompt, AuthorizationSession,
} from '@deepseek-ai/dsh-authorization/native'
import { isCredentialKeySegment } from '@deepseek-ai/dsh-credentials/native'
import { catalogProvider, catalogProviderIds } from './catalog.ts'
import { recordKeyFor } from './auth-core.ts'
import type { PiAiAuthInjection } from './adapter.ts'
import { createSiwcOAuth } from './siwc.ts'

/**
 * The login methods one catalog provider offers.
 * @param provider - the installed catalog provider, if pi-ai ships one.
 * @returns its methods, most preferred first; empty when it offers no login.
 */
function loginMethods(provider: Provider | undefined): AuthorizationMethod[] {
  const methods: AuthorizationMethod[] = []
  const oauth = provider?.auth.oauth
  if (oauth !== undefined) methods.push({ id: 'oauth', label: oauth.loginLabel ?? oauth.name })
  const apiKey = provider?.auth.apiKey
  if (apiKey?.login !== undefined) methods.push({ id: 'api-key', label: apiKey.name })
  return methods
}

/** Translate one pi-ai login event into the authorization vocabulary. */
function relay(event: AuthEvent, session: AuthorizationSession): void {
  switch (event.type) {
    case 'info': {
      const link = event.links?.[0]
      session.notify({ message: event.message, ...link === undefined ? {} : { url: link.url } })
      return
    }
    case 'auth_url':
      session.notify({
        message: event.instructions ?? 'Open this page to continue signing in.',
        url: event.url,
      })
      return
    case 'device_code':
      session.notify({
        message: 'Enter this code on the verification page to finish signing in.',
        url: event.verificationUri,
        code: event.userCode,
      })
      return
    case 'progress':
      session.notify({ message: event.message })
      return
    default:
      session.notify({ message: 'Signing in…' })
  }
}

/** Translate a pi-ai prompt, preserving its individual withdrawal signal. */
function restate(prompt: AuthPrompt): AuthorizationPrompt {
  const signal = prompt.signal === undefined ? {} : { signal: prompt.signal }
  switch (prompt.type) {
    case 'select':
      return { ...signal, kind: 'select', message: prompt.message, options: prompt.options }
    case 'secret':
      return {
        ...signal,
        kind: 'secret',
        message: prompt.message,
        ...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder },
      }
    default:
      return {
        ...signal,
        kind: 'text',
        message: prompt.message,
        ...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder },
      }
  }
}

/**
 * Construct one authorization flow for every installed provider that ships a login.
 * @param auth - the injectables every pi-ai collection is built with.
 * @param onUnstorable - optional report for a provider id outside credential-key syntax.
 * @returns the provider login flows in installed-catalog order.
 */
export function createPiAiFlows(
  auth: PiAiAuthInjection,
  onUnstorable?: (providerId: string) => void,
): AuthorizationFlow[] {
  const flows: AuthorizationFlow[] = []
  for (const providerId of catalogProviderIds()) {
    const provider = catalogProvider(providerId)
    const loginProvider = providerId === 'openai-codex' && provider !== undefined
      ? { ...provider, auth: { oauth: createSiwcOAuth(auth.credentials) } }
      : provider
    const [first, ...rest] = loginMethods(loginProvider)
    if (loginProvider === undefined || first === undefined) continue
    if (!isCredentialKeySegment(providerId)) {
      onUnstorable?.(providerId)
      continue
    }
    flows.push({
      key: recordKeyFor(providerId),
      label: loginProvider.name,
      methods: [first, ...rest],
      async run(session) {
        const models = createModels(auth)
        models.setProvider(loginProvider)
        const type: AuthType = session.method === 'oauth' ? 'oauth' : 'api_key'
        await models.login(providerId, type, {
          signal: session.signal,
          notify: (event) => { relay(event, session) },
          prompt: prompt => session.prompt(restate(prompt)),
        })
      },
    })
  }
  return flows
}
