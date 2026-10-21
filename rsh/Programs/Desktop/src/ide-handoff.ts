/** Validated renderer request for a local workspace and its unsent text. */
import { isAbsolute } from 'node:path'

/** Wire fields copied between the two application renderers, never sent to a model. */
export interface IdeHandoff {
  readonly workspaceId: string
  readonly path: string
  readonly locale?: string
  readonly sessionId?: string
  readonly draft?: string
}

/**
 * Validate the renderer's workspace selection before launching a local process.
 * @param value - untrusted IPC or private-protocol JSON.
 * @returns workspace selection and optional conversation draft.
 */
export function parseIdeHandoff(value: unknown): IdeHandoff {
  if (typeof value !== 'object' || value === null
    || !('workspaceId' in value) || typeof value.workspaceId !== 'string' || value.workspaceId === ''
    || !('path' in value) || typeof value.path !== 'string' || !isAbsolute(value.path)
    || ('locale' in value && (typeof value.locale !== 'string' || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(value.locale)))
    || ('sessionId' in value && (typeof value.sessionId !== 'string' || value.sessionId === ''))
    || ('draft' in value && (typeof value.draft !== 'string' || !('sessionId' in value)))) {
    throw new Error('Invalid desktop IDE workspace request')
  }
  return { workspaceId: value.workspaceId, path: value.path,
    ...('locale' in value ? { locale: value.locale as string } : {}),
    ...('sessionId' in value ? { sessionId: value.sessionId as string } : {}),
    ...('draft' in value ? { draft: value.draft as string } : {}) }
}
