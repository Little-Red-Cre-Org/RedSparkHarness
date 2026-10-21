import { describe, expect, it } from 'vitest'
import { packageGroupTableErrors, readGroupTable } from './verify-package-groups.ts'

const BACKTICK = '`'

function row(group: string): string {
  return `| [${BACKTICK}${group}/${BACKTICK}](${group}/README.md) | Role of ${group} |`
}

function readme(groups: readonly string[]): string {
  return [
    '<a id="package-groups"></a>',
    '## Package groups',
    '',
    '| Group | Role |',
    '|---|---|',
    ...groups.map(row),
    '',
    '-----',
    '',
  ].join('\n')
}

const BOTH = {
  'packages/README.md': ['core', 'mcp'],
  'packages/README.zh.md': ['core', 'mcp'],
} as const

describe('package group table', () => {
  it('reads the anchored section only, ignoring tables outside it', () => {
    const source = `${row('noise')}\n\n${readme(['core', 'mcp'])}`

    expect(readGroupTable(source)).toEqual(['core', 'mcp'])
  })

  it('stops at the section rule so a later table is not read', () => {
    const source = `${readme(['core'])}\n${row('later')}\n`

    expect(readGroupTable(source)).toEqual(['core'])
  })

  it('accepts tables that match the directories exactly', () => {
    expect(packageGroupTableErrors(['core', 'mcp'], BOTH)).toEqual([])
  })

  it('reports a group directory that neither table registers', () => {
    expect(packageGroupTableErrors(['core', 'mcp', 'typert'], {
      'packages/README.md': ['core', 'mcp'],
      'packages/README.zh.md': ['core', 'mcp'],
    })).toEqual([
      'packages/README.md: `typert/` exists under packages/ but has no row in the group table — add it beside its siblings, per the rule above that table',
      'packages/README.zh.md: `typert/` exists under packages/ but has no row in the group table — add it beside its siblings, per the rule above that table',
    ])
  })

  it('reports a table row that no directory backs', () => {
    expect(packageGroupTableErrors(['core'], {
      'packages/README.md': ['core', 'mcp'],
      'packages/README.zh.md': ['core'],
    })).toEqual([
      'packages/README.md: the `mcp/` row has no packages/mcp/ directory — remove the stale row or restore the group',
    ])
  })

  it('reports a locale that registers fewer groups than the other', () => {
    expect(packageGroupTableErrors(['core', 'mcp'], {
      'packages/README.md': ['core', 'mcp'],
      'packages/README.zh.md': ['core'],
    })).toEqual([
      'packages/README.zh.md: `mcp/` exists under packages/ but has no row in the group table — add it beside its siblings, per the rule above that table',
    ])
  })

  it('reports a group listed twice in one table', () => {
    expect(packageGroupTableErrors(['core'], {
      'packages/README.md': ['core', 'core'],
      'packages/README.zh.md': ['core'],
    })).toEqual([
      'packages/README.md: the group table has 2 rows for 1 distinct groups — a group is listed twice',
    ])
  })

  it('rejects an empty scan instead of silently passing', () => {
    expect(packageGroupTableErrors([], BOTH)).toEqual([
      'no package group directories or group table rows found; the scan is empty or narrowed',
    ])
  })

  it('rejects a table whose section anchor was lost', () => {
    expect(packageGroupTableErrors(['core', 'mcp'], {
      'packages/README.md': [],
      'packages/README.zh.md': [],
    })).toEqual([
      'no package group directories or group table rows found; the scan is empty or narrowed',
    ])
  })
})
