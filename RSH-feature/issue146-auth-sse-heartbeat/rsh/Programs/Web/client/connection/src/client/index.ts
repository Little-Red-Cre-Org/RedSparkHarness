/** Cordis Client adapter for the shared browser connection implementation. */
import type { Context } from '@deepseek-ai/cordis'
import { createFixtureConnectionRpc } from './fixture.ts'
import { createConnectionHandle } from './native-core.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A connection generation was established. Wire-derived caches must
     * repull; long-lived streams own their own resume and baseline lifecycle.
     * @mode emit
     */
    'connection/reset'(): void
  }
}

export type {
  MessageId,
  RpcRequest, RpcResponse, RpcResult,
  ClientRequest, ServerResponse, RpcMessage,
  SessionId, SessionEvent, ContentBlock, StreamChunk,
} from './api.ts'
export { RpcId, transportError } from './api.ts'
export type {
  ConnectionRecoveryConfig,
  ConnectionGeneration,
  ConnectionGenerationSource,
  ConnectionHostInfo,
  ConnectionSinks,
  ConnectionState,
} from './connection.ts'
export type {
  ClientConnectionRpc, ConnectionRpcFailure, ConnectionRpcResult,
} from '../rpc.ts'
export type { RpcFetch } from './rpc.ts'
export type {
  ClientTransportHooks, ConnectionGenerationState, ConnectionHandle,
  ConnectionLoop, ConnectionStateSource,
} from './native-core.ts'

/** Required services (none — this is the wire root). */
export const inject: string[] = []

/**
 * Install the browser Connection in a Cordis Client scope.
 * @param ctx - client context that owns the connection state and recovery loop.
 */
export function apply(ctx: Context): void {
  const pageLocation = typeof location === 'undefined' ? undefined : location
  const fixture = pageLocation !== undefined && new URLSearchParams(pageLocation.search).has('fixture')
  const connection = createConnectionHandle(fixture ? createFixtureConnectionRpc() : undefined)
  ctx.provide('connection', connection.handle)
  ctx.effect(() => () => connection.dispose(), 'client-connection: browser state')
}
