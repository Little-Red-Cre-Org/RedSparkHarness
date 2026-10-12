/** Bounded HTML preview preparation for the legacy and Native workspace readers. */

/** One directly declared local script or stylesheet from an HTML document. */
export interface HtmlAsset {
  readonly kind: 'script' | 'stylesheet'
  readonly reference: string
  readonly data: Uint8Array<ArrayBuffer>
}

/** Complete HTML bytes and the finite local asset set admitted by the preview. */
export interface HtmlBundle {
  readonly data: Uint8Array<ArrayBuffer>
  readonly assets: readonly HtmlAsset[]
}

/** Relative file reader supplied by the owning Session API. */
export type ReadHtmlRelative = (reference: string, signal: AbortSignal) => Promise<Uint8Array<ArrayBuffer>>

const BASE64_CHUNK_BYTES = 0x8000
const MAX_ASSET_BYTES = 4 * 1024 * 1024
const MAX_TOTAL_BYTES = 32 * 1024 * 1024
const MAX_ASSETS = 64

function decodeText(data: Uint8Array<ArrayBuffer>): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(data)
}

function encodeText(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_BYTES)))
  }
  return btoa(chunks.join(''))
}

/**
 * Decode and validate a relative HTML dependency path before the Host resolves it.
 * @param reference - URL from a supported HTML script or stylesheet attribute.
 * @returns the decoded workspace-relative path with query and fragment removed.
 */
export function htmlRelativePath(reference: string): string {
  const suffix = reference.search(/[?#]/u)
  const path = decodeURIComponent(suffix === -1 ? reference : reference.slice(0, suffix))
  if (path.length === 0 || /^(?:[a-z][a-z\d+.-]*:|[/\\])/iu.test(path) || path.includes('\0') || path.includes('\\')) {
    throw new Error('HTML dependency must use a relative file path')
  }
  return path
}

/**
 * Pack directly declared classic scripts and stylesheets without granting the iframe file access.
 * @param data - complete UTF-8 HTML bytes.
 * @param readRelative - reader bound to the original HTML file's Session and directory.
 * @param signal - aborts the asset reads and prevents publication.
 * @returns the HTML source and bounded set of matching local assets.
 */
export async function packWorkspaceHtml(
  data: Uint8Array<ArrayBuffer>,
  readRelative: ReadHtmlRelative,
  signal: AbortSignal,
): Promise<HtmlBundle> {
  signal.throwIfAborted()
  let total = data.byteLength
  if (total > MAX_TOTAL_BYTES) throw new Error('HTML package exceeds its total byte limit')
  const template = document.createElement('template')
  template.innerHTML = decodeText(data)
  const assets: HtmlAsset[] = []
  if (template.content.querySelector('base[href]') !== null) return { data, assets }

  const seen = new Set<string>()
  for (const element of template.content.querySelectorAll('script[src],link[href]')) {
    const script = element.localName === 'script'
    const type = element.getAttribute('type')?.trim().toLowerCase() ?? ''
    if (script && !['', 'text/javascript', 'application/javascript'].includes(type)) continue
    if (!script && !(element.getAttribute('rel') ?? '').toLowerCase().split(/\s+/u).includes('stylesheet')) continue
    const reference = element.getAttribute(script ? 'src' : 'href') as string
    const suffix = reference.search(/[?#]/u)
    const path = suffix === -1 ? reference : reference.slice(0, suffix)
    if (!relativeHtmlReference(reference) || !(script ? /\.js$/iu : /\.css$/iu).test(path)) continue
    const kind = script ? 'script' : 'stylesheet'
    const key = `${kind}:${reference}`
    if (seen.has(key)) continue
    if (assets.length >= MAX_ASSETS) throw new Error('HTML package exceeds its asset count limit')
    signal.throwIfAborted()
    const asset = await readRelative(reference, signal)
    signal.throwIfAborted()
    if (asset.byteLength > MAX_ASSET_BYTES) throw new Error('HTML asset exceeds its byte limit')
    total += asset.byteLength
    if (total > MAX_TOTAL_BYTES) throw new Error('HTML package exceeds its total byte limit')
    decodeText(asset)
    assets.push({ kind, reference, data: asset })
    seen.add(key)
  }
  return { data, assets }
}

function relativeHtmlReference(reference: string): boolean {
  return reference.length > 0 && !/^(?:[a-z][a-z\d+.-]*:|[/\\#?])/iu.test(reference) && !reference.includes('\0')
}

/**
 * Build the bootstrap document for an opaque sandbox iframe.
 * @param bundle - complete HTML bytes and any admitted local assets.
 * @returns HTML that installs blob URLs in the isolated document before parsing it.
 */
export function createWorkspaceHtmlDocument(bundle: HtmlBundle): string {
  const payload = encodeText(JSON.stringify({
    html: decodeText(bundle.data),
    assets: bundle.assets.map(asset => ({ kind: asset.kind, reference: asset.reference, text: decodeText(asset.data) })),
  }))
  return `<!doctype html><meta charset="utf-8"><script>(()=>{
const bytes=data=>Uint8Array.from(atob(data),character=>character.charCodeAt(0));
const text=data=>new TextDecoder('utf-8',{fatal:true}).decode(bytes(data));
const bundle=JSON.parse(text("${payload}"));
let html=bundle.html;
if(bundle.assets.length){
  const parsed=new DOMParser().parseFromString(html,'text/html');
  for(const asset of bundle.assets){
    const script=asset.kind==='script';
    const url=URL.createObjectURL(new Blob([asset.text],{type:script?'application/javascript':'text/css'}));
    const attribute=script?'src':'href';
    for(const element of parsed.querySelectorAll(script?'script[src]':'link[rel~="stylesheet" i][href]')){
      if(element.getAttribute(attribute)===asset.reference)element.setAttribute(attribute,url);
    }
  }
  html='<!doctype html>'+parsed.documentElement.outerHTML;
}
document.open();document.write(html);document.close();
})()</script>`
}
