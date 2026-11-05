import type { ModelSchemaNode, ModelSettingsSchemaOperations } from '@redspark/rsh-client-ui-primitives'

/** Plain schema callbacks exposed to Models stores and presentation components. */
export type SettingsSchemaOperations = ModelSettingsSchemaOperations

/** Live schemastery node used for settings introspection and validation. */
type SchemaNode = ModelSchemaNode

/**
 * The settings-owned schema reads, named structurally.
 *
 * The Cordis half receives ui-settings' `SettingsSchemaService`; a Native
 * composition receives the same operations as a plain object from the settings
 * domain base's Native half. Naming only the calls keeps this module usable by
 * both clients, and keeps a Native build free of the Cordis service class.
 */
export interface SettingsSchemaSource {
  /** @param serialized - serialized `schema.toJSON()` envelope. @returns the live node. */
  rehydrate(serialized: unknown): SchemaNode
  /** @param schema - live node. @param draft - candidate value. @returns failure text, or undefined when valid. */
  validate(schema: SchemaNode, draft: unknown): string | undefined
  /** @param root - node to traverse. @param path - object keys or array indexes. @returns the resolved node. */
  nodeAtPath(root: SchemaNode, path: readonly string[]): SchemaNode | undefined
  /** @param value - value to traverse. @param path - object keys or array indexes. @returns the resolved value. */
  getPath(value: unknown, path: readonly string[]): unknown
  /** @param value - value to traverse. @param path - object keys or array indexes. @returns whether the path exists. */
  hasPath(value: unknown, path: readonly string[]): boolean
  /** @param root - settings object to copy. @param path - non-empty path. @param value - replacement. */
  setPath(root: Record<string, unknown>, path: readonly string[], value: unknown): Record<string, unknown>
  /** @param root - settings object to copy. @param path - non-empty path. @returns copied root without the key. */
  deletePath(root: Record<string, unknown>, path: readonly string[]): Record<string, unknown>
}

/**
 * Hide the schema service identity behind bound callbacks.
 * @param service - settings-owned schema reads, from either client.
 * @returns callbacks that cannot expose a service context to React components.
 */
export function createSettingsSchemaOperations(service: SettingsSchemaSource): SettingsSchemaOperations {
  return {
    rehydrate: serialized => service.rehydrate(serialized),
    validate: (schema, draft) => service.validate(schema, draft),
    nodeAtPath: (root, path) => service.nodeAtPath(root, path),
    getPath: (value, path) => service.getPath(value, path),
    hasPath: (value, path) => service.hasPath(value, path),
    setPath: (root, path, value) => service.setPath(root, path, value),
    deletePath: (root, path) => service.deletePath(root, path),
  }
}
