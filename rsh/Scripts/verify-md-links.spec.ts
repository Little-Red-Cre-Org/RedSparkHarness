/**
 * Acceptance-path coverage for fragment validation in `verify-md-links`: a
 * `#fragment` onto a Markdown target — same-file anchors included — must name
 * a real heading slug or explicit `<a id>`, while non-Markdown fragments and
 * external targets stay out of scope.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { anchorCache, documentAnchors, findViolations, githubSlug, MARKDOWN_LINK_PATTERNS } from './verify-md-links.ts'
import { uniqueRepoFiles } from './repo-files.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function layout(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'md-links-'))
  roots.push(root)
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), content)
  }
  return root
}

function violationsIn(root: string, rel: string): { url: string; reason: string }[] {
  return findViolations(join(root, rel), anchorCache(), root).map(({ url, reason }) => ({ url, reason }))
}

describe('documentAnchors', () => {
  it('checks broken links in deeply nested workspace documentation', () => {
    const paths = [
      'rsh/Modules/Official/shell/example/README.md',
      'rsh/Modules/Community/experimental/example/README.md',
      'rsh/Programs/Web/application/README.md',
      'rsh/Core/native/system/docs/cli-contract.md',
    ]
    const root = layout(Object.fromEntries(paths.map(path => [path, '[missing](absent.md)\n'])))
    const files = uniqueRepoFiles(root, MARKDOWN_LINK_PATTERNS)
    const violations = files.flatMap(file => findViolations(file.abs, anchorCache(), root))
    expect(violations.map(entry => entry.file.replaceAll('\\', '/')).sort()).toEqual([...paths].sort())
    expect(violations.every(entry => entry.reason === 'target')).toBe(true)
  })

  it('slugs rendered heading text, suffixes repeats, and reads explicit <a id> anchors', () => {
    const anchors = documentAnchors([
      '# My Doc',
      '## Live `events` — mode!',
      '## Repeat',
      '## Repeat',
      '<a id="hand-anchor"></a>',
      '',
    ].join('\n'))
    expect(anchors).toEqual(new Set(['my-doc', 'live-events--mode', 'repeat', 'repeat-1', 'hand-anchor']))
    expect(githubSlug('Security and authority are non-goals')).toBe('security-and-authority-are-non-goals')
  })

  it('keeps underscores the way GitHub does', () => {
    expect(githubSlug('Showcase: web_fetch')).toBe('showcase-web_fetch')
    expect(documentAnchors('## Showcase: web_fetch\n')).toEqual(new Set(['showcase-web_fetch']))
  })

  it('slugs a heading containing a link from its rendered text', () => {
    expect(documentAnchors('## [Install](setup.md)\n')).toEqual(new Set(['install']))
  })

  it('bumps repeat suffixes past occupied slugs, matching GitHub', () => {
    const anchors = documentAnchors(['## Repeat', '## Repeat-1', '## Repeat', ''].join('\n'))
    expect(anchors).toEqual(new Set(['repeat', 'repeat-1', 'repeat-2']))
  })

  it('ignores <a id> inside code fences, inline code, and HTML comments', () => {
    const anchors = documentAnchors([
      '# Doc',
      '```md',
      '<a id="fenced"></a>',
      '```',
      'Inline `<a id="inline"></a>` sample.',
      '<!-- <a id="commented"></a> -->',
      '<a id="real"></a>',
      '',
    ].join('\n'))
    expect(anchors).toEqual(new Set(['doc', 'real']))
  })
})

describe('findViolations fragments', () => {
  it('accepts resolving same-file and cross-file fragments, non-md fragments, and externals', () => {
    const root = layout({
      'a.md': '# A\n\n## Deferred work\n\n[self](#deferred-work) [b](b.md#part-two) [code](x.ts#L10) [ext](https://x.example/#frag)\n',
      'b.md': '# B\n\n## Part two\n',
      'x.ts': 'export {}\n',
    })
    expect(violationsIn(root, 'a.md')).toEqual([])
  })

  it('rejects a same-file fragment that names no heading or <a id>', () => {
    const root = layout({ 'a.md': '# A\n\n[gone](#deferred-work)\n' })
    expect(violationsIn(root, 'a.md')).toEqual([{ url: '#deferred-work', reason: 'anchor' }])
  })

  it('rejects a case-variant fragment: element ids are case-sensitive', () => {
    const root = layout({ 'a.md': '# A\n\n## Default Loop\n\n[case](#Default-Loop)\n' })
    expect(violationsIn(root, 'a.md')).toEqual([{ url: '#Default-Loop', reason: 'anchor' }])
  })

  it('rejects a cross-file fragment missing from the target document', () => {
    const root = layout({
      'a.md': '# A\n\n[stale](b.md#old-heading)\n',
      'b.md': '# B\n\n## New heading\n',
    })
    expect(violationsIn(root, 'a.md')).toEqual([{ url: 'b.md#old-heading', reason: 'anchor' }])
  })

  it('still rejects a missing target file, reported as target not anchor', () => {
    const root = layout({ 'a.md': '# A\n\n[ghost](missing.md#anything)\n' })
    expect(violationsIn(root, 'a.md')).toEqual([{ url: 'missing.md#anything', reason: 'target' }])
  })
})
