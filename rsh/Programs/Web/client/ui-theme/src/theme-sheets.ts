/** Shared ownership helper for the global Client palette stylesheets. */
import base from './styles/base.css?inline'
import cornerShape from './styles/corner-shape.css?inline'
import designPlatform from './styles/design-platform.css?inline'
import scrollbar from './styles/scrollbar.css?inline'
import gradientShadowText from './styles/gradient-shadow-text.css?inline'
import shiki from './styles/shiki.css?inline'
import redspark from './styles/redspark.css?inline'

const PLUGIN_ID = '@deepseek-ai/dsh-client-ui-theme'

const STYLES = [
  ['base.css', base],
  ['corner-shape.css', cornerShape],
  ['design-platform.css', designPlatform],
  ['scrollbar.css', scrollbar],
  ['gradient-shadow-text.css', gradientShadowText],
  ['shiki.css', shiki],
  ['redspark.css', redspark],
] as const

/** Install each global sheet once and return its exact DOM cleanup.
 * @returns A cleanup function that removes the style elements installed by this call.
 */
export function installThemeStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const tags = STYLES.map(([name, css]) => {
    const tag = document.createElement('style')
    tag.dataset.plugin = PLUGIN_ID
    tag.dataset.pluginCss = `${PLUGIN_ID}/${name}`
    tag.textContent = css
    document.head.appendChild(tag)
    return tag
  })
  return () => { for (const tag of tags) tag.remove() }
}
