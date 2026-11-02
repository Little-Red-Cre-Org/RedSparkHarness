// @vitest-environment jsdom
/**
 * The `/` palette end to end: detection, catalog fetch, filtering, highlight,
 * and the exact line handed to the Host.
 *
 * The Host is a recording stand-in, so every assertion about "which endpoint
 * was called with what" is an assertion about this component's behaviour, not
 * about a mock's convenience.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import type { CommandCatalogFace, CommandCatalogRow } from '../src/command-palette.tsx'
import { CommandPaletteMenu, useCommandPalette } from '../src/command-palette.tsx'

// Rendered trees must not leak between cases: a second `editor` in the document
// makes every `getByLabelText` ambiguous and hides which case really failed.
afterEach(() => { cleanup() })

const CATALOG: readonly CommandCatalogRow[] = [
  { name: 'compact', description: 'Shrink the conversation', input: { hint: '[instructions]' } },
  { name: 'goal', description: 'Set a durable goal' },
  { name: 'model', description: 'Pick the model' },
]

/** Records every Host call and answers with a fixed catalog. */
function host(rows: readonly CommandCatalogRow[] = CATALOG) {
  const calls = { commands: [] as string[], execute: [] as string[] }
  const face: CommandCatalogFace = {
    commands: (sessionId) => {
      calls.commands.push(sessionId)
      return Promise.resolve(rows)
    },
    executeCommand: (sessionId, line) => {
      calls.execute.push(`${sessionId}|${line}`)
      return Promise.resolve(undefined)
    },
  }
  return { face, calls }
}

/** Harness that wires the hook to a textarea the way the composer does. */
function Harness({ client, sessionId }: { client: CommandCatalogFace; sessionId: string | undefined }) {
  const palette = useCommandPalette(client, sessionId)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const textRef = useRef('')
  return (
    <>
      <textarea
        ref={editorRef}
        aria-label="editor"
        onChange={(event) => {
          textRef.current = event.target.value
          palette.observe(event.target.value, event.target.value.length)
        }}
        onKeyDown={(event) => { palette.keydown(event) }}
      />
      {palette.open
        ? <CommandPaletteMenu rows={palette.rows} selected={palette.selected} editor={editorRef.current}
          onSelect={(name) => {
            const choice = palette.rows.find(row => row.name === name)
            if (choice !== undefined) palette.pick(choice)
          }}
          onClose={() => { palette.close() }} />
        : null}
      <span data-testid="highlight">{palette.selected}</span>
      <span data-testid="open">{String(palette.open)}</span>
    </>
  )
}

const settle = async (): Promise<void> => {
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

describe('command palette integration', () => {
  it('opens on a leading slash and lists the Host catalog', async () => {
    const { face } = host()
    render(<Harness client={face} sessionId="s1" />)
    const editor = screen.getByLabelText('editor')

    await act(async () => {
      fireEvent.change(editor, { target: { value: '/' } })
    })
    await settle()

    expect(screen.getByTestId('open').textContent).toBe('true')
    // Every advertised command is offered, with the leading slash restored.
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.getAllByRole('menuitem').length).toBe(3)
  })

  it('fetches the catalog once per Session, not per keystroke', async () => {
    const { face, calls } = host()
    render(<Harness client={face} sessionId="s1" />)
    const editor = screen.getByLabelText('editor')

    await act(async () => { fireEvent.change(editor, { target: { value: '/' } }) })
    await settle()
    await act(async () => { fireEvent.change(editor, { target: { value: '/c' } }) })
    await settle()
    await act(async () => { fireEvent.change(editor, { target: { value: '/co' } }) })
    await settle()

    expect(calls.commands).toEqual(['s1'])
  })

  it('filters locally as the query grows', async () => {
    const { face } = host()
    render(<Harness client={face} sessionId="s1" />)
    const editor = screen.getByLabelText('editor')

    await act(async () => { fireEvent.change(editor, { target: { value: '/' } }) })
    await settle()
    expect(screen.getAllByRole('menuitem').length).toBe(3)

    await act(async () => { fireEvent.change(editor, { target: { value: '/co' } }) })
    await settle()
    expect(screen.getAllByRole('menuitem').length).toBe(1)
  })

  it('does not open when the slash is not at the start of the draft', async () => {
    const { face, calls } = host()
    render(<Harness client={face} sessionId="s1" />)
    const editor = screen.getByLabelText('editor')

    await act(async () => { fireEvent.change(editor, { target: { value: 'see src/main' } }) })
    await settle()

    expect(screen.getByTestId('open').textContent).toBe('false')
    expect(calls.commands).toEqual([])
  })

  it('executes the exact slashed line the Host expects', async () => {
    const { face, calls } = host()
    render(<Harness client={face} sessionId="s1" />)
    const editor = screen.getByLabelText('editor')

    await act(async () => { fireEvent.change(editor, { target: { value: '/goal' } }) })
    await settle()
    await act(async () => {
      fireEvent.keyDown(editor, { key: 'Enter' })
    })
    await settle()

    expect(calls.execute).toEqual(['s1|/goal'])
    // The menu closes after a pick so the user sees the result, not the list.
    expect(screen.getByTestId('open').textContent).toBe('false')
  })

  it('walks the highlight with the arrows and wraps', async () => {
    const { face } = host()
    render(<Harness client={face} sessionId="s1" />)
    const editor = screen.getByLabelText('editor')

    await act(async () => { fireEvent.change(editor, { target: { value: '/' } }) })
    await settle()
    expect(screen.getByTestId('highlight').textContent).toBe('0')

    await act(async () => { fireEvent.keyDown(editor, { key: 'ArrowDown' }) })
    expect(screen.getByTestId('highlight').textContent).toBe('1')

    await act(async () => { fireEvent.keyDown(editor, { key: 'ArrowDown' }) })
    expect(screen.getByTestId('highlight').textContent).toBe('2')

    // Past the last row wraps to the first.
    await act(async () => { fireEvent.keyDown(editor, { key: 'ArrowDown' }) })
    expect(screen.getByTestId('highlight').textContent).toBe('0')
  })

  it('executes the highlighted row, not the first', async () => {
    const { face, calls } = host()
    render(<Harness client={face} sessionId="s1" />)
    const editor = screen.getByLabelText('editor')

    await act(async () => { fireEvent.change(editor, { target: { value: '/' } }) })
    await settle()
    await act(async () => { fireEvent.keyDown(editor, { key: 'ArrowDown' }) })
    await act(async () => { fireEvent.keyDown(editor, { key: 'Enter' }) })
    await settle()

    expect(calls.execute).toEqual(['s1|/goal'])
  })

  it('closes on Escape without executing anything', async () => {
    const { face, calls } = host()
    render(<Harness client={face} sessionId="s1" />)
    const editor = screen.getByLabelText('editor')

    await act(async () => { fireEvent.change(editor, { target: { value: '/goal' } }) })
    await settle()
    await act(async () => { fireEvent.keyDown(editor, { key: 'Escape' }) })
    await settle()

    expect(screen.getByTestId('open').textContent).toBe('false')
    expect(calls.execute).toEqual([])
  })

  it('does not fetch when no Session is selected', async () => {
    const { face, calls } = host()
    render(<Harness client={face} sessionId={undefined} />)
    const editor = screen.getByLabelText('editor')

    await act(async () => { fireEvent.change(editor, { target: { value: '/' } }) })
    await settle()

    expect(screen.getByTestId('open').textContent).toBe('false')
    expect(calls.commands).toEqual([])
  })

  it('keeps typing usable when the catalog fetch fails', async () => {
    const failing: CommandCatalogFace = {
      commands: () => Promise.reject(new Error('host unreachable')),
      executeCommand: () => Promise.resolve(undefined),
    }
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render(<Harness client={failing} sessionId="s1" />)
      const editor = screen.getByLabelText('editor')

      await act(async () => { fireEvent.change(editor, { target: { value: '/' } }) })
      await settle()

      // The failure is recorded, not surfaced as a blocking error.
      expect(logged).toHaveBeenCalled()
    } finally {
      logged.mockRestore()
    }
  })
})
