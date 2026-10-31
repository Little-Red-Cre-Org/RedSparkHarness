/** Ordered, reversible prompt-section contributions for native applications. */
import { NativeContributions, type NativeScope } from '@deepseek-ai/dsh-native-runtime'
import type { ToolSdkSchema } from '@deepseek-ai/dsh-native-tools/sdk-typescript'

/** Session constraints and captured tool declarations used while rendering prompt contributions. */
export interface NativePromptRenderContext {
  readonly allowedTools?: readonly string[]
  /** Exact PTC bindings for an operation; prompt sections must not re-read a replacement Registry catalog. */
  readonly programSchemas?: readonly ToolSdkSchema[]
  /**
   * Strict `{{variable}}` values for this render, matching the Cordis prompt registry.
   *
   * A section that references an unregistered name fails instead of reaching the model with
   * literal braces, so a caller that omits this map may only render variable-free sections.
   */
  readonly variables?: Readonly<Record<string, string | undefined>>
}

/** Valid variable names: how they are written between the braces. */
const VARIABLE_NAME = /^[a-z][a-z0-9_]*$/

/** A complete `{{...}}` reference group at the scan position (validated after). */
const GROUP_AT = /^\{\{([^{}]*)\}\}/

/**
 * Interpolate strict `{{variable}}` references in one section's text.
 *
 * Mirrors the Cordis prompt registry: malformed, unknown, or undefined references throw, a lone
 * `{{` without any later `}}` is literal prose, and substituted values are not scanned again.
 * @param name - section name used in diagnostics.
 * @param text - the section text carrying zero or more references.
 * @param variables - registered values for this render.
 * @returns the interpolated text.
 */
export function interpolatePromptText(
  name: string,
  text: string,
  variables: Readonly<Record<string, string | undefined>>,
): string {
  if (!text.includes('{{')) return text
  let result = ''
  let last = 0
  for (let open = text.indexOf('{{'); open >= 0; open = text.indexOf('{{', last)) {
    const group = GROUP_AT.exec(text.slice(open))
    if (group === null) {
      if (text.indexOf('}}', open + 2) >= 0) {
        throw new Error(`malformed prompt variable reference at "${text.slice(open, open + 16)}…" in section "${name}" (references are complete simple {{name}} groups)`)
      }
      result += text.slice(last, open + 2)
      last = open + 2
      continue
    }
    const variable = group[0].slice(2, -2)
    if (!VARIABLE_NAME.test(variable)) {
      throw new Error(`malformed prompt variable reference "{{${variable}}}" in section "${name}" (variable names match ${String(VARIABLE_NAME)})`)
    }
    if (!Object.hasOwn(variables, variable)) {
      const known = Object.keys(variables)
      throw new Error(`unknown prompt variable "{{${variable}}}" in section "${name}"; registered variables: ${known.length > 0 ? known.join(', ') : '(none)'}`)
    }
    const value = variables[variable]
    if (value === undefined) {
      throw new Error(`prompt variable "{{${variable}}}" has no value for this assembly (section "${name}")`)
    }
    result += text.slice(last, open) + value
    last = open + group[0].length
  }
  return result + text.slice(last)
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
    const variables = context?.variables ?? {}
    return text
      .map((part, index) => interpolatePromptText(ordered[index]?.name ?? '', part, variables))
      .filter(part => part.length > 0)
      .join('\n\n')
  }

  /** Remove all contributions during Provider teardown. */
  clear(): void { this.sections.clear() }
}

export { plugin } from './native.ts'
