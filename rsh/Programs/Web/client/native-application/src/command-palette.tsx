/**
 * Slash-command palette for the Native composer.
 *
 * The Host already advertises a command catalog and executes a complete line;
 * what was missing was a surface to reach it. This renders that surface over
 * the composer's textarea and hands the pick to `executeCommand`.
 *
 * Three decisions worth stating, because each one is a way this could have
 * been wrong:
 *
 * * The menu shows **bare names** but submits a **slashed line**. The Host's
 *   `executeCommand` takes a complete line, so `command-completion.ts` adds the
 *   slash back at the boundary instead of showing it twice.
 * * The catalog is fetched **once per Session and cached**, then filtered
 *   locally. It is a small, stable list; re-fetching per keystroke would turn
 *   typing into a round trip per character.
 * * A failed fetch is **not** an error banner. The composer still works for
 *   ordinary text, so a catalog failure closes the menu and leaves a console
 *   record rather than blocking the user's message.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Menu, slashTokenAt } from '@redspark/rsh-client-ui-primitives'
import css from './command-palette.module.css'
import type { CommandChoice } from './command-completion.ts'
import {
  commandKeyAction, commandLine, filterCommands, moveHighlight,
} from './command-completion.ts'

/** One row as the Host advertises it. */
export interface CommandCatalogRow {
  readonly name: string
  readonly description: string
  readonly input?: { readonly hint: string } | undefined
}

/** The Host face this palette needs; a subset of `NativeSessionClient`. */
export interface CommandCatalogFace {
  /** List slash commands available to one Session's owner. */
  commands(sessionId: string, signal?: AbortSignal): Promise<readonly CommandCatalogRow[]>
  /** Execute one complete slash command line on an idle Session owner. */
  executeCommand(sessionId: string, line: string, signal?: AbortSignal): Promise<unknown>
}

/** What the composer drives. */
export interface CommandPaletteState {
  /** Open command rows after filtering; empty while the menu is closed. */
  readonly rows: readonly CommandChoice[]
  /** Whether the menu should render. */
  readonly open: boolean
  /** Highlighted row index, or -1 for none. */
  readonly selected: number
  /**
   * Inspect a draft change and update the menu.
   * @param draft - the composer text after the change.
   * @param caret - caret offset from the textarea.
   */
  observe(draft: string, caret: number): void
  /**
   * Handle a keydown before the composer's own shortcuts run.
   * @param event - the textarea keydown.
   * @returns true when the palette consumed the key.
   */
  keydown(event: KeyboardEvent<HTMLTextAreaElement>): boolean
  /**
   * Execute one chosen row (the pointer path, shared with the keyboard path).
   * @param choice - the row this user picked.
   */
  pick(choice: CommandChoice): void
  /** Close the menu without touching the draft. */
  close(): void
}

/** Read the admitted command rows out of one Host response. */
export function toChoices(rows: readonly CommandCatalogRow[]): readonly CommandChoice[] {
  return rows
    // A definition without a name is not addressable; the Host should not send
    // one, and rendering a nameless row would submit an unusable line.
    .filter(row => row.name.trim().length > 0)
    .map(row => ({ name: row.name, description: row.description, hint: row.input?.hint }))
}

/**
 * Drive one Session's command palette.
 *
 * @param client - Host command face.
 * @param sessionId - selected Session, or undefined when none is open.
 * @returns the state the composer reads and the handle it drives.
 */
export function useCommandPalette(
  client: CommandCatalogFace,
  sessionId: string | undefined,
): CommandPaletteState {
  const [catalog, setCatalog] = useState<readonly CommandChoice[]>([])
  const [query, setQuery] = useState<string | null>(null)
  const [highlight, setHighlight] = useState(-1)
  const fetching = useRef<AbortController | null>(null)
  const loadedFor = useRef<string | undefined>(undefined)

  // Drop the cached catalog when the Session changes: the advertised set is
  // per-owner, and a stale list would offer a command this Session cannot run.
  useEffect(() => {
    setCatalog([])
    setQuery(null)
    setHighlight(-1)
    loadedFor.current = undefined
  }, [sessionId])

  useEffect(() => () => { fetching.current?.abort() }, [])

  const open = query !== null
  const rows = useMemo(
    () => (query === null ? [] : filterCommands(catalog, query)),
    [catalog, query],
  )

  const load = useCallback(async (id: string): Promise<void> => {
    fetching.current?.abort()
    const controller = new AbortController()
    fetching.current = controller
    loadedFor.current = id
    try {
      const listed = await client.commands(id, controller.signal)
      if (controller.signal.aborted) return
      setCatalog(toChoices(listed))
    } catch (error) {
      if (!controller.signal.aborted) {
        // A missing catalog must not block ordinary typing.
        console.error('[native-application] command catalog unavailable:', error)
      }
    }
  }, [client])

  const observe = useCallback((draft: string, caret: number): void => {
    const token = slashTokenAt(draft, caret)
    if (token === null || sessionId === undefined) {
      setQuery(null)
      setHighlight(-1)
      return
    }
    setQuery(token.query)
    // Cache hit: filter locally. Cache miss: fetch once, then filter on arrival.
    if (loadedFor.current !== sessionId) void load(sessionId)
    setHighlight(current => (current < 0 ? 0 : current))
  }, [load, sessionId])

  const close = useCallback((): void => {
    setQuery(null)
    setHighlight(-1)
  }, [])

  const run = useCallback((choice: CommandChoice): void => {
    if (sessionId === undefined) return
    const line = commandLine(choice.name)
    close()
    void client.executeCommand(sessionId, line).catch((error: unknown) => {
      console.error('[native-application] command execution failed:', error)
    })
  }, [client, close, sessionId])

  const keydown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    const action = commandKeyAction(
      event.key, open, rows.length, event.nativeEvent.isComposing,
    )
    if (action === 'pass') return false
    event.preventDefault()
    if (action === 'close') {
      close()
      return true
    }
    if (action === 'up' || action === 'down') {
      setHighlight(current => moveHighlight(current, action === 'up' ? -1 : 1, rows.length))
      return true
    }
    const choice = rows[highlight < 0 ? 0 : highlight] ?? rows[0]
    if (choice === undefined) {
      close()
      return true
    }
    run(choice)
    return true
  }, [close, highlight, open, rows, run])

  return { rows, open, selected: open ? highlight : -1, observe, keydown, pick: run, close }
}

/**
 * Props-only palette body, usable from a test without the hook or a Host.
 *
 * `Menu` normally positions itself by wrapping an `anchor` NODE, which only
 * works when the trigger is a React child of the menu. A composer textarea is
 * not — it is the editor itself. So this uses the portal path with
 * `getAnchorRect`, which is the supported way to place the list against an
 * element the Menu does not own; the empty anchor span below is required by the
 * signature and is never laid out.
 *
 * @param props - rows, highlight, the editor to sit under, and callbacks.
 * @returns the menu, or null when there is nothing to show.
 */
export function CommandPaletteMenu(props: {
  readonly rows: readonly CommandChoice[]
  readonly selected: number
  readonly editor: HTMLElement | null
  readonly onSelect: (name: string) => void
  readonly onClose: () => void
}): ReactNode {
  if (props.rows.length === 0) return null
  const at = props.selected < 0 ? 0 : props.selected
  const anchorRect = (): DOMRect | null =>
    props.editor === null ? null : props.editor.getBoundingClientRect()
  return (
    <Menu
      open
      compact
      portal
      side="top"
      anchor={<span aria-hidden />}
      getAnchorRect={anchorRect}
      className={css.commandPalette}
      items={props.rows.map(row => ({
        id: row.name,
        label: (
          <span className={css.commandRow}>
            <span className={css.commandName}>{`/${row.name}`}</span>
            <span className={css.commandDescription}>{row.description}</span>
            {row.hint === undefined ? null : <span className={css.commandHint}>{row.hint}</span>}
          </span>
        ),
      }))}
      selectedId={props.rows[at]?.name}
      onSelect={props.onSelect}
      onClose={props.onClose}
    />
  )
}
