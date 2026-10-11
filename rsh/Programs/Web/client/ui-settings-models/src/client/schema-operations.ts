import type { SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ModelSettingsSchemaOperations } from '@deepseek-ai/dsh-client-ui-primitives'

/** Plain schema callbacks exposed to Models stores and presentation components. */
export type SettingsSchemaOperations = ModelSettingsSchemaOperations
type SchemaNode = Parameters<SettingsSchemaService['validate']>[0]

/**
 * Hide the Cordis service identity behind bound schema callbacks.
 * @param service - settings-owned schema service available in the apply context.
 * @returns callbacks that cannot expose the service context to React components.
 */
export function createSettingsSchemaOperations(service: SettingsSchemaService): SettingsSchemaOperations {
  return {
    rehydrate: serialized => service.rehydrate(serialized),
    validate: (schema, draft) => service.validate(schema as unknown as SchemaNode, draft),
    nodeAtPath: (root, path) => service.nodeAtPath(root as SchemaNode, path),
    getPath: (value, path) => service.getPath(value, path),
    hasPath: (value, path) => service.hasPath(value, path),
    setPath: (root, path, value) => service.setPath(root, path, value),
    deletePath: (root, path) => service.deletePath(root, path),
  }
}
