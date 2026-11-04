/**
 * The Models page's Host ports over the Native Session transport.
 *
 * The browser build reaches these facts through `ctx.remote`; a Native host
 * reaches the same ones through `clientNativeSession`. Both answer with the
 * same business values, so this module adapts the Native client into the face
 * the page already drives — the store, the operations and every provider card
 * stay one implementation.
 *
 * Two Native facts differ from the browser wire and are folded here rather than
 * pushed into the page: the transport reports a refusal as a rejection instead
 * of a failure envelope, and it spells namespace identity `namespace` where the
 * wire spells it `ns`.
 */

import type {
  NativeCredentialInfo, NativeSessionClient, NativeSettingsDescriptor, NativeSettingsEvent,
} from '@redspark/rsh-client-native-session/native'
import type { CredentialInfo, ModelsCarried, ModelsRemoteFace, SettingsNamespaceView } from './client/ports.ts'

/** Native Session methods the Models page drives. */
export type NativeModelsClient = Pick<NativeSessionClient,
  | 'settingsDescribe' | 'settingsMutate'
  | 'credentialsDescribe' | 'credentialsSet' | 'credentialsUnset'
  | 'modelsListProviders' | 'modelsListConfigurableProviders' | 'modelsDiscover'
  | 'settingsEvents'>

/**
 * Report one Native call as the browser's carrier envelope.
 * @param call - the Native transport call.
 * @returns the carried value, or a failure envelope carrying the rejection message.
 */
async function carried<T>(call: () => Promise<T>): Promise<ModelsCarried<T>> {
  try {
    return { ok: true, value: await call() }
  } catch (error: unknown) {
    return {
      ok: false,
      error: { code: 'native/transport', message: error instanceof Error ? error.message : String(error) },
    }
  }
}

/**
 * Project one Host descriptor onto the wire-shaped namespace view the page reads.
 * @param descriptor - redacted descriptor returned by `settingsDescribe`.
 * @returns the namespace view with its wire spelling and secret slots.
 */
export function toNamespaceView(descriptor: NativeSettingsDescriptor): SettingsNamespaceView {
  return {
    ns: descriptor.namespace,
    schema: descriptor.schema,
    value: descriptor.value,
    // The Native transport always reports both layers (an empty object for an
    // absent one), so this projection never has to decide whether to omit them.
    base: descriptor.base,
    user: descriptor.user,
    applies: descriptor.applies,
    secrets: descriptor.secrets.map(secret => ({ path: [...secret.path], set: secret.set })),
    revision: descriptor.revision,
  }
}

/**
 * Project one Native credential description onto the wire-shaped presence facts.
 * @param refs - requested reference names.
 * @param described - presence facts keyed by reference.
 * @returns the same facts keyed the way the page reads them.
 */
export function toCredentialFacts(
  refs: readonly string[],
  described: Readonly<Record<string, NativeCredentialInfo>>,
): Record<string, CredentialInfo> {
  const facts: Record<string, CredentialInfo> = {}
  for (const ref of refs) {
    const info = described[ref]
    if (info === undefined) continue
    facts[ref] = { configured: info.configured, writable: info.writable, ...info.source === undefined ? {} : { source: info.source } }
  }
  return facts
}

/**
 * Bind the Native Session client as the Models page's Remote face.
 * @param client - the Native Session client selected by the browser composition.
 * @param signal - the plugin's lifetime, used to cancel every call it starts.
 * @returns the face the page store and provider cards drive.
 */
export function createNativeModelsFace(client: NativeModelsClient, signal: AbortSignal): ModelsRemoteFace {
  return {
    llm: {
      listProviders: async () => carried(async () => client.modelsListProviders(signal)),
      listConfigurableProviders: async () => carried(async () => client.modelsListConfigurableProviders(signal)),
      discoverModels: async (settingsNs, request) => carried(async () =>
        client.modelsDiscover(settingsNs, request as Parameters<NativeModelsClient['modelsDiscover']>[1], signal)),
    },
    credentials: {
      describe: async refs => carried(async () =>
        toCredentialFacts(refs, await client.credentialsDescribe([...refs], signal))),
      set: async (ref, value) => carried(async () => client.credentialsSet(ref, value, signal)),
      unset: async ref => carried(async () => client.credentialsUnset(ref, signal)),
    },
    settings: {
      mutate: async (ns, ops, expectedRevision) => carried(async () =>
        toNamespaceView(await client.settingsMutate(ns, [...ops], expectedRevision ?? 0, signal))),
    },
  }
}

/**
 * Follow the Host's settings notification stream.
 *
 * The browser page refreshes on three separate forwarded events plus a
 * connection reset; the Native transport carries all of them on one stream, so
 * every frame is one refresh signal.
 * @param client - the Native Session client.
 * @param signal - ends this iteration without cancelling the Host's turn.
 * @returns one notification per invalidating fact.
 */
export async function* followInvalidations(
  client: Pick<NativeModelsClient, 'settingsEvents'>,
  signal: AbortSignal,
): AsyncIterable<NativeSettingsEvent['type']> {
  for await (const event of client.settingsEvents(signal)) yield event.type
}
