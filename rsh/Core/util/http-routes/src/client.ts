/** Browser-safe index inputs used by the Web and Desktop page assemblers. */

/** Document region a rendered row lands in, after its opening tag. */
export type IndexInjectionPlacement = 'head' | 'body'

/**
 * One structured index input. Rows stay JSON-serializable because both the
 * served Web page and page-side worker renderer consume the same table.
 */
export type IndexInjection =
  /** Assign a JSON-serializable value to a global property. */
  | { kind: 'global'; name: string; value: unknown }
  /** Inline classic script in the selected document region. */
  | { kind: 'script'; placement: IndexInjectionPlacement; text: string }
  /** External classic script in the selected document region. */
  | { kind: 'script-src'; placement: IndexInjectionPlacement; src: string }
  /** Advisory preload for an external classic script. */
  | { kind: 'script-preload'; src: string }
  /** Inline style element in the head. */
  | { kind: 'style'; text: string }
  /** Explicit trusted-host markup contribution. */
  | { kind: 'html'; placement: IndexInjectionPlacement; html: string }

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function assertNever(row: never): never {
  throw new Error(`http routes: unknown index injection row ${JSON.stringify(row)}`)
}

function renderRow(row: IndexInjection): { placement: IndexInjectionPlacement; markup: string } {
  switch (row.kind) {
    case 'global': {
      const name = JSON.stringify(row.name).replaceAll('<', '\\u003c')
      const value = row.value === undefined ? 'undefined' : JSON.stringify(row.value).replaceAll('<', '\\u003c')
      return { placement: 'head', markup: `<script>globalThis[${name}] = ${value}</script>` }
    }
    case 'script': return { placement: row.placement, markup: `<script>${row.text}</script>` }
    case 'script-src': return { placement: row.placement, markup: `<script src="${escapeHtmlAttribute(row.src)}"></script>` }
    case 'script-preload': return { placement: 'head', markup: `<link rel="preload" as="script" href="${escapeHtmlAttribute(row.src)}">` }
    case 'style': return { placement: 'head', markup: `<style>${row.text}</style>` }
    case 'html': return { placement: row.placement, markup: row.html }
    default: return assertNever(row)
  }
}

function splice(html: string, at: number, markup: string): string {
  return `${html.slice(0, at)}${markup}${html.slice(at)}`
}

const READY_MARKUP = '<script>(globalThis.__DSH_BOOT_READY__ ??= Promise.withResolvers()).resolve()</script>'

/** Render page inputs with the same deterministic order in Web and Desktop.
 * @param html - source index document.
 * @param rows - structured injections in owner activation order.
 * @returns the document with rendered injections and the readiness marker.
 */
export function renderIndexInjections(html: string, rows: readonly IndexInjection[]): string {
  let head = ''
  let body = ''
  for (const row of rows) {
    const rendered = renderRow(row)
    if (rendered.placement === 'head') head += rendered.markup
    else body += rendered.markup
  }
  body += READY_MARKUP
  let out = html
  if (head !== '') {
    const open = /<head(?:\s[^>]*)?>/i.exec(out)
    out = open === null ? `${head}${out}` : splice(out, open.index + open[0].length, head)
  }
  if (body !== '') {
    const open = /<body(?:\s[^>]*)?>/i.exec(out)
    out = open === null ? `${out}${body}` : splice(out, open.index + open[0].length, body)
  }
  return out
}
