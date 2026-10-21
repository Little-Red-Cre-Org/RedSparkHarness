/**
 * The file tree's body: the session's workspace root, listed one level at a time.
 *
 * Everything the tree keeps lives in its store, keyed by tab; everything it asks
 * for goes through its injected face. The component itself only decides what to
 * draw for each absolute path and what a click means: a directory toggles, a
 * file opens through the owner's `tabActions` for a `file:` viewer to claim, and
 * anything else is shown but refuses to open. The header row is the text
 * preview's: the root's path, directories greyed and the last segment in full
 * ink, then the one control at its end, reload, which drops every listed level
 * and asks again for the expanded ones.
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconRefreshOutline16, SidebarPathBar, WorkspaceFileTreeRows, orderWorkspaceFileEntries,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceFileTreeLevel } from '@deepseek-ai/dsh-client-ui-primitives'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import type { WorkspaceDirectoryEntry } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { FilesInjected } from './face.ts'
import type {} from './locales.ts'
import type { createFilesStore } from './store.ts'
import css from './FilesBody.module.css'

/** The body's composed props: the tab it draws, its store, its face, and its copy. */
export type FilesBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsStore<ReturnType<typeof createFilesStore>>
  & FilesInjected
  & PropsLocale<'sidebarFiles'>

/**
 * Order one level's entries for display: directories first, then everything
 * else, each group by name. The endpoint's order is a listing fact; this is the
 * reader's.
 * @param entries - the listing as the endpoint returned it.
 * @returns a new array, directories first, then by name within each group.
 */
export function orderEntries(entries: readonly WorkspaceDirectoryEntry[]): WorkspaceDirectoryEntry[] {
  return orderWorkspaceFileEntries(entries)
}

/**
 * Say why a directory could not be listed, in terms of the directory.
 * @param t - namespace-bound translate.
 * @param failure - the settled Remote failure.
 * @returns the line to show under the directory.
 */
export function failureLine(t: TranslateNS<'sidebarFiles'>, failure: RemoteFailure): string {
  switch (failure.code) {
    case 'workspace-file/not-found': return t('error.notFound')
    case 'workspace-file/outside-workspace': return t('error.outsideWorkspace')
    case 'workspace-file/not-directory': return t('error.notDirectory')
    // Carrier and unclassified host failures reach the reader as themselves:
    // this tree knows nothing useful to add to a transport-level message.
    default: return t('error.unavailable', { message: failure.message })
  }
}

/** The file tree's body: the workspace root and whatever the reader has opened under it. */
export function FilesBody({
  useTabInfo, sessionId, useSessions, useStore, actions, start, load, toggle, t,
}: FilesBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const { signal, actions: tabActions } = tab
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  const state = useStore(store => store.byTab[tab.id])
  useEffect(() => {
    // A bucket gone because the record aborted must not be re-seeded by a
    // component that has not unmounted yet.
    if (state !== undefined || cwd === undefined || signal.aborted) return
    start(tab.id, cwd, signal)
  }, [state, cwd, tab.id, signal, start])

  if (cwd === undefined) {
    return (
      <div className={css.status} data-files-state="no-workspace">
        <p className={css.statusLine}>{t('noWorkspace')}</p>
      </div>
    )
  }
  if (state === undefined) return null
  const levels: Record<string, WorkspaceFileTreeLevel> = Object.fromEntries(
    Object.entries(state.levels).map(([path, level]) => [path,
      level.kind === 'failed'
        ? { kind: 'failed', code: level.failure.code, message: failureLine(t, level.failure) }
        : level.kind === 'ready'
          ? { kind: 'ready', entries: level.level.entries, truncated: level.level.truncated }
          : { kind: 'loading' },
    ]),
  )
  // Reload drops every level and asks again for the expanded ones; a collapsed
  // level is fetched again the next time it opens.
  const reload = (): void => {
    actions.reset(tab.id)
    for (const path of state.expanded) load(tab.id, path, signal)
  }
  return (
    <div className={css.root} data-files-state="tree" data-files-root={state.root}>
      <SidebarPathBar path={state.root}>
        <button
          type="button"
          className={css.tool}
          aria-label={t('reload')}
          title={t('reload')}
          data-files-reload
          onClick={reload}
        >
          <IconRefreshOutline16 />
        </button>
      </SidebarPathBar>
      <div className={css.body}>
        <WorkspaceFileTreeRows
          root={state.root}
          expanded={state.expanded}
          levels={levels}
          labels={{ loading: t('loading'), empty: t('empty'), truncated: t('truncated'), other: t('entry.other') }}
          onToggle={(path) => { toggle(tab.id, path, state.levels[path] !== undefined, signal) }}
          onOpen={(path) => { tabActions.openResource(fileAddressFor(sessionId, state.root, path)) }}
        />
      </div>
    </div>
  )
}
