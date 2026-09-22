/** Per-session filesystem observations shared by Cordis and native policy installers. */
import { FsError, type FsObservation, type FsTarget, type FsVersion, type FsWriteIntent } from '@deepseek-ai/dsh-fs/types'
import type { FsObservationActor } from './types.ts'

/** One installation's read-before-edit and version-guard decisions. */
export class ObservedStateGate {
  private observed = new WeakMap<object, Map<string, FsObservation>>()

  private owner(actor: object | undefined): object | undefined {
    // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- tsc needs the structural cast; tsgolint disagrees.
    return (actor as FsObservationActor | undefined)?.agent?.session
  }

  /** Release all observations when the policy installation is removed. */
  clear(): void {
    this.observed = new WeakMap()
  }

  /** Select create-only or version-guarded replacement from this session's last observation. */
  writeIntent(target: FsTarget, actor: object | undefined): FsWriteIntent {
    const owner = this.owner(actor)
    const prior = owner === undefined ? undefined : this.observed.get(owner)?.get(target.targetKey)
    return prior?.kind === 'present'
      ? { kind: 'replaceIfVersion', version: prior.version }
      : { kind: 'createIfAbsent' }
  }

  /** Require a previous successful read before edit and return its version. */
  editIntent(target: FsTarget, actor: object | undefined): { version: FsVersion } {
    const owner = this.owner(actor)
    const prior = owner === undefined ? undefined : this.observed.get(owner)?.get(target.targetKey)
    if (prior === undefined) throw new FsError(`edit requires reading "${target.displayPath}" first`, 'FS_NOT_OBSERVED')
    if (prior.kind === 'absent') throw new FsError(`cannot edit "${target.displayPath}": not found`, 'FS_NOT_FOUND')
    return { version: prior.version }
  }

  /** Record an authoritative present or absent observation for the initiating session. */
  observe(target: FsTarget, observation: FsObservation, actor: object | undefined): void {
    const owner = this.owner(actor)
    if (owner === undefined) return
    let byTarget = this.observed.get(owner)
    if (byTarget === undefined) {
      byTarget = new Map()
      this.observed.set(owner, byTarget)
    }
    byTarget.set(target.targetKey, observation)
  }
}
