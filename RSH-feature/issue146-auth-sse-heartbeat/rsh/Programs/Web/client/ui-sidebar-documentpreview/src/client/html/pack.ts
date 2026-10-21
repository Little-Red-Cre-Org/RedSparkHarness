/** Keep the legacy reader's byte result while sharing HTML dependency collection. */
import { packWorkspaceHtml } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HtmlBundle } from './bootstrap.ts'
import type { DocumentFileBytes } from '../rpc.ts'

/**
 * A read bound to the original document's session and directory, using ordinary file operations.
 * @param reference - HTML-decoded relative URL, including any query or fragment.
 * @param signal - cancellation of this packing operation.
 * @returns complete file bytes; permission and read failures reject.
 */
export type ReadHtmlRelative = (reference: string, signal: AbortSignal) => Promise<DocumentFileBytes>

/**
 * Collect the same bounded static dependencies through the legacy Host reader.
 * @param data - complete UTF-8 HTML bytes.
 * @param readRelative - reader bound to the source document's Session and directory.
 * @param signal - stops reads and prevents publication after cancellation.
 * @returns complete HTML and its finite static asset set.
 */
export function packHtml(
  data: Uint8Array<ArrayBuffer>,
  readRelative: ReadHtmlRelative,
  signal: AbortSignal,
): Promise<HtmlBundle> {
  return packWorkspaceHtml(data, async (reference, innerSignal) =>
    (await readRelative(reference, innerSignal)).data, signal)
}
