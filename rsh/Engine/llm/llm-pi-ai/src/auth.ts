/** Cordis auth facade over the shared credential and launch-environment implementation. */
import type { Context } from '@deepseek-ai/cordis'
import type { AuthContext, CredentialStore } from '@earendil-works/pi-ai'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { authContextFrom as createAuthContext, credentialStoreFrom as createCredentialStore } from './auth-core.ts'
export { RECORD_SCOPE, recordKeyFor } from './auth-core.ts'

/** @param ctx - current credential service scope. @returns pi-ai storage with current service lookup on each operation. */
export function credentialStoreFrom(ctx: Context): CredentialStore {
  return {
    read: id => createCredentialStore(ctx.get('credentials')).read(id),
    list: () => createCredentialStore(ctx.get('credentials')).list(),
    modify: (id, mutate) => createCredentialStore(ctx.get('credentials')).modify(id, mutate),
    delete: id => createCredentialStore(ctx.get('credentials')).delete(id),
  }
}

/** @param ctx - current credential and launch environment scope. @returns provider ambient auth queries. */
export function authContextFrom(ctx: Context): AuthContext {
  return {
    env: name => createAuthContext(ctx.get('credentials'), launchEnvironmentOf(ctx)).env(name),
    fileExists: file => createAuthContext(ctx.get('credentials'), launchEnvironmentOf(ctx)).fileExists(file),
  }
}
