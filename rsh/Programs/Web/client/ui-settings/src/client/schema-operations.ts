/**
 * Settings-owned schema operations with no framework dependency.
 *
 * A Cordis build receives these through the `settingsSchema` service; a Native
 * build receives them as a plain object. Both wrap the same functions, so a
 * settings page that rehydrates a schema or edits a draft behaves identically
 * in either client.
 */

import Schema from '@redspark/schemastery'

/** Live schemastery node used for settings introspection and validation. */
export type SchemaNode = Schema

/** Plain schema callbacks consumed by settings pages and stores. */
export interface SettingsSchemaOperations {
  /**
   * Rehydrate one serialized `schema.toJSON()` envelope.
   * @param serialized - serialized Schemastery node.
   * @returns live schema node.
   */
  rehydrate(serialized: unknown): SchemaNode
  /**
   * Validate a settings draft.
   * @param schema - live schema node.
   * @param draft - candidate settings value.
   * @returns validation failure text, or `undefined` when valid.
   */
  validate(schema: SchemaNode, draft: unknown): string | undefined
  /**
   * Resolve an object, dict, or array schema node at a settings path.
   * @param root - schema node to traverse.
   * @param path - object keys or array indexes.
   * @returns the resolved node, or `undefined` when the path is absent.
   */
  nodeAtPath(root: SchemaNode, path: readonly string[]): SchemaNode | undefined
  /**
   * Read a nested value by a string-key or array-index path.
   * @param value - value to traverse.
   * @param path - object keys or array indexes.
   * @returns the resolved value, or `undefined` when the path is absent.
   */
  getPath(value: unknown, path: readonly string[]): unknown
  /**
   * Report whether the final path key exists independently of its value.
   * @param value - value to traverse.
   * @param path - object keys or array indexes.
   * @returns whether the path exists.
   */
  hasPath(value: unknown, path: readonly string[]): boolean
  /**
   * Immutably set a nested value, materializing missing containers.
   * @param root - settings object to copy.
   * @param path - non-empty object-key or array-index path.
   * @param value - replacement value.
   * @returns copied root containing the replacement.
   * @throws when `path` is empty.
   */
  setPath(root: Record<string, unknown>, path: readonly string[], value: unknown): Record<string, unknown>
  /**
   * Immutably remove a nested key, preserving an unchanged missing root.
   * @param root - settings object to copy.
   * @param path - non-empty object-key or array-index path.
   * @returns copied root without the key, or `root` when the path is absent.
   * @throws when `path` is empty.
   */
  deletePath(root: Record<string, unknown>, path: readonly string[]): Record<string, unknown>
}

function cloneContainer(container: unknown, key: string): Record<string, unknown> | unknown[] {
  if (Array.isArray(container)) return [...container as unknown[]]
  if (typeof container === 'object' && container !== null) return { ...container as Record<string, unknown> }
  return /^\d+$/.test(key) ? [] : {}
}

function cloneSpine(root: Record<string, unknown>, path: readonly string[]): {
  result: Record<string, unknown>
  parent: Record<string, unknown> | unknown[]
  leaf: string
} {
  const result = { ...root }
  let target: Record<string, unknown> | unknown[] = result
  for (let index = 0; index < path.length - 1; index++) {
    const key = path[index] as string
    const child = cloneContainer(
      Array.isArray(target) ? target[Number(key)] : target[key],
      path[index + 1] as string,
    )
    if (Array.isArray(target)) target[Number(key)] = child
    else target[key] = child
    target = child
  }
  return { result, parent: target, leaf: path[path.length - 1] as string }
}

/**
 * Build the schema operation set over schemastery.
 * @returns the operations both browser builds consume.
 */
export function createSettingsSchemaOperations(): SettingsSchemaOperations {
  const getPath = (value: unknown, path: readonly string[]): unknown => {
    let current: unknown = value
    for (const key of path) {
      if (Array.isArray(current)) {
        current = current[Number(key)]
        continue
      }
      if (typeof current !== 'object' || current === null) return undefined
      current = (current as Record<string, unknown>)[key]
    }
    return current
  }
  const hasPath = (value: unknown, path: readonly string[]): boolean => {
    if (path.length === 0) return value !== undefined
    const parent = getPath(value, path.slice(0, -1))
    const key = path[path.length - 1] as string
    if (Array.isArray(parent)) return Number(key) < parent.length
    if (typeof parent !== 'object' || parent === null) return false
    return key in parent
  }
  return {
    rehydrate: serialized => new Schema(serialized as Schema),
    validate(schema, draft) {
      try {
        ;(schema as unknown as (value: unknown) => unknown)(draft)
        return undefined
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    },
    nodeAtPath(root, path) {
      let node: SchemaNode | undefined = root
      for (const key of path) {
        if (node === undefined) return undefined
        if (node.type === 'object') node = (node.dict as Record<string, SchemaNode> | undefined)?.[key]
        else if (node.type === 'dict' || node.type === 'array') node = node.inner as SchemaNode | undefined
        else return undefined
      }
      return node
    },
    getPath,
    hasPath,
    setPath(root, path, value) {
      if (path.length === 0) throw new Error('ui-settings: setPath needs a non-empty path')
      const { result, parent, leaf } = cloneSpine(root, path)
      if (Array.isArray(parent)) parent[Number(leaf)] = value
      else parent[leaf] = value
      return result
    },
    deletePath(root, path) {
      if (path.length === 0) throw new Error('ui-settings: deletePath needs a non-empty path')
      if (!hasPath(root, path)) return root
      const { result, parent, leaf } = cloneSpine(root, path)
      if (Array.isArray(parent)) parent.splice(Number(leaf), 1)
      else Reflect.deleteProperty(parent, leaf)
      return result
    },
  }
}
