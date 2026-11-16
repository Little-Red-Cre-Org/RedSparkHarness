/**
 * Shared ownership of one E2B sandbox. Capability adapters await the same SDK
 * handle, so filesystem and process operations inhabit one remote Linux world.
 * @module @redspark/rsh-e2b/owner
 */

import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import { FileType, Sandbox, SandboxNotFoundError } from 'e2b'
import { proxyRouteFor } from '@redspark/rsh-http-proxy'
import { e2bApiUrl } from './api-url.ts'

/**
 * Quote one opaque argument for the SDK's unavoidable `/bin/bash -l -c` layer.
 * @param value - Exact argument value to preserve.
 * @returns A single shell word with no interpolation.
 */
export function quoteE2BShellArg(value: string): string {
  return `'${value.replaceAll('\'', "'\"'\"'")}'`
}

/**
 * Isolate E2B's hard-coded login shell behind a fresh randomized home path.
 * @param overrides - Additional environment entries for the internal command.
 * @returns A fresh mutable map that the E2B SDK may extend.
 */
export function e2bControlEnvs(
  overrides: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return { ...overrides, HOME: `/.dsh-e2b-control-${randomUUID()}` }
}

/** Configuration for the shared E2B sandbox owner. */
export interface Config {
  /** API key; omission reads `E2B_API_KEY`. It is never forwarded into the sandbox. */
  apiKey?: string
  /** Shared remote working directory, created before adapters receive the sandbox. */
  cwd?: string
  /** E2B sandbox lifetime in milliseconds; expiry always deletes the sandbox. */
  timeoutMs?: number
}

/** Sandbox settings after defaults and validation. */
export interface ResolvedE2BSandboxConfig {
  /** API key passed to the E2B SDK. */
  readonly apiKey: string
  /** Absolute remote working directory. */
  readonly cwd: string
  /** Sandbox lifetime in milliseconds. */
  readonly timeoutMs: number
}

/**
 * Shared sandbox fields adapters need without depending on the owner class.
 */
export interface E2BSandboxAccess {
  /** Shared remote working directory. */
  readonly cwd: string
  /** Remote directory reserved for adapter-owned process and terminal state. */
  readonly runtimeRoot: string
  /**
   * Return the shared live SDK handle.
   * @returns the created sandbox after the configured cwd exists.
   */
  getSandbox(): Promise<Sandbox>
}

const DEFAULT_CWD = '/home/user/workspace'
const DEFAULT_TIMEOUT_MS = 300_000

/**
 * Apply sandbox defaults and reject a missing key, a relative cwd, or a non-positive lifetime.
 * @param config - caller fields; omitted cwd and timeout use the family defaults.
 * @returns immutable connection settings.
 */
export function resolveE2BSandboxConfig(config: Config): ResolvedE2BSandboxConfig {
  const apiKey = config.apiKey ?? process.env.E2B_API_KEY ?? ''
  const cwd = config.cwd ?? DEFAULT_CWD
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (apiKey.length === 0) {
    throw new Error('dsh-e2b: configure apiKey or set E2B_API_KEY')
  }
  if (!posix.isAbsolute(cwd)) {
    throw new Error(`dsh-e2b: cwd must be an absolute Linux path: ${cwd}`)
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('dsh-e2b: timeoutMs must be a positive finite number')
  }
  return { apiKey, cwd, timeoutMs }
}

/**
 * Creates one lazily consumable E2B SDK handle and deletes the sandbox at
 * timeout or disposal. Creation begins at construction; adapters await
 * {@link getSandbox} before their first operation.
 */
export class E2BSandboxOwner implements E2BSandboxAccess {
  /** Validated remote working directory shared by provider adapters. */
  readonly cwd: string
  /** Remote directory reserved for adapter-owned process and terminal state. */
  readonly runtimeRoot: string

  private readonly config: ResolvedE2BSandboxConfig
  private readonly ready: Promise<Sandbox>
  private disposed = false

  /**
   * Start sandbox creation immediately.
   * @param config - partial settings; omitted cwd and timeout use the family defaults.
   */
  constructor(config: Config) {
    this.config = resolveE2BSandboxConfig(config)
    this.cwd = this.config.cwd
    this.runtimeRoot = posix.join(this.cwd, '.dsh-e2b')
    this.ready = this.open()
    // A deployment may load the owner before any adapter uses it. Keep a
    // failed eager connection observed; getSandbox() still returns the error.
    void this.ready.catch(() => {})
  }

  /**
   * Stop handle acquisition and delete the sandbox once setup settles.
   * @returns completion after the sandbox is gone or setup never acquired one.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    let sandbox: Sandbox
    try {
      sandbox = await this.ready
    } catch (_sandboxSetupFailure) {
      // open() either acquired no sandbox or already made the POC's one rollback attempt.
      return
    }
    try {
      await sandbox.kill()
    } catch (error: unknown) {
      if (!(error instanceof SandboxNotFoundError)) throw error
    }
  }

  /**
   * Return the shared live SDK handle.
   * @returns the created sandbox after the configured cwd exists.
   * @throws when E2B rejects creation or the service is disposing.
   */
  async getSandbox(): Promise<Sandbox> {
    if (this.disposed) throw new Error('E2B sandbox service is disposing')
    const sandbox = await this.ready
    // Disposal can race the awaited sandbox readiness despite the synchronous precheck.
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- Awaiting readiness yields to disposal.
    if (this.disposed) throw new Error('E2B sandbox service is disposing')
    return sandbox
  }

  private async open(): Promise<Sandbox> {
    // The SDK builds its own undici dispatcher, so the global one never reaches it; it takes a proxy
    // URL instead and reads no environment of its own. The decision is made against the URL the SDK
    // will really call, so a bypass entry naming that host is honored and a loopback debug plane
    // stays direct.
    const route = proxyRouteFor(new URL(e2bApiUrl()))
    const sandbox = await Sandbox.create({
      apiKey: this.config.apiKey,
      timeoutMs: this.config.timeoutMs,
      secure: true,
      lifecycle: { onTimeout: 'kill' },
      ...route.proxied ? { proxy: route.proxy } : {},
    })
    try {
      await sandbox.files.makeDir(this.cwd)
      await sandbox.files.makeDir(this.runtimeRoot)
      const runtimeRoot = await sandbox.files.getInfo(this.runtimeRoot)
      if (runtimeRoot.type !== FileType.DIR || runtimeRoot.symlinkTarget !== undefined) {
        throw new Error(`dsh-e2b: runtime root must be a real directory: ${this.runtimeRoot}`)
      }
      await sandbox.commands.run(
        `chmod 700 -- ${quoteE2BShellArg(this.runtimeRoot)}`,
        { envs: e2bControlEnvs() },
      )
      return sandbox
    } catch (error: unknown) {
      try {
        await sandbox.kill()
      } catch (_sandboxSetupRollbackFailure) {
        // TODO(e2b-setup-rollback): Add retry state only if a real double failure
        // outlives E2B's configured sandbox timeout.
      }
      throw error
    }
  }
}
