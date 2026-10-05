/** Native token-meter Definition and Provider over the shared replay estimator. */
import type { EpochHeader, Session } from '@deepseek-ai/dsh-session/native'
import type { Message } from '@deepseek-ai/dsh-llm/native'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-native-model-execution/native'
import type { TokenMeasurement } from './meter-types.ts'
import { ReplayTokenMeter } from './meter-core.ts'

/** Durable replay metering without another Session writer. */
export interface NativeTokenMeterOperations {
  /** @param session - actual authoritative Session.
   * @param requestHeader - optional recorded envelope override.
   * @returns detached measurement distinguishing provider and estimated baselines.
   */
  measure(session: Session, requestHeader?: EpochHeader): TokenMeasurement
  /**
   * @param message - model-visible message.
   * @returns fixed-heuristic content and framing tokens.
   */
  estimateMessage(message: Message): number
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { tokenMeter: NativeTokenMeterOperations }
}

/** Install one read-only replay estimator over the selected model's request pricing. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-token-meter', targets: ['host'],
  requires: ['model'], provides: ['tokenMeter'],
  resolve(input) {
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length !== 0)) {
      throw new Error('token-meter: native configuration must be empty')
    }
    return (context) => {
      const model = context.require('model')
      context.provide('tokenMeter', new ReplayTokenMeter({ imageRequestPricing: (provider, id) => model.imageRequestPricing?.(provider, id) }))
    }
  },
}

export type { TokenMeasurement, TokenMeasurementBaseline } from './meter-types.ts'
