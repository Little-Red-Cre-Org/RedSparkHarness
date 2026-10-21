/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizationFrame } from '@deepseek-ai/dsh-api-remotes/client'
import { AuthorizationPanel } from '../src/client/AuthorizationPanel.tsx'
import { en } from '../src/client/locales.ts'

const t = (key: keyof typeof en): string => en[key]
afterEach(cleanup)

describe('Models authorization panel', () => {
  it('enables models for an already connected account without opening another login', async () => {
    const remote = {
      list: vi.fn().mockResolvedValue({ ok: true, value: [{ key: 'llm-pi-ai/openai-codex',
        label: 'OpenAI Codex', configured: true, writable: true, inFlight: false,
        methods: [{ id: 'oauth', label: 'Login' }] }] }),
      authorize: vi.fn(), answer: vi.fn(), decline: vi.fn(),
    }
    const onAuthorized = vi.fn().mockRejectedValueOnce(new Error('settings changed')).mockResolvedValue(undefined)
    render(<AuthorizationPanel remote={remote as never} t={t} onAuthorized={onAuthorized} />)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'settings changed')
    expect(onAuthorized).toHaveBeenCalledOnce()
    expect(screen.queryByText(en.authorizationModelsReady)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.authorizationRetryModels }))
    expect((await screen.findByText(en.authorizationModelsReady)).textContent).toMatchInlineSnapshot(
      '"Codex models are enabled. Choose an OpenAI Codex model in the conversation model picker, then send a message."',
    )
    expect(remote.authorize).not.toHaveBeenCalled()
    expect(onAuthorized).toHaveBeenLastCalledWith('llm-pi-ai/openai-codex', expect.any(AbortSignal))
    expect(screen.queryByRole('button', { name: en.authorizationRetryModels })).toBeNull()
  })

  it('keeps sign-in feedback beside the selected provider and preserves its URL during progress', async () => {
    let proceed!: () => void
    let finish!: () => void
    const ready = new Promise<void>((resolve) => { proceed = resolve })
    const finished = new Promise<void>((resolve) => { finish = resolve })
    async function* authorize(): AsyncIterable<AuthorizationFrame> {
      await ready
      yield { type: 'notice', notice: { message: 'Open browser', url: 'https://auth.example/' } }
      yield { type: 'notice', notice: { message: 'Waiting for callback' } }
      await finished
      yield { type: 'settled', status: 'cancelled' }
    }
    const remote = {
      list: vi.fn().mockResolvedValue({ ok: true, value: ['OpenAI Codex', 'Other provider'].map(label => ({
        key: label, label, methods: [{ id: 'oauth', label: `Login ${label}` }],
        inFlight: false, configured: false, writable: true,
      })) }),
      authorize, answer: vi.fn(), decline: vi.fn(),
    }
    render(<AuthorizationPanel remote={remote as never} t={t} onAuthorized={() => Promise.resolve()} />)
    await screen.findByRole('group', { name: 'OpenAI Codex' })
    const selected = within(screen.getByRole('group', { name: 'OpenAI Codex' }))
    fireEvent.click(selected.getByRole('button', { name: en.authorizationLoginAdd }))
    expect(selected.getByText(en.authorizationStarting)).toBeTruthy()
    proceed()
    expect(await selected.findByText('Waiting for callback')).toBeTruthy()
    expect(selected.getByRole('link').getAttribute('href')).toBe('https://auth.example/')
    expect(within(screen.getByRole('group', { name: 'Other provider' })).queryByRole('link')).toBeNull()
    finish()
    await waitFor(() => { expect(selected.queryByRole('link')).toBeNull() })
  })

  it('reports a rejected directory request instead of staying blank', async () => {
    const remote = { list: vi.fn().mockRejectedValue(new Error('Host disconnected')) }
    render(<AuthorizationPanel remote={remote as never} t={t} onAuthorized={() => Promise.resolve()} />)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Host disconnected')
  })

  it('renders a provider-neutral login conversation and sends prompt answers', async () => {
    const answer = vi.fn(() => Promise.resolve({ ok: true, value: undefined }))
    const list = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        value: [{
          key: 'llm-pi-ai/openai-codex',
          label: 'ChatGPT (Codex)',
          methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
          inFlight: false,
          configured: false,
          writable: true,
        }],
      })
      .mockResolvedValue({
        ok: true,
        value: [{
          key: 'llm-pi-ai/openai-codex',
          label: 'ChatGPT (Codex)',
          methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
          inFlight: false,
          configured: true,
          kind: 'grant',
          writable: true,
        }],
      })
    async function* authorize(): AsyncIterable<AuthorizationFrame> {
      yield { type: 'started', attemptId: 'attempt-1' as never }
      yield { type: 'notice', notice: { message: 'Continue in the browser', url: 'https://auth.example/' } }
      yield {
        type: 'prompt',
        attemptId: 'attempt-1' as never,
        promptId: 'prompt-1' as never,
        prompt: { kind: 'text', message: 'Paste the code' },
      }
      await new Promise<void>((resolve) => {
        answer.mockImplementationOnce(() => {
          resolve()
          return Promise.resolve({ ok: true, value: undefined })
        })
      })
      yield { type: 'settled', status: 'authorized' }
    }
    const onAuthorized = vi.fn(() => Promise.resolve())
    const remote = {
      list,
      authorize,
      answer,
      decline: vi.fn(),
    }
    render(<AuthorizationPanel remote={remote as never} t={t} onAuthorized={onAuthorized} />)

    fireEvent.click(await screen.findByRole('button', { name: en.authorizationLoginAdd }))
    expect(await screen.findByText('Continue in the browser')).toBeTruthy()
    expect(screen.getByRole('link', { name: en.authorizationOpenPage }).getAttribute('href')).toBe('https://auth.example/')
    fireEvent.change(await screen.findByLabelText('Paste the code'), { target: { value: 'code-123' } })
    fireEvent.click(screen.getByRole('button', { name: en.authorizationContinue }))

    await waitFor(() => {
      expect(answer).toHaveBeenCalledWith('attempt-1', 'prompt-1', 'code-123')
      expect(onAuthorized).toHaveBeenCalledExactlyOnceWith('llm-pi-ai/openai-codex', expect.any(AbortSignal))
      expect(screen.getByText(en.authorizationAdded)).toBeTruthy()
      expect(screen.getByText(en.authorizationModelsReady)).toBeTruthy()
    })
  })

  it('does not render a provider notice with a non-web URL as a link', async () => {
    async function* authorize(): AsyncIterable<AuthorizationFrame> {
      yield { type: 'started', attemptId: 'attempt-1' as never }
      yield { type: 'notice', notice: { message: 'Continue', url: 'javascript:alert(1)' } }
      yield { type: 'settled', status: 'cancelled' }
    }
    const remote = {
      list: vi.fn(() => Promise.resolve({
        ok: true,
        value: [{
          key: 'llm-pi-ai/openai-codex',
          label: 'ChatGPT (Codex)',
          methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
          inFlight: false,
          configured: false,
          writable: true,
        }],
      })),
      authorize,
      answer: vi.fn(),
      decline: vi.fn(),
    }
    const view = render(<AuthorizationPanel remote={remote as never} t={t} onAuthorized={() => Promise.resolve()} />)

    fireEvent.click(await screen.findByRole('button', { name: en.authorizationLoginAdd }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: en.authorizationLoginAdd })).toHaveProperty('disabled', false)
    })
    expect(view.container.querySelector('a')).toBeNull()
  })

  it('rejects notice URLs with embedded credentials', async () => {
    async function* authorize(): AsyncIterable<AuthorizationFrame> {
      yield { type: 'notice', notice: { message: 'Unsafe', url: 'https://user:password@auth.example/login' } }
      yield { type: 'settled', status: 'cancelled' }
    }
    const remote = {
      list: vi.fn().mockResolvedValue({ ok: true, value: [{
        key: 'llm-pi-ai/openai-codex', label: 'OpenAI Codex', configured: false, writable: true, inFlight: false,
        methods: [{ id: 'oauth', label: 'Login' }],
      }] }),
      authorize, answer: vi.fn(), decline: vi.fn(),
    }
    render(<AuthorizationPanel remote={remote as never} t={t} onAuthorized={() => Promise.resolve()} />)
    fireEvent.click(await screen.findByRole('button', { name: en.authorizationLoginAdd }))
    await screen.findByText('Unsafe')
    expect(screen.queryByRole('link', { name: en.authorizationOpenPage })).toBeNull()
  })

  it('renders the normalized form of a credential-free notice URL', async () => {
    async function* authorize(): AsyncIterable<AuthorizationFrame> {
      yield { type: 'notice', notice: { message: 'Safe', url: 'https://AUTH.example:443/login/../oauth' } }
      await new Promise(() => {})
    }
    const remote = {
      list: vi.fn().mockResolvedValue({ ok: true, value: [{
        key: 'llm-pi-ai/openai-codex', label: 'OpenAI Codex', configured: false, writable: true, inFlight: false,
        methods: [{ id: 'oauth', label: 'Login' }],
      }] }),
      authorize, answer: vi.fn(), decline: vi.fn(),
    }
    render(<AuthorizationPanel remote={remote as never} t={t} onAuthorized={() => Promise.resolve()} />)
    fireEvent.click(await screen.findByRole('button', { name: en.authorizationLoginAdd }))
    expect((await screen.findByRole('link', { name: en.authorizationOpenPage })).getAttribute('href'))
      .toBe('https://auth.example/oauth')
  })

  it('ignores a stale prompt answer failure after a new attempt starts', async () => {
    let rejectAnswer!: (error: Error) => void
    const answer = vi.fn(() => new Promise((_, reject) => { rejectAnswer = reject }))
    let attempt = 0
    async function* authorize(_key: string, _method: string, signal: AbortSignal): AsyncIterable<AuthorizationFrame> {
      attempt += 1
      const id = `attempt-${attempt}`
      yield { type: 'prompt', attemptId: id as never, promptId: `prompt-${attempt}` as never,
        prompt: { kind: 'text', message: `Code ${attempt}` } }
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
    }
    const remote = {
      list: vi.fn().mockResolvedValue({ ok: true, value: [{
        key: 'llm-pi-ai/openai-codex', label: 'OpenAI Codex', configured: false, writable: true, inFlight: false,
        methods: [{ id: 'oauth', label: 'Login' }],
      }] }),
      authorize, answer, decline: vi.fn(),
    }
    render(<AuthorizationPanel remote={remote as never} t={t} onAuthorized={() => Promise.resolve()} />)
    const login = await screen.findByRole('button', { name: en.authorizationLoginAdd })
    fireEvent.click(login)
    fireEvent.change(await screen.findByLabelText('Code 1'), { target: { value: 'old-code' } })
    fireEvent.click(screen.getByRole('button', { name: en.authorizationContinue }))
    fireEvent.click(screen.getAllByRole('button', { name: en.cancel })[0] as HTMLButtonElement)
    await waitFor(() => { expect(login).toHaveProperty('disabled', false) })
    fireEvent.click(login)
    await screen.findByLabelText('Code 2')
    rejectAnswer(new Error('stale answer failure'))
    await Promise.resolve()
    expect(screen.queryByText('stale answer failure')).toBeNull()
    expect(screen.getByLabelText('Code 2')).toBeTruthy()
  })
})
