/** Provider-owned catalogs and installed composition metadata decoded at the browser wire. */
import { z } from 'zod'
import type { ModelCatalog } from '@deepseek-ai/dsh-native-model-selection/types'

/** Read-only choices advertised by the selected Host; missing Providers stay explicit. */
export interface NativeModelControls {
  readonly catalog: ModelCatalog | null
  readonly canSelectModel: boolean
  readonly images?: {
    readonly maxImageBytes: number
    readonly maxImagesPerMessage: number
    readonly maxMessageImageBytes: number
    readonly maxImagePixels: number
    readonly maxImageDimension: number
    readonly mediaTypes: readonly ('image/png' | 'image/jpeg' | 'image/webp' | 'image/gif')[]
  }
  readonly presets: readonly { readonly id: string; readonly name: string; readonly description?: string }[]
}

const text = z.string().min(1)
const selected = z.strictObject({ provider: text, model: text, reasoningEffort: text.optional() })
const named = { id: text, name: text, description: z.string().optional() }
const model = z.strictObject({ ...named, reasoning: z.strictObject({
  efforts: z.array(z.strictObject(named)), defaultEffort: text.optional(),
}).optional() })

/** Exact JSON reply decoder; catalogs are advisory rather than an admission allow-list. */
// JSON omits undefined optional values; Zod's static optionals also admit present undefined.
export const nativeModelControlsSchema = z.strictObject({
  catalog: z.strictObject({ default: selected, routableProviders: z.array(text),
    groups: z.array(z.strictObject({ id: text, name: text, models: z.array(model) })),
    failures: z.array(z.strictObject({ id: text, name: text, message: z.string() })),
  }).nullable(),
  canSelectModel: z.boolean(), presets: z.array(z.strictObject(named)),
  images: z.strictObject({ maxImageBytes: z.number().int().positive(), maxImagesPerMessage: z.number().int().positive(),
    maxMessageImageBytes: z.number().int().positive(), maxImagePixels: z.number().int().positive(),
    maxImageDimension: z.number().int().positive(),
    mediaTypes: z.array(z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])),
  }).optional(),
}) as unknown as z.ZodType<NativeModelControls>
