/** Ordered, reversible prompt-section contributions for native applications. */
import { NativeContributions, type NativeScope } from '@deepseek-ai/dsh-native-runtime'

/** Session-level tool allowlist that can constrain a scoped prompt contribution. */
export interface NativePromptRenderContext {
  readonly allowedTools?: readonly string[]
}

/** One named section whose text is resolved before the model-visible message is logged. */
export interface NativePromptSection {
  readonly name: string
  readonly order: number
  /**
   * @param scope - exact consuming Agent scope.
   * @param context - Session tool allowlist constraint, when supplied.
   * @returns text logged by the Program before its request.
   */
  text(scope: NativeScope, context?: NativePromptRenderContext): string | Promise<string>
}

/** Native system-prompt registry; applications own final assembly and Session logging. */
export class NativePromptRegistry {
  private readonly sections: NativeContributions<NativePromptSection>

  /** @param scope - Provider scope containing its contributions and consuming Agents. */
  constructor(private readonly scope: NativeScope) { this.sections = new NativeContributions(scope) }

  /**
   * Register one section and return its exact disposer.
   * @param section - named text contribution and render order.
   * @param scope - contribution scope, defaulting to the Provider scope.
   * @returns a disposer for this exact section.
   */
  register(section: NativePromptSection, scope?: NativeScope): () => void {
    if (!Number.isFinite(section.order)) throw new Error(`native-prompt: invalid order for ${section.name}`)
    return this.sections.register(section.name, section, scope)
  }

  /**
   * Render current sections in stable order, omitting empty text.
   * @param scope - consuming scope, defaulting to the Provider scope for diagnostics.
   * @param context - Session tool allowlist constraint, when available.
   * @returns assembled system-prompt additions.
   */
  async render(scope = this.scope, context?: NativePromptRenderContext): Promise<string> {
    const ordered = [...this.sections.visible(scope).values()].sort((left, right) => left.order - right.order
      || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    const text = await Promise.all(ordered.map(async section => section.text(scope, context)))
    return text.filter(part => part.length > 0).join('\n\n')
  }

  /** Remove all contributions during Provider teardown. */
  clear(): void { this.sections.clear() }
}

export { plugin } from './native.ts'
