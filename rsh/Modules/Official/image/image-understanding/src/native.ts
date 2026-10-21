/** Official NativePlugin for automatic image interpretation and Session-scoped follow-up questions. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { ImageUnderstandingConfig } from '@deepseek-ai/dsh-native-model-execution'
import type {} from '@deepseek-ai/dsh-native-model-execution/native'
import type {} from '@deepseek-ai/dsh-native-tools/native'
import type {} from '@deepseek-ai/dsh-session-persistence/native'
import { NativeImageUnderstanding } from './service.ts'
import { imageQuestionTool } from './tool.ts'

/** Install one explicit vision route without changing the primary model selection. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-image-understanding', targets: ['host'],
  requires: ['model', 'modelExecution', 'tools', 'sessionPersistence'], provides: ['imageUnderstanding'],
  resolve(input) {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw new Error('image-understanding: configure provider, model and maxTokens')
    }
    const fields = input as Record<string, unknown>
    if (Object.keys(fields).some(key => !['provider', 'model', 'maxTokens'].includes(key))
      || typeof fields.provider !== 'string' || !fields.provider.trim()
      || typeof fields.model !== 'string' || !fields.model.trim()
      || typeof fields.maxTokens !== 'number' || !Number.isSafeInteger(fields.maxTokens) || fields.maxTokens < 1) {
      throw new Error('image-understanding requires provider, model and a positive integer maxTokens')
    }
    const config: ImageUnderstandingConfig = { provider: fields.provider, model: fields.model, maxTokens: fields.maxTokens }
    return (context) => {
      const vision = new NativeImageUnderstanding(context.require('model'), config, context.signal)
      context.provide('imageUnderstanding', vision)
      context.own(context.require('modelExecution').registerImageUnderstanding(vision))
      context.own(context.require('tools').registerValueTool(imageQuestionTool(vision, context.require('sessionPersistence')), context.scope))
    }
  },
}
