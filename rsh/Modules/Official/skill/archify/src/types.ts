/** Durable source for one host-selected Archify instruction injection. */
export interface ArchifyAutoInvocationSource {
  readonly kind: 'archify-auto-invocation'
  /** The Skill body is injected as model instructions. */
  readonly form: 'instructions'
  /** The exact deterministic route that selected Archify. */
  readonly reason: 'diagram-delivery-request'
}

declare module '@redspark/rsh-llm/message' {
  interface MessageSourceMap {
    'archify-auto-invocation': ArchifyAutoInvocationSource
  }
}
