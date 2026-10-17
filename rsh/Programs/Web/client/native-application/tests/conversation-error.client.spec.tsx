// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { NativeSessionClient } from '@deepseek-ai/dsh-client-native-session/native'
import { ConversationError } from '../src/conversation-error.tsx'
import { NativeConversationController } from '../src/controller.ts'
import { en } from '../src/locales.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const t = ((key: keyof typeof en) => en[key]) as Parameters<typeof ConversationError>[0]['t']

it.each([
  ['llm-deepseek: no API key for provider route "deepseek"; set DEEPSEEK_API_KEY', en.error, en.modelSetupMissingCredential, true],
  ['llm-pi-ai: the API key resolved from DEEPSEEK_API_KEY is blank; set DEEPSEEK_API_KEY to the raw key', en.error, en.modelSetupMissingCredential, true],
  ['native-model-execution: model error: 401 Authentication Fails', en.modelSetupAuth, en.modelSetupCredentialGuidance, true],
  ['transport failure for /api/session/start: HTTP 401', en.error, undefined, false],
  ['native Session list follow: invalid response HTTP 403', en.error, undefined, false],
  ['native conversation: live history sequence gap; expected 401, received 402 (user/message)', en.error, undefined, false],
  ['native conversation: turn exited with code 1', en.error, undefined, false],
])('shows friendly copy for %s and keeps the raw detail collapsed', (error, title, guidance, offersSettings) => {
  const open = vi.fn()
  render(<ConversationError error={error} t={t} onOpenModelSettings={open} />)
  expect(screen.getByRole('alert').querySelector('strong')?.textContent).toBe(title)
  expect(screen.getByRole('alert').querySelector('p')?.textContent).toBe(guidance)
  expect(screen.getByRole('alert').querySelector('details')?.hasAttribute('open')).toBe(false)
  expect(screen.getByText(error)).toBeTruthy()
  const button = screen.queryByRole('button', { name: en.openModelSettings })
  expect(button !== null).toBe(offersSettings)
  if (button !== null) fireEvent.click(button)
  expect(open).toHaveBeenCalledTimes(offersSettings ? 1 : 0)
})

it('keeps one draft per Session and sends attached images without text', async () => {
  const id = 'session-1' as SessionId
  const promptContent = vi.fn<NativeSessionClient['promptContent']>(async (
    _id, _content, _resume, _signal, _observe, _onFollowError, _lastSeq, _detach, onAccepted,
  ) => {
    onAccepted?.()
    return { exitCode: 0 }
  })
  const client = {
    async *follow() { yield { type: 'baseline' as const, items: [] } },
    async modelControls() {
      return { catalog: null, canSelectModel: false, presets: [], images: { mediaTypes: ['image/png'], maxImagesPerMessage: 1,
        maxImageBytes: 10, maxMessageImageBytes: 10, maxImagePixels: 100, maxImageDimension: 10 } }
    },
    async modeControls() { return { current: null, options: [], revision: null, locked: false, canSelect: false,
      planMode: { available: false, active: false } } },
    async permissionControls() { return { available: false, currentValue: null, options: [] } },
    async history() { return { header: { id }, events: [], inheritedEventCount: 0 } },
    async submissions() { return { throughSeq: -1, submissions: [] } },
    promptContent,
  } as unknown as NativeSessionClient
  const controller = new NativeConversationController(client, { maxLiveTextChars: 100, maxLiveEvents: 100 })
  const file = new File(['png'], 'shot.png', { type: 'image/png' })
  controller.keepDraft(id, { text: 'unsent', files: [file] })
  expect(controller.takeDraft(id)).toEqual({ text: 'unsent', files: [file] })
  expect(controller.takeDraft(id)).toBeUndefined()
  controller.keepDraft(id, { text: 'archived draft', files: [file] })
  controller.discardDraft(id)
  controller.keepDraft(id, { text: 'late outgoing save', files: [file] })
  expect(controller.takeDraft(id)).toBeUndefined()
  controller.keepDraft(id, { text: '', files: [] })
  expect(controller.takeDraft(id)).toBeUndefined()

  await controller.load()
  await controller.select(id)
  await expect(controller.send('', [file])).resolves.toBe(true)
  expect(controller.getSnapshot().error).toBeUndefined()
  expect(promptContent.mock.calls[0]?.slice(0, 3)).toEqual([id,
    [{ type: 'image', mediaType: 'image/png', data: btoa('png'), name: 'shot.png' }], true])
  expect(() => controller.send('  ')).toThrow('enter text or attach an image')
  await controller.close()
})

it('reports an image read interrupted by Session switching so its draft stays with the original Session', async () => {
  const id = 'session-1' as SessionId
  const otherId = 'session-2' as SessionId
  const promptContent = vi.fn<NativeSessionClient['promptContent']>(async () => ({ exitCode: 0 }))
  const client = {
    async *follow() { yield { type: 'baseline' as const, items: [] } },
    async modelControls() {
      return { catalog: null, canSelectModel: false, presets: [], images: { mediaTypes: ['image/png'], maxImagesPerMessage: 1,
        maxImageBytes: 10, maxMessageImageBytes: 10, maxImagePixels: 100, maxImageDimension: 10 } }
    },
    async modeControls() { return { current: null, options: [], revision: null, locked: false, canSelect: false,
      planMode: { available: false, active: false } } },
    async permissionControls() { return { available: false, currentValue: null, options: [] } },
    async history(sessionId: SessionId) { return { header: { id: sessionId }, events: [], inheritedEventCount: 0 } },
    async submissions() { return { throughSeq: -1, submissions: [] } },
    promptContent,
  } as unknown as NativeSessionClient
  const controller = new NativeConversationController(client, { maxLiveTextChars: 100, maxLiveEvents: 100 })
  const file = new File(['png'], 'shot.png', { type: 'image/png' })
  class PendingFileReader extends FileReader {
    override readAsDataURL(_blob: Blob): void {}
    override abort(): void {}
  }
  try {
    await controller.load()
    await controller.select(id)
    vi.stubGlobal('FileReader', PendingFileReader)
    const promptsBefore = promptContent.mock.calls.length
    const sending = controller.send('', [file])
    const switching = controller.select(otherId)
    await expect(sending).resolves.toBe(false)
    await switching
    expect(promptContent).toHaveBeenCalledTimes(promptsBefore)
    controller.keepDraft(id, { text: '', files: [file] })
    await controller.select(id)
    expect(controller.takeDraft(id)).toEqual({ text: '', files: [file] })
  } finally {
    await controller.close()
  }
})

it('does not report admission when Session switching aborts a pending image prompt start', async () => {
  const id = 'session-1' as SessionId
  const otherId = 'session-2' as SessionId
  const promptStarted = Promise.withResolvers<undefined>()
  const promptContent = vi.fn<NativeSessionClient['promptContent']>(
    (_id, _content, _resume, _signal, _observe, _onFollowError, _lastSeq, detach) => {
      promptStarted.resolve(undefined)
      return new Promise<{ exitCode: number; answer?: string }>((_resolve, reject) => {
        detach?.addEventListener('abort', () => reject(new DOMException('The operation was aborted', 'AbortError')),
          { once: true })
      })
    })
  const client = {
    async *follow() { yield { type: 'baseline' as const, items: [] } },
    async modelControls() {
      return { catalog: null, canSelectModel: false, presets: [], images: { mediaTypes: ['image/png'], maxImagesPerMessage: 1,
        maxImageBytes: 10, maxMessageImageBytes: 10, maxImagePixels: 100, maxImageDimension: 10 } }
    },
    async modeControls() { return { current: null, options: [], revision: null, locked: false, canSelect: false,
      planMode: { available: false, active: false } } },
    async permissionControls() { return { available: false, currentValue: null, options: [] } },
    async history(sessionId: SessionId) { return { header: { id: sessionId }, events: [], inheritedEventCount: 0 } },
    async submissions() { return { throughSeq: -1, submissions: [] } },
    promptContent,
  } as unknown as NativeSessionClient
  const controller = new NativeConversationController(client, { maxLiveTextChars: 100, maxLiveEvents: 100 })
  const file = new File(['png'], 'shot.png', { type: 'image/png' })
  try {
    await controller.load()
    await controller.select(id)
    const sending = controller.send('', [file])
    await promptStarted.promise
    expect(promptContent.mock.calls[0]?.[1]).toMatchObject([{ type: 'image', mediaType: 'image/png', name: 'shot.png' }])
    const switching = controller.select(otherId)
    await expect(sending).resolves.toBe(false)
    await switching
  } finally {
    await controller.close()
  }
})
