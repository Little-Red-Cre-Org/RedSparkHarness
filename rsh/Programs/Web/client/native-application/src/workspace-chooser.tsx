/** Empty-state Workspace and Agent preset entry controls. */
import { useState } from 'react'
import {
  Button, DirectoryBrowser, IconAgentPresetOutline16, IconChevronDownOutline14, IconFolderClose16, IconFolderOpen16,
  IconPlusOutline16, Menu, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DirectoryBrowserListing } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  NativeAgentPresetList, NativeDirectoryPickerClient, NativeWorkspace,
} from '@deepseek-ai/dsh-client-native-session/native'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { NativeSessionRpcError } from '@deepseek-ai/dsh-client-native-session/native'
import type { ConversationLocaleKey } from './locales.ts'
import css from './workspace-chooser.module.css'

type Translate = (key: ConversationLocaleKey, params?: Record<string, unknown>) => string
type WorkspaceStart = (trust?: boolean) => Promise<SessionId | undefined>

/** Choose an existing Workspace or add a directory from the conversation hero. */
export function WorkspaceChooser({ label, currentWorkspaceId, selected, ready, listWorkspaces, chooseWorkspace,
  addWorkspace, listDirectory, createDirectory, t }: {
  label: string
  currentWorkspaceId?: NativeWorkspace['workspaceId'] | undefined
  selected: boolean
  ready: boolean
  listWorkspaces: () => Promise<readonly NativeWorkspace[]>
  chooseWorkspace: (id: NativeWorkspace['workspaceId']) => WorkspaceStart
  addWorkspace: (path: string) => WorkspaceStart
  listDirectory: (path?: string, signal?: AbortSignal) => Promise<DirectoryBrowserListing>
  createDirectory: NativeDirectoryPickerClient['createDirectory']
  t: Translate
}) {
  const [workspaces, setWorkspaces] = useState<readonly NativeWorkspace[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [directoryOpen, setDirectoryOpen] = useState(false)
  const [directoryBusy, setDirectoryBusy] = useState(false)
  const [directoryError, setDirectoryError] = useState<string>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [trustPrompt, setTrustPrompt] = useState<{ path: string; retry: () => Promise<unknown> }>()
  const [trustPending, setTrustPending] = useState(false)

  const requestWorkspaceTrust = (reason: unknown, retry: (path: string) => Promise<unknown>): boolean => {
    if (!(reason instanceof NativeSessionRpcError) || reason.code !== 'native/workspace-untrusted') return false
    const path = 'path' in reason.details ? reason.details.path : undefined
    if (typeof path !== 'string') return false
    setDirectoryOpen(false)
    setTrustPrompt({ path, retry: () => retry(path) })
    return true
  }

  const openChooser = (): void => {
    setError(undefined)
    setDirectoryError(undefined)
    setMenuOpen(false)
    setBusy(true)
    void listWorkspaces().then((items) => {
      setWorkspaces(items)
      if (items.length === 0) setDirectoryOpen(true)
      else setMenuOpen(true)
    }).catch((reason: unknown) => {
      setError(errorMessage(reason))
    }).finally(() => { setBusy(false) })
  }
  const selectWorkspace = (id: string): void => {
    setMenuOpen(false)
    if (id === 'add-workspace') {
      setDirectoryError(undefined)
      setDirectoryOpen(true)
      return
    }
    const start = chooseWorkspace(id as NativeWorkspace['workspaceId'])
    setBusy(true)
    void start().catch((reason: unknown) => {
      if (!requestWorkspaceTrust(reason, () => start(true))) setError(errorMessage(reason))
    }).finally(() => { setBusy(false) })
  }
  const addDirectory = (path: string): void => {
    setDirectoryError(undefined)
    setDirectoryBusy(true)
    const start = addWorkspace(path)
    void start().then(() => {
      setDirectoryOpen(false)
    }).catch((reason: unknown) => {
      if (!requestWorkspaceTrust(reason, () => start(true))) setDirectoryError(errorMessage(reason))
    }).finally(() => { setDirectoryBusy(false) })
  }

  const confirmTrust = (): void => {
    if (trustPrompt === undefined || trustPending) return
    setTrustPending(true)
    void trustPrompt.retry().then(() => {
      setTrustPrompt(undefined)
    }).catch((reason: unknown) => {
      setTrustPrompt(undefined)
      setError(errorMessage(reason))
    }).finally(() => { setTrustPending(false) })
  }

  return <>
    <Menu
      open={menuOpen}
      onClose={() => { setMenuOpen(false) }}
      items={workspaces.map(workspace => ({
        id: workspace.workspaceId,
        label: workspace.title,
        icon: <IconFolderClose16 size={16} />,
      }))}
      footer={[{ id: 'add-workspace', label: t('addWorkspace'), icon: <IconPlusOutline16 size={16} /> }]}
      selectedId={currentWorkspaceId}
      onSelect={selectWorkspace}
      portal
      anchor={<button type="button" className={css.workspace} aria-haspopup="menu" aria-expanded={menuOpen}
        disabled={!ready || busy} onClick={openChooser}>
        {selected ? <IconFolderOpen16 size={16} /> : <IconFolderClose16 size={16} />}
        <span>{label}</span>
        <IconChevronDownOutline14 size={12} />
      </button>}
    />
    {error === undefined ? null : <span className={css.error} role="alert">{error}</span>}
    <DirectoryBrowser open={directoryOpen} listDirectory={listDirectory} createDirectory={createDirectory}
      onOpen={addDirectory} onClose={() => { setDirectoryOpen(false) }} busy={directoryBusy} ownerError={directoryError} t={t} />
    {trustPrompt === undefined ? null : <Modal open title={t('workspaceTrustTitle')} description={t('workspaceTrustBody')}
      closeLabel={t('close')} onClose={() => {
        if (!trustPending) setTrustPrompt(undefined)
      }}
      footer={<>
        <Button variant="outline" disabled={trustPending} onClick={() => {
          setTrustPrompt(undefined)
        }}>{t('browser.cancel')}</Button>
        <Button variant="primary" disabled={trustPending} onClick={confirmTrust}>{t('workspaceTrust')}</Button>
      </>}>
      <code>{trustPrompt.path}</code>
    </Modal>}
  </>
}

/** Stage the Host preset for the Session about to start. */
export function AgentPresetSeat({ roster, stagedPreset, stagePreset, t }: {
  roster?: NativeAgentPresetList | undefined
  stagedPreset?: string | undefined
  stagePreset: (id: string) => void
  t: Translate
}) {
  const [open, setOpen] = useState(false)
  if (roster === undefined) return null
  const presets = roster.presets.filter(preset => preset.status === 'ready')
  if (presets.length === 0) return null
  const current = presets.find(preset => preset.id === stagedPreset)
    ?? presets.find(preset => preset.id === roster.default)
    ?? presets[0]
  return <Menu
    open={open}
    onClose={() => { setOpen(false) }}
    items={presets.map(preset => ({ id: preset.id, label: preset.name }))}
    selectedId={current?.id}
    onSelect={(id) => { setOpen(false); stagePreset(id) }}
    portal
    anchor={<button type="button" className={css.preset} title={t('presetSeatHint')}
      aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
      <IconAgentPresetOutline16 size={16} />
      <span>{current?.name}</span>
      <IconChevronDownOutline14 size={12} />
    </button>}
  />
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
