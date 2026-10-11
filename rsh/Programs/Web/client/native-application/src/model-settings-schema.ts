/** Schema reads and immutable drafts for native provider editors. */
import Schema from '@deepseek-ai/schemastery'
import type { ModelSchemaNode, ModelSettingsSchemaOperations } from '@deepseek-ai/dsh-client-ui-primitives'

type SchemaFields = ModelSchemaNode & {
  readonly dict?: Readonly<Record<string, ModelSchemaNode>>
  readonly inner?: ModelSchemaNode
}

function cloneContainer(container: unknown, key: string): Record<string, unknown> | unknown[] {
  if (Array.isArray(container)) {
    const values: unknown[] = container
    return [...values]
  }
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
  for (let index = 0; index < path.length - 1; index += 1) {
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

/** Native provider-card schema operations over Host-serialized Schemastery nodes. */
export const modelSettingsSchema: ModelSettingsSchemaOperations = {
  rehydrate(serialized) {
    return new Schema(serialized as Schema)
  },
  validate(schema, draft) {
    try {
      ;(schema as unknown as (value: unknown) => unknown)(draft)
      return undefined
    } catch (error: unknown) {
      return error instanceof Error ? error.message : String(error)
    }
  },
  nodeAtPath(root, path) {
    let node: SchemaFields | undefined = root
    for (const key of path) {
      if (node === undefined) return undefined
      if (node.type === 'object') node = node.dict?.[key]
      else if (node.type === 'dict' || node.type === 'array') node = node.inner
      else return undefined
    }
    return node
  },
  getPath(value, path) {
    let current = value
    for (const key of path) {
      if (Array.isArray(current)) current = current[Number(key)]
      else if (typeof current === 'object' && current !== null) current = (current as Record<string, unknown>)[key]
      else return undefined
    }
    return current
  },
  hasPath(value, path) {
    if (path.length === 0) return value !== undefined
    const parent = this.getPath(value, path.slice(0, -1))
    const key = path[path.length - 1] as string
    if (Array.isArray(parent)) return Number(key) < parent.length
    if (typeof parent !== 'object' || parent === null) return false
    return key in parent
  },
  setPath(root, path, value) {
    if (path.length === 0) throw new Error('native models: setPath needs a non-empty path')
    const { result, parent, leaf } = cloneSpine(root, path)
    if (Array.isArray(parent)) parent[Number(leaf)] = value
    else parent[leaf] = value
    return result
  },
  deletePath(root, path) {
    if (path.length === 0) throw new Error('native models: deletePath needs a non-empty path')
    if (!this.hasPath(root, path)) return root
    const { result, parent, leaf } = cloneSpine(root, path)
    if (Array.isArray(parent)) parent.splice(Number(leaf), 1)
    else Reflect.deleteProperty(parent, leaf)
    return result
  },
}
