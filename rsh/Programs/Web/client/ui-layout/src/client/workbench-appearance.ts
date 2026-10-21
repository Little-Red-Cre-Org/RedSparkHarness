/** Project Code OSS theme colors onto its retained RSH conversation frame. */

const tokens = [
  ['--dsw-alias-bg-base', '--dsw-alias-bg-layer-1'],
  ['--dsw-alias-label-primary'],
  ['--dsw-alias-label-secondary', '--dsw-alias-label-tertiary', '--dsw-alias-label-caption'],
  ['--dsw-alias-brand-primary', '--dsw-alias-brand-text', '--dsw-alias-button-primary-fill', '--dsw-alias-label-primary-bluish'],
  ['--dsw-alias-bg-module-platform', '--dsw-alias-state-business-tertiary'],
  ['--dsw-alias-border-l3', '--dsw-alias-border-l4'],
] as const

/**
 * Subscribe only to the Desktop-minted parent channel; leave saved RSH preferences unchanged.
 * @param frame - Embedded AppFrame owning these transient color overrides.
 * @returns disposer removing the message listener and its DOM writes.
 */
export function connectWorkbenchAppearance(frame: HTMLElement): () => void {
  const channel = new URLSearchParams(location.search).get('channel')
  if (location.protocol !== 'dsh-app:' || !location.hostname.startsWith('ide-') || channel === null) return () => {}
  const receive = (event: MessageEvent<unknown>): void => {
    const data = event.data
    if (event.source !== parent || typeof data !== 'object' || data === null
      || !('channel' in data) || data.channel !== channel || !('type' in data) || data.type !== 'appearance'
      || !('dark' in data) || typeof data.dark !== 'boolean' || !('colors' in data) || !Array.isArray(data.colors)
      || data.colors.length !== tokens.length) return
    const colors: unknown[] = data.colors
    if (!colors.every((color): color is string => typeof color === 'string' && CSS.supports('color', color))) return
    // The wire checks above establish one color for every token group.
    tokens.forEach((names, index) => { for (const name of names) frame.style.setProperty(name, colors[index] as string) })
    frame.style.colorScheme = data.dark ? 'dark' : 'light'
  }
  window.addEventListener('message', receive)
  parent.postMessage({ type: 'appearance-ready', channel }, '*')
  return () => {
    window.removeEventListener('message', receive)
    for (const names of tokens) for (const name of names) frame.style.removeProperty(name)
    frame.style.removeProperty('color-scheme')
  }
}
