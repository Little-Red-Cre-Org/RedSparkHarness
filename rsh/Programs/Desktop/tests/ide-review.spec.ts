import { expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ showTextDocument: vi.fn() }))
vi.mock('vscode', () => ({
  window: { showTextDocument: api.showTextDocument, showWarningMessage: vi.fn(), showInformationMessage: vi.fn() },
  workspace: { asRelativePath: () => 'example.js' },
  ViewColumn: { One: 1 }, Range: class {},
}))
import { createCodeReview } from '../src/ide-review.ts'
import { workbenchMessages } from '../src/ide-locale.ts'

it.each(['partial-discard', 'all', 'conflict'] as const)('holds changes for review: %s', async mode => {
  const original = 'const a = 1;\r\n// keep\r\nconst b = 2;\r\n'
  const proposed = 'const a = 10;\r\n// keep\r\nconst b = 20;\r\n'
  let text = original
  const document = { version: 1, isClosed: false, uri: { toString: () => 'file:///example.js' }, languageId: 'javascript',
    getText: () => text, positionAt: (offset: number) => offset }
  const edit = vi.fn(async (callback: (builder: { replace(range: unknown, value: string): void }) => void) => {
    callback({ replace: (_, value) => { text = value; document.version++ } }); return true
  })
  const editor = { document, edit }
  api.showTextDocument.mockResolvedValue(editor)
  const post = vi.fn()
  const review = createCodeReview(() => editor as unknown as NonNullable<ReturnType<Parameters<typeof createCodeReview>[0]>>, post, workbenchMessages('zh'))
  review.select('session')
  review.prepare('session', 'request')
  expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'prepared-code', text: original }))
  expect(review.propose('session', [{ content: proposed }])).toBe(true)
  const state = post.mock.lastCall![0].review
  expect(state.blocks).toHaveLength(2)
  expect(text).toBe(original)
  expect(edit).not.toHaveBeenCalled()
  review.prepare('session', 'blocked')
  expect(post.mock.lastCall![0].error).toBeTruthy()
  if (mode === 'partial-discard') {
    expect(state.blocks.map((block: { before: string; after: string }) => ({ before: block.before.trim(), after: block.after.trim() }))).toMatchInlineSnapshot(`
      [
        {
          "after": "const a = 10;",
          "before": "const a = 1;",
        },
        {
          "after": "const b = 20;",
          "before": "const b = 2;",
        },
      ]
    `)

    await review.act(state.id, 'accept', 1)
    expect(text).toBe('const a = 1;\r\n// keep\r\nconst b = 20;\r\n')
    await review.act(state.id, 'discard')
    await review.act(state.id, 'all')
    expect(edit).toHaveBeenCalledTimes(1)
    expect(post.mock.lastCall![0].review).toBeNull()
  } else if (mode === 'all') {
    await review.act(state.id, 'accept', 0)
    await review.act(state.id, 'all')
    expect(text).toBe(proposed)
    expect(post.mock.lastCall![0].review).toBeNull()
  } else if (mode === 'conflict') {
    review.select('other')
    await review.act(state.id, 'all')
    review.select('session')
    await review.act('expired', 'all')
    expect(edit).not.toHaveBeenCalled()
    text = 'user edit'; document.version++
    await review.act(state.id, 'all')
    expect(text).toBe('user edit')
    expect(edit).not.toHaveBeenCalled()
    expect(post.mock.lastCall![0].review.error).toContain('代码已发生变化')

  }
})
