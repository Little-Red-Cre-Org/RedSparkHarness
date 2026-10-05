/** Ordered, reversible prompt-section contributions for native applications. */

import type { NativeScope } from '@deepseek-ai/dsh-native-runtime'

/** One named section whose text is resolved before the model-visible message is logged. */
export interface NativePromptSection {
  readonly name: string
  readonly order: number
  /** @param scope - requesting Agent scope when supplied by the application. @returns model-visible section text. */
  text(scope?: NativeScope): string | Promise<string>
}

/** Native system-prompt registry; applications own final assembly and Session logging. */
export class NativePromptRegistry {
  private readonly sections = new Map<string, NativePromptSection>()

  /**
   * Register one section and return its exact disposer.
   * @param section - named text contribution and render order.
   * @returns a disposer for this exact section.
   */
  register(section: NativePromptSection): () => void {
    if (!Number.isFinite(section.order)) throw new Error(`native-prompt: invalid order for ${section.name}`)
    if (this.sections.has(section.name)) throw new Error(`native-prompt: duplicate section ${section.name}`)
    this.sections.set(section.name, section)
    return () => { if (this.sections.get(section.name) === section) this.sections.delete(section.name) }
  }

  /**
   * Render current sections in stable order, omitting empty text.
   * @param scope - requesting Agent scope used by scoped contributions.
   * @returns assembled system-prompt additions.
   */
  async render(scope?: NativeScope): Promise<string> {
    const ordered = [...this.sections.values()].sort((left, right) => left.order - right.order
      || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    const text = await Promise.all(ordered.map(async section => section.text(scope)))
    return text.filter(part => part.length > 0).join('\n\n')
  }

  /** Remove all contributions during Provider teardown. */
  clear(): void { this.sections.clear() }
}

export { plugin } from './native.ts'
