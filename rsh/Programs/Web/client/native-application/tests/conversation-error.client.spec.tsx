// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { NativeSessionClient } from '@deepseek-ai/dsh-client-native-session/native'
import { ConversationError } from '../src/conversation-error.tsx'
import { NativeConversationController } from '../src/controller.ts'
import { en } from '../src/locales.ts'

afterEach(cleanup)

const t = ((key: keyof typeof en) => en[key]) as Parameters<typeof ConversationError>[0]['t']

it.each([
  ['llm-deepseek: no API key for provider route "deepseek"; set DEEPSEEK_API_KEY', en.modelSetupMissingCredential, true],
  ['native-model-execution: model error: 401 Authentication Fails', en.modelSetupAuth, true],
  ['native conversation: turn exited with code 1', en.error, false],
])('shows friendly copy for %s and keeps the raw detail', (error, message, offersSettings) => {
  const open = vi.fn()
  render(<ConversationError error={error} t={t} onOpenModelSettings={open} />)
  expect(screen.getByRole('alert').querySelector('p')?.textContent).toBe(message)
  expect(screen.getByText(error)).toBeTruthy()
  const button = screen.queryByRole('button', { name: en.openModelSettings })
  expect(button !== null).toBe(offersSettings)
  if (button !== null) fireEvent.click(button)
  expect(open).toHaveBeenCalledTimes(offersSettings ? 1 : 0)
})

it('keeps one draft per Session and sends attached images without text', async () => {
  const id = 'session-1' as SessionId
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
    async history() { return { header: { id }, events: [], inheritedEventCount: 0 } },
    async submissions() { return { throughSeq: -1, submissions: [] } },
    promptContent,
  } as unknown as NativeSessionClient
  const controller = new NativeConversationController(client, { maxLiveTextChars: 100, maxLiveEvents: 100 })
  const file = new File(['png'], 'shot.png', { type: 'image/png' })
  controller.keepDraft(id, { text: 'unsent', files: [file] })
  expect(controller.takeDraft(id)).toEqual({ text: 'unsent', files: [file] })
  expect(controller.takeDraft(id)).toBeUndefined()
  controller.keepDraft(id, { text: '', files: [] })
  expect(controller.takeDraft(id)).toBeUndefined()

  await controller.load()
  await controller.select(id)
  await controller.send('', [file])
  expect(controller.getSnapshot().error).toBeUndefined()
  expect(promptContent.mock.calls[0]?.slice(0, 3)).toEqual([id,
    [{ type: 'image', mediaType: 'image/png', data: btoa('png'), name: 'shot.png' }], true])
  expect(() => controller.send('  ')).toThrow('enter text or attach an image')
  await controller.close()
})
