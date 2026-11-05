/** Application icon shared by the browser seat and the Native action row. */
import { useState } from 'react'
import type { OpenInAppKey } from './locales.ts'
import css from './OpenInAppAction.module.css'

/**
 * Label keys per catalog id: both halves render only ids they can name, so a
 * host catalog extension without a matching dictionary entry stays invisible
 * instead of showing a raw id.
 */
export const APP_LABEL_KEY: Record<string, OpenInAppKey | undefined> = {
  finder: 'app.finder',
  explorer: 'app.explorer',
  filemanager: 'app.filemanager',
  cursor: 'app.cursor',
  vscode: 'app.vscode',
  vscodeinsiders: 'app.vscodeinsiders',
  windsurf: 'app.windsurf',
  zed: 'app.zed',
  sublimetext: 'app.sublimetext',
  xcode: 'app.xcode',
  androidstudio: 'app.androidstudio',
  intellij: 'app.intellij',
  pycharm: 'app.pycharm',
  webstorm: 'app.webstorm',
  phpstorm: 'app.phpstorm',
  goland: 'app.goland',
  rider: 'app.rider',
  rustrover: 'app.rustrover',
  fork: 'app.fork',
  sourcetree: 'app.sourcetree',
  github: 'app.github',
  tower: 'app.tower',
  gitkraken: 'app.gitkraken',
  smartgit: 'app.smartgit',
  sublimemerge: 'app.sublimemerge',
  ghostty: 'app.ghostty',
  warp: 'app.warp',
  iterm: 'app.iterm',
  kitty: 'app.kitty',
  terminal: 'app.terminal',
  windowsterminal: 'app.windowsterminal',
  gitbash: 'app.gitbash',
  gnometerminal: 'app.gnometerminal',
  konsole: 'app.konsole',
}

/** The dimmed busy treatment appears only after this delay in flight. */
export const BUSY_DRESS_DELAY_MS = 250

/** App ids whose icon image already failed this page; a 404 icon is fetched once, not per menu open. */
const failedIcons = new Set<string>()

/**
 * One application's real bundle icon (host-served PNG) with an inline generic
 * app-square fallback while the host has none.
 * @param props - catalog id, host icon URL, and rendered size.
 * @returns the icon image or its fallback glyph.
 */
export function AppIcon({ id, url, size }: { id: string; url: string; size: number }): React.JSX.Element {
  const [failed, setFailed] = useState(failedIcons.has(id))
  if (failed) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        className={css.icon}
        aria-hidden
      >
        <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
      </svg>
    )
  }
  return (
    <img
      src={url}
      width={size}
      height={size}
      alt=""
      // A bundle icon is decoration on a button: dragging it out would start a
      // native drag of the image instead of the button's own behaviour.
      draggable={false}
      className={css.icon}
      onError={() => {
        failedIcons.add(id)
        setFailed(true)
      }}
    />
  )
}
