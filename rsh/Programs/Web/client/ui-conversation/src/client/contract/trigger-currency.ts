/**
 * Input-trigger currency shared by the browser input machine and the Native pipeline.
 */

/** Pick-time draft span guarded by the input revision. */
export interface TokenSpan {
  readonly start: number
  readonly end: number
  readonly draftRev: number
}

/** Attachment payload passed to a claimed command submission. */
export type SubmitAttachment =
  | {
    readonly type: 'image'
    readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
    readonly data: string
    readonly name?: string
  }
  | { readonly type: 'file'; readonly receiptId: string }

/** Settled result of a command or default composer submission. */
export interface SubmitOutcome {
  readonly kind: 'success' | 'error'
  readonly text?: string
}

/** Command-mode credential supplied by one input-trigger source. */
export interface CommandClaim<Scope = object> {
  /** Catalog command name without the leading slash (the key of per-command composer copy such as `hint.*`). */
  readonly name: string
  /** Inserted command text with its argument separator; the bare complete name also retains the claim. */
  readonly token: string
  readonly hint?: string
  readonly attachments?: boolean
  /**
   * Submit the claimed command.
   * @param args - command text after the claimed token.
   * @param actx - current Session scope.
   * @param attachments - serialized draft attachments accepted by the claim.
   * @returns command settlement.
   */
  submit(args: string, actx: Scope, attachments: readonly SubmitAttachment[]): Promise<SubmitOutcome>
}

/** Structured reference inserted by an input-trigger source. */
export interface ReferenceInsert {
  readonly source: string
  readonly ref: string
  readonly label: string
  readonly appearance?: 'session' | 'file' | 'folder'
  readonly clipboardText: string
}

/** Result of trigger-source adjudication. */
export type PickOutcome<Scope = object> =
  | { readonly claim: CommandClaim<Scope> }
  | { readonly insert: ReferenceInsert }
  | { readonly text: string; readonly continue?: boolean }
  | 'handled'
  | undefined

/** Keyboard keys intercepted by an open trigger menu. */
export type ArbitrateKey = 'up' | 'down' | 'enter' | 'escape' | 'tab'

/** Trigger-menu keyboard routing result. */
export type ArbitrateOutcome = 'consumed' | 'pick-highlighted' | 'pass'

/** Scoped request to enter command mode. */
export interface BeginCommandRequest<Scope = object> {
  readonly claim: CommandClaim<Scope>
  readonly span: TokenSpan
}

/** Scoped request to insert a structured reference. */
export interface InsertReferenceRequest {
  readonly reference: ReferenceInsert
  readonly span: TokenSpan
}

/** Scoped request to consume a command token after business settlement. */
export interface ConsumeTokenRequest {
  readonly guard:
    | { readonly kind: 'span'; readonly span: TokenSpan }
    | { readonly kind: 'bare-token'; readonly token: string }
}

/** Scoped request to insert ordinary completion text. */
export interface InsertTextRequest {
  readonly text: string
  readonly span: TokenSpan
  readonly continue?: boolean
}

/** Trigger hit used to open one source programmatically. */
export interface InputTriggerHit {
  readonly trigger: '/' | '@'
  readonly query: string
  readonly quoted: boolean
  readonly position: 'leading' | 'inline'
  readonly span: TokenSpan
}
