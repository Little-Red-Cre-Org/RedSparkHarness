/**
 * Native Provider for the spill policy.
 *
 * The Native tool registry exposes the same two extension points the Cordis
 * one does — a prepended result waterfall (`postResult`) and a log-only
 * waterfall for nested program dispatch (`postPtcDispatchLog`) — so this port
 * keeps the policy's behaviour verbatim and differs only in how the two are
 * reached and how the owning Session is read.
 *
 * The decision rules, in the order that makes them correct:
 *
 * - An omitted `maxInlineBytes` registers nothing at all.
 * - A cap that is not a non-negative integer fails the deployment at load,
 *   never a tool call: `TextRetainer` would otherwise throw inside every
 *   oversized call and turn it into an error.
 * - The notice's own byte cost is reserved inside the cap, so the replacement
 *   (preview, blank line, notice) cannot exceed the documented budget.
 * - When the notice alone would exceed the cap there is no within-cap
 *   replacement, so the original content is kept rather than spilling.
 * - The model-facing arm skips `read` and nested calls; the dispatch-log arm
 *   bounds both, because a log copy is not model context.
 * - Every failure keeps the original inline content. A spill failure must never
 *   turn a successful call into an error or hide what it returned.
 *
 * @module @redspark/rsh-spill-policy/native
 */
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type { NativeToolExecution, NativeToolResult } from '@redspark/rsh-native-tools'
import type { ContentBlock } from '@redspark/rsh-llm/types'
import type { ToolCallId } from '@redspark/rsh-llm/brand'
import type { Omitted } from '@redspark/rsh-output-retention'
import { TextRetainer } from '@redspark/rsh-output-retention'
import type { SaveTextSpill, SpillRef } from '@redspark/rsh-spill/native'
import { formatSpillNotice } from './notice.ts'

/** Provider configuration. */
export interface NativeSpillPolicyConfig {
  /**
   * The model-facing context cap for a plain-text tool result, in UTF-8 bytes.
   * Omitted disables the policy entirely.
   */
  readonly maxInlineBytes?: number
}

/** All-text content flattened to one UTF-8 string, or undefined if any block is non-text. */
function flattenPlainText(content: readonly ContentBlock[]): string | undefined {
  let text = ''
  for (const block of content) {
    if (block.type !== 'text') return undefined
    text += block.text
  }
  return text
}

/** Build the bounded head/tail preview for `text`, splitting `budget` bytes across both ends. */
function preview(text: string, budget: number): { text: string; omitted: Omitted } {
  const retainer = new TextRetainer({
    kind: 'headTail', headBytes: Math.ceil(budget / 2), tailBytes: Math.floor(budget / 2),
  })
  retainer.push(text)
  const kept = retainer.finish()
  return { text: kept.text, omitted: kept.omittedBytes }
}

/** Native spill policy Provider. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-spill-policy',
  targets: ['host'],
  requires: ['tools'],
  optional: ['spillStore'],
  provides: [],
  resolve(input) {
    const config = (input ?? {}) as NativeSpillPolicyConfig
    const maxInlineBytes = config.maxInlineBytes
    // An omitted cap registers no policy at all, which is the documented no-op.
    if (maxInlineBytes === undefined) return () => {}
    if (!Number.isInteger(maxInlineBytes) || maxInlineBytes < 0) {
      throw new Error(`spill-policy: maxInlineBytes must be a non-negative integer (got ${maxInlineBytes})`)
    }
    const cap: number = maxInlineBytes
    return (context) => {
      const tools = context.require('tools')

      /**
       * Spill `text` and build the bounded replacement, or undefined when the
       * original must be kept. Shared verbatim by both arms so the model-facing
       * and log projections stay byte-identical.
       */
      async function spillReplacement(
        text: string,
        totalBytes: number,
        sessionId: string | undefined,
        toolName: string,
        callId: ToolCallId,
        label: 'result' | 'dispatch',
        signal: AbortSignal,
      ): Promise<string | undefined> {
        if (sessionId === undefined) return undefined
        const spillStore = context.optional('spillStore')
        if (spillStore === undefined) return undefined
        const save: SaveTextSpill = {
          owner: { sessionId },
          source: { kind: 'tool', toolName, callId, label },
          suggestedName: `${toolName}.txt`,
          content: text,
        } as SaveTextSpill
        let ref: SpillRef
        try {
          ref = await spillStore.saveText(save, signal)
        } catch {
          // A storage failure must never fail the call or hide the content.
          return undefined
        }
        // Reserve the notice inside the cap, priced at the worst-case omission
        // count so the reserved size upper-bounds the real one.
        const reserve = Buffer.byteLength(formatSpillNotice({ kind: 'exact', count: totalBytes }, ref), 'utf8') + 2
        const { text: previewText, omitted } = preview(text, Math.max(0, cap - reserve))
        const notice = formatSpillNotice(omitted, ref)
        const replaced = previewText.length > 0 ? `${previewText}\n\n${notice}` : notice
        // Invariant: never emit a replacement larger than the cap.
        if (Buffer.byteLength(replaced, 'utf8') > cap) return undefined
        return replaced
      }

      context.own(tools.postResult(async (call: NativeToolExecution, _original: Readonly<NativeToolResult>, next) => {
        // Delegate first so a downstream policy settles the result; whatever it
        // accepts is what this arm bounds.
        const selected = await next()
        if (call.parent !== undefined || call.name === 'read') return selected
        const text = flattenPlainText(selected.content)
        if (text === undefined) return selected
        const totalBytes = Buffer.byteLength(text, 'utf8')
        if (totalBytes <= cap) return selected
        const replaced = await spillReplacement(
          text, totalBytes, call.session.header.id, call.name, call.callId, 'result', call.signal)
        if (replaced === undefined) return selected
        const content: ContentBlock[] = [{ type: 'text', text: replaced }]
        return { ...selected, content }
      }))

      // The log arm bounds the durable copy of a nested program dispatch; the
      // program's own value already crossed the worker boundary whole.
      context.own(tools.postPtcDispatchLog(async (call, _original, next, signal) => {
        const log = await next()
        const text = flattenPlainText(log.content)
        if (text === undefined) return log
        const totalBytes = Buffer.byteLength(text, 'utf8')
        if (totalBytes <= cap) return log
        const replaced = await spillReplacement(
          text, totalBytes, call.session.header.id, call.name, call.callId, 'dispatch', signal)
        if (replaced === undefined) return log
        return { ...log, content: [{ type: 'text', text: replaced }] }
      }))
    }
  },
}
