/** Validated presentation messages; the shell does not interpret Agent states or pet identities. */

/** A single static frame selected by the client pet plugin. */
export interface DesktopPetPresentation {
  visible: boolean
  atlasUrl: string
  frame: number
  label: string
}

/**
 * Accept application-served PNG atlases or bounded PNG data, never executable or remote URLs.
 * @param value - Untrusted renderer IPC payload.
 * @returns the validated presentation fields.
 */
export function parsePetPresentation(value: unknown): DesktopPetPresentation {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid pet presentation')
  const fields = value as Record<string, unknown>
  const { visible, atlasUrl, frame, label } = fields
  if (typeof visible !== 'boolean' || typeof atlasUrl !== 'string' || typeof frame !== 'number'
    || !Number.isInteger(frame) || frame < 0 || frame > 3 || typeof label !== 'string' || label.length > 500) {
    throw new Error('Invalid pet presentation fields')
  }
  if (!visible) return { visible, atlasUrl, frame, label }
  const local = /^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.png$/.test(atlasUrl)
  const embedded = atlasUrl.length <= 8 * 1024 * 1024 && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(atlasUrl)
  if (!local && !embedded) throw new Error('Pet atlas must be a local PNG')
  return { visible, atlasUrl: local ? `dsh-app://app${atlasUrl}` : atlasUrl, frame, label }
}
