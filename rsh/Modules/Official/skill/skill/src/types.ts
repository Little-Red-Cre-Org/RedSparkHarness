/** Cordis-free skill catalog and provider vocabulary. */

/** Origin bucket for a skill contribution. */
export type SkillSource = 'project-dsh' | 'project-agents' | 'runtime' | 'user-dsh' | 'user-agents' | 'custom' | 'bundled' | (string & {})

/** Optional provider-specific base used by loaded skill bodies to resolve relative resources. */
export type SkillResourceBase =
  | { readonly kind: 'directory'; readonly path: string }
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'opaque'; readonly description: string }

/** Invocation controls shared by skill discovery consumers. */
export interface SkillInvocationPolicy {
  /** Whether model-facing catalogs and loaders include this skill. */
  readonly modelInvocable: boolean
  /** Whether human-facing command catalogs and loaders include this skill. */
  readonly userInvocable: boolean
}

/** Invocation-neutral skill metadata returned by a registry lookup. */
export interface SkillSummary {
  /** Absolute instruction file path when supplied by the provider; absent for virtual skills. */
  readonly path?: string
  /** Kebab-case identifier used to address the skill. */
  readonly name: string
  /** Short routing description shown by discovery consumers. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** Resolved model and user invocation controls. */
  readonly invocation: SkillInvocationPolicy
  /** Discovery source that produced this winning skill. */
  readonly source: SkillSource
  /** Provider that owns this skill body. */
  readonly provider: string
  /** Provider-specific base for relative resources. */
  readonly resourceBase?: SkillResourceBase
}

/** Provider catalog entry used by a registry to merge and later load skills. */
export interface SkillCandidate extends SkillSummary {
  /** Lower ranks win duplicate skill names before provider registration order is considered. */
  readonly rank: number
  /** Opaque provider-owned handle passed back to `provider.get()`. */
  readonly locator: unknown
  /** Parsed optional metadata object from provider-specific skill frontmatter. */
  readonly metadata?: Readonly<Record<string, unknown>>
}

/** Complete parsed skill definition, including the body loaded from a candidate. */
export interface SkillDefinition extends SkillSummary {
  /** Markdown instruction body after any provider-specific metadata removal. */
  readonly content: string
  /** Parsed optional metadata object from frontmatter. */
  readonly metadata?: Readonly<Record<string, unknown>>
}

/** Runtime skill contribution accepted by a registry. */
export type SkillRegistration = Omit<SkillDefinition, 'invocation' | 'provider'> & {
  /** Invocation controls; omission permits both model and user surfaces. */
  readonly invocation?: SkillInvocationPolicy
  /** Provider label; omission uses the registry-owned runtime provider. */
  readonly provider?: string
}

/** Caller context used for cwd-sensitive and abortable provider work. */
export interface SkillLookupOptions {
  /** Workspace selector for the current lookup. */
  readonly cwd?: string | undefined
  /** Abort discovery or loading work for the current caller. */
  readonly signal?: AbortSignal | undefined
}

/** Durable source for a user-explicit skill invocation. */
export interface SkillInvocationSource {
  readonly kind: 'skill-invocation'
  /** Invoked skill name, validated user-invocable at the injecting boundary. */
  readonly name: string
  /** Injected skill bodies are instructions for the model to follow. */
  readonly form: 'instructions'
}

declare module '@deepseek-ai/dsh-llm/message' {
  interface MessageSourceMap {
    /** A user-explicit skill invocation injected by the host. */
    'skill-invocation': SkillInvocationSource
  }
}

/** One catalog observation plus whether discovery completed within a stable catalog revision. */
export interface SkillCatalogSnapshot {
  /** Sorted invocation-neutral summaries collected in this observation. */
  readonly skills: SkillSummary[]
  /** Whether every registered provider completed without a concurrent catalog revision. */
  readonly complete: boolean
}

/** Provider candidates plus whether the current discovery is authoritative. */
export interface SkillProviderObservation {
  /** Candidates available from the current provider discovery. */
  readonly candidates: readonly SkillCandidate[]
  /** Whether discovery completed and these candidates may be cached. */
  readonly complete: boolean
}

/** Provider interface for one source of skills, such as local directories or a remote registry. */
export interface SkillProvider {
  /** Unique provider name in the registry. */
  readonly name: string
  /**
   * Discover candidates on demand. Registration is synchronous; defer asynchronous initialization,
   * authentication, and discovery until this method is awaited by the registry.
   * Stop promptly when `options.signal` is aborted. Returning an array asserts that discovery is
   * complete; return an observation with `complete: false` whenever a required source could not be
   * fully read.
   * @param options - lookup options; `cwd` selects workspace-sensitive skills and `signal` cancels work.
   * @returns candidates or an explicit completeness observation.
   */
  readonly list: (
    options: SkillLookupOptions,
  ) => Promise<
    readonly SkillCandidate[] | SkillProviderObservation
  >
  /** Load the winning candidate's full definition on demand.
   * @param candidate - the winning candidate originally returned by this provider.
   * @param options - lookup options.
   * @returns the full skill body, or `undefined` if it is no longer loadable.
   */
  readonly get: (candidate: SkillCandidate, options: SkillLookupOptions) => Promise<SkillDefinition | undefined>
}

/** Registration-scoped lifecycle and invalidation capability borrowed by one provider. */
export interface SkillProviderControl {
  /** Aborts if registration fails or when the exact provider registration is disposed. */
  readonly signal: AbortSignal
  /** Invalidates completed catalogs only while the exact registration remains active. */
  readonly invalidate: () => void
}
