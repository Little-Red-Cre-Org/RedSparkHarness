/** Regression coverage for package-group subsystem-page ownership. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { auditSubsystemPages } from './verify-subsystem-pages.ts'

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-subsystem-pages-'))
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true })
  })
  return root
}

function write(root: string, path: string, source: string): void {
  const absolute = join(root, path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, source)
}

describe('package-group subsystem pages', () => {
  it.each([
    'rsh/Core/storage',
    'rsh/Engine/session',
    'rsh/Modules/Official/sandbox',
    'rsh/Compatibility/DSH/bundle',
    'rsh/Programs/Web/client',
    'rsh/Programs/SDK/packages',
  ])('rejects an undocumented package group at %s', (group) => {
    const root = fixture()
    write(root, `${group}/fixture-package/package.json`, '{}\n')
    expect(auditSubsystemPages(root, {})).toEqual({
      groups: 1,
      linked: 0,
      exempt: 0,
      violations: [`${group}/README.md: package group has no group README declaring subsystem ownership`],
    })
  })

  it('accepts a direct page link and a justified no-page group', () => {
    const root = fixture()
    write(root, 'rsh/alpha/README.md', '[types](../../docs/subsystems/alpha.md#contract)\n')
    write(root, 'rsh/alpha/alpha/package.json', '{}\n')
    write(root, 'rsh/Docs/subsystems/alpha.md', '# Alpha\n')
    write(root, 'rsh/adapter/README.md', '# Adapter\n')

    expect(auditSubsystemPages(root, { adapter: 'Adapter over an existing subsystem.' })).toEqual({
      groups: 2,
      linked: 1,
      exempt: 1,
      violations: [],
    })
  })

  it('rejects a new group whose README never declares subsystem ownership', () => {
    const root = fixture()
    write(root, 'rsh/Engine/schedule/README.md', '# Schedule\n')
    write(root, 'rsh/Engine/schedule/tool-schedule/package.json', '{}\n')

    expect(auditSubsystemPages(root, {}).violations).toEqual([
      'rsh/Engine/schedule/README.md: no reader-visible direct rsh/Docs/subsystems/*.md link; add the owning page and link, or add a justified GROUPS_WITHOUT_SUBSYSTEM_PAGE entry',
    ])
  })

  it('does not treat the subsystem index or a Chinese counterpart as an owning page', () => {
    const root = fixture()
    write(
      root,
      'rsh/wrong/README.md',
      '[index](../../docs/subsystems/README.md) [Chinese](../../docs/subsystems/wrong.zh.md)\n',
    )
    write(root, 'rsh/Docs/subsystems/README.md', '# Subsystems\n')
    write(root, 'rsh/Docs/subsystems/wrong.zh.md', '# Wrong\n')

    expect(auditSubsystemPages(root, {}).violations).toEqual([
      'rsh/wrong/README.md: no reader-visible direct rsh/Docs/subsystems/*.md link; add the owning page and link, or add a justified GROUPS_WITHOUT_SUBSYSTEM_PAGE entry',
    ])
  })

  it('does not count links hidden in code, comments, or image syntax', () => {
    const root = fixture()
    write(
      root,
      'rsh/hidden/README.md',
      [
        '`[inline](../../docs/subsystems/hidden.md)`',
        '```md',
        '[fenced](../../docs/subsystems/hidden.md)',
        '```',
        '<!-- [comment](../../docs/subsystems/hidden.md) -->',
        '![image](../../docs/subsystems/hidden.md)',
        '',
      ].join('\n'),
    )
    write(root, 'rsh/Docs/subsystems/hidden.md', '# Hidden\n')

    expect(auditSubsystemPages(root, {}).violations).toEqual([
      'rsh/hidden/README.md: no reader-visible direct rsh/Docs/subsystems/*.md link; add the owning page and link, or add a justified GROUPS_WITHOUT_SUBSYSTEM_PAGE entry',
    ])
  })

  it('rejects a link that escapes the subsystem directory', () => {
    const root = fixture()
    write(root, 'rsh/escape/README.md', '[escape](../../docs/subsystems/../architecture.md)\n')
    write(root, 'rsh/Docs/architecture.md', '# Architecture\n')

    expect(auditSubsystemPages(root, {}).violations).toEqual([
      'rsh/escape/README.md: no reader-visible direct rsh/Docs/subsystems/*.md link; add the owning page and link, or add a justified GROUPS_WITHOUT_SUBSYSTEM_PAGE entry',
    ])
  })

  it('rejects missing group READMEs and missing linked pages', () => {
    const root = fixture()
    write(root, 'rsh/no-readme/pkg/package.json', '{}\n')
    write(root, 'rsh/broken/README.md', '[missing](../../docs/subsystems/missing.md)\n')

    expect(auditSubsystemPages(root, {}).violations).toEqual([
      'rsh/broken/README.md: linked subsystem page does not exist: rsh/Docs/subsystems/missing.md',
      'rsh/no-readme/README.md: package group has no group README declaring subsystem ownership',
    ])
  })

  it('rejects blank, orphaned, and stale exemptions', () => {
    const root = fixture()
    write(root, 'rsh/linked/README.md', '[types](../../docs/subsystems/linked.md)\n')
    write(root, 'rsh/Docs/subsystems/linked.md', '# Linked\n')
    write(root, 'rsh/blank/README.md', '# Blank\n')

    expect(auditSubsystemPages(root, {
      blank: ' ',
      linked: 'No page.',
      orphan: 'Removed group.',
    }).violations).toEqual([
      'exemption blank: missing justification for omitting a subsystem page',
      'exemption orphan: no matching package group; remove the stale entry',
      'rsh/linked/README.md: links a subsystem page but remains exempt; remove the stale exemption',
    ])
  })
})
