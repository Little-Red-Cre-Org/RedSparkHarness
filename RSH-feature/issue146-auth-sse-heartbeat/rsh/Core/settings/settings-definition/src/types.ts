/** Client-safe values shared by Settings Host APIs and Client consumers. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Nominal id of one registered settings namespace. */
export type SettingsNamespace = Branded<'SettingsNamespace'>

type LowercaseLetter = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm'
  | 'n' | 'o' | 'p' | 'q' | 'r' | 's' | 't' | 'u' | 'v' | 'w' | 'x' | 'y' | 'z'
type DecimalDigit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
type NamespaceCharacter = LowercaseLetter | DecimalDigit | '-'
type ValidNamespaceTail<Value extends string> = Value extends ''
  ? true
  : Value extends `${NamespaceCharacter}${infer Rest}`
    ? ValidNamespaceTail<Rest>
    : false

/** Settings argument accepting lowercase kebab-case literals, branded ids, or dynamic strings. */
export type SettingsNamespaceInput<Value extends string> = Value extends SettingsNamespace
  ? Value
  : string extends Value
    ? string
    : Value extends `${LowercaseLetter}${infer Rest}`
      ? ValidNamespaceTail<Rest> extends true ? Value : never
      : never

/** Origin of one committed settings change. */
export type SettingsUpdateSource = 'update' | 'provider'

/** One schema-declared secret slot inside a redacted namespace value. */
export interface SettingsSecretView {
  /** Path from the section root to the removed field. */
  path: string[]
  /** Whether the slot currently holds a value; the value itself never rides. */
  set: boolean
}

/** Wire view of one namespace, always read under `redactSecrets`. */
export interface SettingsNamespaceView {
  /** Namespace key (`llm-deepseek`, `llm-pi-ai`, …). */
  ns: string
  /** Serialized schemastery schema envelope. */
  schema: JsonValue
  /** Redacted resolved value (schema defaults → composition base → user layer). */
  value: JsonValue
  /** Redacted composition base layer, when declared. */
  base?: JsonValue
  /** Redacted raw user section, when present. */
  user?: JsonValue
  /** When the owner applies changes. */
  applies: 'live' | 'restart'
  /** Schema-declared secret slots with their configured state. */
  secrets: SettingsSecretView[]
  /** Monotonic revision of the raw user section. */
  revision: number
}

/** One path edit sent over the Settings Remote API. */
export type SettingsPathOpView =
  | { op: 'set'; path: string[]; value: JsonValue }
  | { op: 'unset'; path: string[] }

/** Provider facts and namespace views shown by configuration surfaces. */
export interface SettingsDescribeValue {
  /** Whether the provider accepts writes. */
  writable: boolean
  /** Whether a file-backed provider owns a local document. */
  hasDocument: boolean
  /** One view per registered namespace. */
  namespaces: SettingsNamespaceView[]
}
