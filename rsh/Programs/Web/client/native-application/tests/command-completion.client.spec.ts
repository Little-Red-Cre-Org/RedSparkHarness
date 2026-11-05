/**
 * Pure slash-command completion decisions.
 *
 * These cover what can silently break the palette without breaking the build:
 * what it lists, where the highlight lands, and which key the composer may
 * steal. Token recognition itself is not decided here — `slashTokenAt` belongs to
 * `ui-primitives` and is covered by the shared-grammar spec that the Web
 * trigger pipeline and this palette both answer to.
 */
import { describe, expect, it } from 'vitest'
import type { CommandChoice } from '../src/command-completion.ts'
import {
  commandKeyAction, commandLine, filterCommands, moveHighlight,
} from '../src/command-completion.ts'

const choice = (name: string, description = `${name} does things`): CommandChoice => ({ name, description })

describe('filterCommands', () => {
  const catalog = [choice('compact'), choice('goal'), choice('model'), choice('context')]

  it('keeps Host order for an empty query', () => {
    expect(filterCommands(catalog, '').map(row => row.name)).toEqual(['compact', 'goal', 'model', 'context'])
  })

  it('keeps Host order when the query is only whitespace', () => {
    expect(filterCommands(catalog, '   ')).toBe(catalog)
  })

  it('matches a substring, not only a prefix', () => {
    expect(filterCommands(catalog, 'omp').map(row => row.name)).toEqual(['compact'])
  })

  it('matches case-insensitively', () => {
    expect(filterCommands(catalog, 'GOA').map(row => row.name)).toEqual(['goal'])
  })

  it('returns nothing when no name contains the query', () => {
    expect(filterCommands(catalog, 'zzz')).toEqual([])
  })
})

describe('moveHighlight', () => {
  it('selects the first row when walking down from nothing highlighted', () => {
    expect(moveHighlight(-1, 1, 3)).toBe(0)
  })

  it('selects the last row when walking up from nothing highlighted', () => {
    expect(moveHighlight(-1, -1, 3)).toBe(2)
  })

  it('wraps forward past the end', () => {
    expect(moveHighlight(2, 1, 3)).toBe(0)
  })

  it('wraps backward past the start', () => {
    expect(moveHighlight(0, -1, 3)).toBe(2)
  })

  it('reports no highlight for an empty list', () => {
    expect(moveHighlight(-1, 1, 0)).toBe(-1)
  })

  it('recovers a stale index past the end by starting over', () => {
    expect(moveHighlight(9, 1, 3)).toBe(0)
  })
})

describe('commandLine', () => {
  it('adds the leading slash the Host expects', () => {
    expect(commandLine('compact')).toBe('/compact')
  })

  it('does not double a slash the caller already supplied', () => {
    expect(commandLine('/compact')).toBe('/compact')
  })

  it('strips surrounding whitespace', () => {
    expect(commandLine('  goal  ')).toBe('/goal')
  })
})

describe('commandKeyAction', () => {
  it('passes every key while the menu is closed', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Tab']) {
      expect(commandKeyAction(key, false, 3)).toBe('pass')
    }
  })

  it('claims the arrows while the menu is open', () => {
    expect(commandKeyAction('ArrowUp', true, 3)).toBe('up')
    expect(commandKeyAction('ArrowDown', true, 3)).toBe('down')
  })

  it('accepts Enter only when a row exists', () => {
    expect(commandKeyAction('Enter', true, 2)).toBe('accept')
    // An open menu with no rows must not swallow the send key.
    expect(commandKeyAction('Enter', true, 0)).toBe('pass')
  })

  it('closes on Escape without submitting', () => {
    expect(commandKeyAction('Escape', true, 2)).toBe('close')
    expect(commandKeyAction('Escape', true, 0)).toBe('close')
  })

  it('passes everything during IME composition', () => {
    // A Japanese/Chinese candidate list uses Enter to accept a character;
    // treating that as a pick would execute the wrong command.
    expect(commandKeyAction('Enter', true, 3, true)).toBe('pass')
    expect(commandKeyAction('ArrowDown', true, 3, true)).toBe('pass')
  })

  it('passes unrelated keys', () => {
    expect(commandKeyAction('a', true, 3)).toBe('pass')
    expect(commandKeyAction('Backspace', true, 3)).toBe('pass')
  })
})
