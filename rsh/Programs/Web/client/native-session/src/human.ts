/** Transient human presentations and answers for one authenticated Web turn. */
import { z } from 'zod'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identity of one pending Web presentation; it carries no execution authority. */
export type NativeWebHumanId = Branded<'native-web-human'>

const question = z.strictObject({ id: z.string(), question: z.string(), detail: z.string().optional(),
  header: z.string().optional(), options: z.array(z.strictObject({ label: z.string(), description: z.string().optional() })).optional(),
  multiSelect: z.boolean().optional(), intent: z.strictObject({ kind: z.literal('plan-review'), approve: z.string() }).optional() })

/** Parser for human-request JSON received through the existing bounded follow stream. */
export const nativeWebHumanSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('approval'), id: z.string().min(1), toolName: z.string(), reason: z.string().optional() }),
  z.strictObject({ kind: z.literal('questions'), id: z.string().min(1), questions: z.array(question).min(1) }),
])

/** Only presentation fields cross into the browser; Agent and writer stay on the Host. */
export type NativeWebHumanPrompt =
  | { readonly kind: 'approval'; readonly id: NativeWebHumanId; readonly toolName: string; readonly reason?: string }
  | { readonly kind: 'questions'; readonly id: NativeWebHumanId; readonly questions: readonly z.infer<typeof question>[] }

/** Closed answers passed to the existing approval or question Provider. */
export type NativeWebHumanAnswer =
  | { readonly kind: 'approval'; readonly outcome: 'allowed-once' | 'rejected' }
  | { readonly kind: 'questions'; readonly answer: { readonly answers: { readonly id: string; readonly selected: string[]; readonly custom?: string }[] } }
