import type { ModelSettingsNamespace, ModelSettingsSchemaOperations } from './types.ts'

const PROBE_ROUTE = '\u0000probe'

/** Derive the credential reference used by a provider route without a named key.
 * @param provider - provider route id.
 * @returns the route's conventional API-key credential reference.
 */
export function deriveModelCredentialRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/** Read protocol choices declared by the provider namespace schema.
 * @param namespace - provider namespace descriptor, or undefined when it is unavailable.
 * @param schema - schema operations for the descriptor format.
 * @returns the declared API protocol values.
 */
export function modelProtocolChoices(
  namespace: ModelSettingsNamespace | undefined,
  schema: ModelSettingsSchemaOperations,
): string[] {
  if (namespace === undefined) return []
  const node = schema.nodeAtPath(schema.rehydrate(namespace.schema), ['providers', PROBE_ROUTE, 'api'])
  if (node?.type !== 'union' || node.list === undefined) return []
  return node.list.map(entry => entry.value).filter((value): value is string => typeof value === 'string')
}
