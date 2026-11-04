/** Cordis identity for the settings-owned schema operations. */
import { Service } from '@redspark/cordis'
import type { Context } from '@redspark/cordis'
import { createSettingsSchemaOperations, type SettingsSchemaOperations } from './schema-operations.ts'

export type { SchemaNode, SettingsSchemaOperations } from './schema-operations.ts'

/**
 * Settings-owned synchronous schema service. Dynamic client plugins receive
 * this Cordis entity instead of importing executable helpers from one another;
 * a Native client receives the same operations as a plain object from its own
 * entry. Both wrap {@link createSettingsSchemaOperations}.
 */
export class SettingsSchemaService extends Service implements SettingsSchemaOperations {
  private readonly operations: SettingsSchemaOperations

  /** @param ctx - providing ui-settings context. */
  constructor(ctx: Context) {
    super(ctx, 'settingsSchema')
    this.operations = createSettingsSchemaOperations()
  }

  /**
   * Rehydrate one serialized `schema.toJSON()` envelope.
   * @param serialized - serialized Schemastery node.
   * @returns live schema node.
   */
  rehydrate(serialized: unknown) {
    return this.operations.rehydrate(serialized)
  }

  /**
   * Validate a settings draft.
   * @param schema - live schema node.
   * @param draft - candidate settings value.
   * @returns validation failure text, or `undefined` when valid.
   */
  validate(schema: Parameters<SettingsSchemaOperations['validate']>[0], draft: unknown): string | undefined {
    return this.operations.validate(schema, draft)
  }

  /**
   * Resolve an object, dict, or array schema node at a settings path.
   * @param root - schema node to traverse.
   * @param path - object keys or array indexes.
   * @returns the resolved node, or `undefined` when the path is absent.
   */
  nodeAtPath(root: Parameters<SettingsSchemaOperations['nodeAtPath']>[0], path: readonly string[]) {
    return this.operations.nodeAtPath(root, path)
  }

  /**
   * Read a nested value by a string-key or array-index path.
   * @param value - value to traverse.
   * @param path - object keys or array indexes.
   * @returns the resolved value, or `undefined` when the path is absent.
   */
  getPath(value: unknown, path: readonly string[]): unknown {
    return this.operations.getPath(value, path)
  }

  /**
   * Report whether the final path key exists independently of its value.
   * @param value - value to traverse.
   * @param path - object keys or array indexes.
   * @returns whether the path exists.
   */
  hasPath(value: unknown, path: readonly string[]): boolean {
    return this.operations.hasPath(value, path)
  }

  /**
   * Immutably set a nested value, materializing missing containers.
   * @param root - settings object to copy.
   * @param path - non-empty object-key or array-index path.
   * @param value - replacement value.
   * @returns copied root containing the replacement.
   */
  setPath(root: Record<string, unknown>, path: readonly string[], value: unknown): Record<string, unknown> {
    return this.operations.setPath(root, path, value)
  }

  /**
   * Immutably remove a nested key, preserving an unchanged missing root.
   * @param root - settings object to copy.
   * @param path - non-empty object-key or array-index path.
   * @returns copied root without the key, or `root` when the path is absent.
   */
  deletePath(root: Record<string, unknown>, path: readonly string[]): Record<string, unknown> {
    return this.operations.deletePath(root, path)
  }
}

declare module '@redspark/cordis' {
  interface Context {
    /** Settings-owned synchronous schema and immutable path operations. */
    settingsSchema: SettingsSchemaService
  }
}
