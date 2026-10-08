/** Cordis-free trusted Native Webhook rule registration. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeRootRouteId } from '@deepseek-ai/dsh-native-session-execution/root-route'
import type { WebhookRule, VerifiedWebhookDelivery, WebhookSessionRequest } from './types.ts'

/** Native host operations for trusted provider rules. */
export interface NativeWebhookRuleOperations {
  /**
   * Register one trusted rule until its owner stops admission, cancels its accepted executions, and drains cleanup.
   * @param rule - trusted callback and provider kind selected by the Host composition.
   * @returns idempotent disposal that waits for this registration's owned work.
   */
  register<K extends string>(rule: WebhookRule<K>): () => Promise<void>
  /**
   * Run matching callbacks, then admit every non-null request as an ordinary root Session.
   * @param delivery - immutable provider-authenticated delivery.
   * @param route - existing configured root route used as the execution and Workspace authority.
   * @returns completion after every matching request has reached durable inbox admission or failed.
   */
  dispatch<K extends string>(delivery: VerifiedWebhookDelivery<K>, route: NativeRootRouteId): Promise<void>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { webhookRules: NativeWebhookRuleOperations }
}

export type { NativePlugin, VerifiedWebhookDelivery, WebhookRule, WebhookSessionRequest }
