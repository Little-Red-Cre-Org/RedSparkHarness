/** Cordis-free durable facts emitted by the Native and compatibility consumers. */

/** Catalog entries recorded beside the model-visible skill list. */
export interface SkillCatalogSource {
  readonly kind: 'skill-catalog'
  readonly form: 'catalog'
  /** Marks a replacement catalog rather than this Session's first publication. */
  readonly update?: true
  /** Exactly the entries this message published, in catalog order. */
  readonly entries: readonly { readonly name: string; readonly description: string }[]
}

declare module '@deepseek-ai/dsh-llm/message' {
  interface MessageSourceMap {
    'skill-catalog': SkillCatalogSource
  }
}
