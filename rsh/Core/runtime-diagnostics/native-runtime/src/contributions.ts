/** Named contributions with ancestor visibility and independently owned registrations. */
import { NativeScope } from './scope.ts'

/** One registry confined to its Provider's scope tree. */
export class NativeContributions<T> {
  private readonly layers = new Map<NativeScope, Map<string, { value: T }>>()

  /** @param root - Provider scope containing every registration and lookup. */
  constructor(private readonly root: NativeScope) {}

  private assertScope(scope: NativeScope): void {
    if (!this.root.contains(scope)) throw new Error('native-runtime: contribution scope is outside the Provider realm')
  }

  /**
   * Register a name in one layer; a descendant may shadow an ancestor's name.
   * @param name - contribution name, unique within this layer.
   * @param value - value held by this registration.
   * @param scope - registration scope, defaulting to the Provider's root.
   * @returns an idempotent disposer that cannot remove a later registration of the same value.
   */
  register(name: string, value: T, scope = this.root): () => void {
    this.assertScope(scope)
    let layer = this.layers.get(scope)
    if (layer === undefined) {
      layer = new Map()
      this.layers.set(scope, layer)
    }
    if (layer.has(name)) throw new Error(`native-runtime: duplicate contribution ${name} in scope ${scope.id}`)
    const entry = { value }
    layer.set(name, entry)
    return () => {
      if (layer.get(name) !== entry) return
      layer.delete(name)
      if (layer.size === 0 && this.layers.get(scope) === layer) this.layers.delete(scope)
    }
  }

  /**
   * Collect visible names with the nearest registration winning each name.
   * @param scope - consumer scope, defaulting to the Provider's root.
   * @returns a detached map; its values remain owned by their registrations.
   */
  visible(scope = this.root): Map<string, T> {
    this.assertScope(scope)
    const chain: NativeScope[] = []
    for (let current: NativeScope | undefined = scope; current !== undefined; current = current.parent) {
      chain.push(current)
      if (current === this.root) break
    }
    const result = new Map<string, T>()
    for (const current of chain.reverse()) {
      for (const [name, entry] of this.layers.get(current) ?? []) result.set(name, entry.value)
    }
    return result
  }

  /** Remove every registration during Provider teardown. */
  clear(): void { this.layers.clear() }
}
