/** SDK protocol keeps the Core transport's public constructor and error identity. */
import { describe, expect, it } from 'vitest'
import {
  JsonRpcLineTransport as CoreTransport,
  JsonRpcResponseError as CoreResponseError,
} from '@deepseek-ai/dsh-json-rpc-line'
import { JsonRpcLineTransport, JsonRpcResponseError } from '../src/index.ts'

describe('SDK protocol transport exports', () => {
  it('re-exports the Core implementations without wrapping them', () => {
    expect(JsonRpcLineTransport).toBe(CoreTransport)
    expect(JsonRpcResponseError).toBe(CoreResponseError)
  })
})
