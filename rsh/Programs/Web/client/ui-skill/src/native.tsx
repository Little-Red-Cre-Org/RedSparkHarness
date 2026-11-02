/**
 * Cordis-free skill row for Native Client consumers.
 *
 * The Cordis half owns two jobs: the '/' skill candidate source and the
 * `skill` keyed toolview. The candidate source needs `ctx.remote.skills`,
 * `ctx.sessions` and `ctx.inputTriggers`, none of which exist in a Native
 * runtime; the toolview only needs the per-call tool slice, which a Native
 * host already holds in its Session events. So this entrypoint carries the
 * toolview alone, and it stays a pure function of the durable call.
 *
 * Everything below the data source is shared with the Cordis renderer: the
 * same card, the same disclosure, the same copy.
 */
import type { TranslateNS } from '@redspark/rsh-client-ui-slots'
import type { ReactElement } from 'react'
import { en as commonEn, formatLocaleTemplate, zh as commonZh } from '@redspark/rsh-client-locale/dictionary'
import { SkillRow } from './client/SkillRow.tsx'
import { en, NS, zh, type SkillKey } from './client/locales.ts'
import type { ToolCallViewProps } from '@redspark/rsh-client-ui-tool/client'

export { NS, en, zh, type SkillKey } from './client/locales.ts'
export type { ToolCallBlock, ToolResultNode, RunningToolCall } from '@redspark/rsh-client-ui-tool/native'

/** Props of the Cordis-free skill tool row: the tool slice arrives from the caller. */
export interface NativeSkillRowProps {
  /** Frozen running call or settled result node, as logged by the Host. */
  readonly block: ToolCallViewProps['block']
  /** Locale for the row's copy, so no locale service is required. */
  readonly locale: 'en' | 'zh'
  /** Inspect this call in the trajectory view when the caller has one. */
  readonly inspect?: (() => void) | undefined
}

/**
 * Compose the `skill` namespace translator from the shipped dictionaries.
 * @param locale - active language.
 * @returns a translator with the same fallback ladder as the locale service.
 */
function translate(locale: 'en' | 'zh'): TranslateNS<typeof NS> {
  const dictionary: Record<string, string> = locale === 'zh' ? { ...commonZh, ...zh } : { ...commonEn, ...en }
  return (key, params) => formatLocaleTemplate(dictionary[key as SkillKey] ?? key, params)
}

/**
 * `SkillRow` declares the full keyed-toolview props share, but it reads only
 * three of those members. Narrowing here keeps this entrypoint free of the
 * slot runtime's call-owner currency (`callId`, `toolName`, `openFile`,
 * `loadImage`) that a Native host has no way to supply.
 */
type SkillRowComponent = (props: {
  block: ToolCallViewProps['block']
  inspect?: (() => void) | undefined
  t: TranslateNS<typeof NS>
}) => ReactElement

const Row = SkillRow as unknown as SkillRowComponent

/**
 * Render one `skill` tool call as an accent summary and instructions disclosure.
 * @param props - the durable call slice, an explicit locale, and an optional inspect action.
 * @returns the dedicated skill row.
 */
export function NativeSkillRow({ block, locale, inspect }: NativeSkillRowProps): ReactElement {
  const t = translate(locale)
  return <Row block={block} t={t} {...inspect === undefined ? {} : { inspect }} />
}
