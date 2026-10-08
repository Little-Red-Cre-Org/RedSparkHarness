/** Native filesystem policy resolved for the calling Session. */
import { isAbsolute, resolve } from 'node:path'
import type { SandboxExecutionPolicy, SandboxMode } from '@deepseek-ai/dsh-sandbox/native-types'
import type { Session } from '@deepseek-ai/dsh-session/native'
import { SessionSeq } from '@deepseek-ai/dsh-session/native'

const sessionModes = new WeakMap<Session, { nextSeq: number; mode: SandboxMode | undefined }>()

function sessionMode(session: Session): SandboxMode | undefined {
  const state = sessionModes.get(session) ?? { nextSeq: 0, mode: undefined }
  for (; state.nextSeq < session.seq; state.nextSeq += 1) {
    // oxlint-disable-next-line typescript/no-deprecated -- Native policy reads the live Session log; a projection Provider is not required.
    const event = session.eventAt(SessionSeq(state.nextSeq))
    if (event?.type === 'sandbox/mode') state.mode = event.data.mode
  }
  sessionModes.set(session, state)
  return state.mode
}

/** Required deployment choices; the bridge never falls back to bare local storage. */
export interface Config {
  readonly mode: SandboxMode
  readonly workspaceRoot: string
}

/**
 * Validate explicit policy before any Provider is activated.
 * @param input - profile configuration value.
 * @returns immutable native policy configuration.
 */
export function resolveConfig(input: unknown): Config {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('native-sandbox-policy: configuration must be an object')
  const fields = input as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (key !== 'mode' && key !== 'workspaceRoot') throw new Error(`native-sandbox-policy: unsupported configuration field ${key}`)
  }
  if (fields.mode !== 'read-only' && fields.mode !== 'workspace-write' && fields.mode !== 'danger-full-access') {
    throw new Error('native-sandbox-policy: mode must be read-only, workspace-write or danger-full-access')
  }
  if (typeof fields.workspaceRoot !== 'string' || !isAbsolute(fields.workspaceRoot)) {
    throw new Error('native-sandbox-policy: workspaceRoot must be an absolute path')
  }
  return Object.freeze({ mode: fields.mode, workspaceRoot: resolve(fields.workspaceRoot) })
}

/** Per-session policy result used by native and adapted filesystem Providers. */
export class NativeSandboxPolicy {
  constructor(readonly config: Config) {}

  /** Deployment mode advertised by a sandboxing filesystem. */
  get defaultMode(): SandboxMode { return this.config.mode }

  /**
   * Use the Session workspace when present and the explicit deployment root otherwise.
   * @param request - optional current Session.
   * @returns mutation policy for one filesystem operation.
   */
  resolve(request: { session?: Session } = {}): SandboxExecutionPolicy {
    return { mode: request.session === undefined ? this.config.mode : sessionMode(request.session) ?? this.config.mode,
      workspaceRoot: request.session?.header.cwd ?? this.config.workspaceRoot }
  }
}

export { plugin } from './native.ts'
