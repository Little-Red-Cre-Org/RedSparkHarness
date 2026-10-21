/** Props-only rows for a lazily loaded Session workspace file tree. */
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { WorkspaceDirectoryEntry } from '@deepseek-ai/dsh-api-workspace-files/native-types'
import { FileTypeIcon, classifyFileType } from './FileTypeIcon.tsx'
import { IconFolderClose16, IconFolderOpen16 } from './icons/index.tsx'
import css from './WorkspaceFileTreeRows.module.css'

/** One directory's display state. */
export type WorkspaceFileTreeLevel =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly code?: string; readonly message: string }
  | { readonly kind: 'ready'; readonly entries: readonly WorkspaceDirectoryEntry[]; readonly truncated: boolean }

/** Localized labels required by {@link WorkspaceFileTreeRows}. */
export interface WorkspaceFileTreeLabels {
  readonly loading: string
  readonly empty: string
  readonly truncated: string
  readonly other: string
}

/** Props for the tree's Cordis-free row presentation. */
export interface WorkspaceFileTreeRowsProps {
  readonly root: string
  readonly expanded: readonly string[]
  readonly levels: Readonly<Record<string, WorkspaceFileTreeLevel | undefined>>
  readonly labels: WorkspaceFileTreeLabels
  readonly onToggle: (path: string) => void
  readonly onOpen: (path: string) => void
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function childPath(parent: string, name: string): string {
  return `${parent.replace(/[/\\]+$/u, '')}/${name}`
}

/**
 * Sort directories first and natural-sort names within each group.
 * @param entries - the listing in Host order.
 * @returns a sorted copy that preserves the input listing.
 */
export function orderWorkspaceFileEntries(entries: readonly WorkspaceDirectoryEntry[]): WorkspaceDirectoryEntry[] {
  return [...entries].sort((left, right) => {
    const group = Number(right.type === 'directory') - Number(left.type === 'directory')
    return group !== 0 ? group : byName.compare(left.name, right.name)
  })
}

function Entry({ parent, entry, props }: {
  readonly parent: string
  readonly entry: WorkspaceDirectoryEntry
  readonly props: WorkspaceFileTreeRowsProps
}): ReactNode {
  const path = childPath(parent, entry.name)
  if (entry.type === 'directory') {
    const expanded = props.expanded.includes(path)
    return <li className={css.item} data-files-entry="directory" data-files-path={path}>
      <button type="button" className={css.row} aria-expanded={expanded} onClick={() => { props.onToggle(path) }}>
        {expanded ? <IconFolderOpen16 className={css.icon} /> : <IconFolderClose16 className={css.icon} />}
        <span className={css.name}>{entry.name}</span>
      </button>
      {expanded && <ul className={css.level}><Level path={path} props={props} /></ul>}
    </li>
  }
  if (entry.type === 'file') {
    return <li className={css.item} data-files-entry="file" data-files-path={path}>
      <button type="button" className={css.row} onClick={() => { props.onOpen(path) }}>
        <FileTypeIcon kind={classifyFileType(entry.name)} size={16} className={css.fileIcon} />
        <span className={css.name}>{entry.name}</span>
      </button>
    </li>
  }
  return <li className={css.item} data-files-entry="other" data-files-path={path}>
    <span className={clsx(css.row, css.other)} aria-disabled="true" title={props.labels.other}>
      <span className={css.name}>{entry.name}</span>
    </span>
  </li>
}

function Level({ path, props }: { readonly path: string; readonly props: WorkspaceFileTreeRowsProps }): ReactNode {
  const level = props.levels[path]
  if (level === undefined || level.kind === 'loading') {
    return <li className={css.note} data-files-row="loading">{props.labels.loading}</li>
  }
  if (level.kind === 'failed') {
    return <li className={css.note} data-files-row="failed" data-files-code={level.code}>{level.message}</li>
  }
  const entries = orderWorkspaceFileEntries(level.entries)
  return <>
    {entries.length === 0 && <li className={css.note} data-files-row="empty">{props.labels.empty}</li>}
    {entries.map(entry => <Entry key={entry.name} parent={path} entry={entry} props={props} />)}
    {level.truncated && <li className={css.note} data-files-row="truncated">{props.labels.truncated}</li>}
  </>
}

/**
 * Render loaded directory rows; owners keep listing state and file actions.
 * @param props - path state, localized labels, and row actions.
 * @returns the tree rows for one directory.
 */
export function WorkspaceFileTreeRows(props: WorkspaceFileTreeRowsProps): ReactNode {
  return <ul className={css.level}><Level path={props.root} props={props} /></ul>
}
