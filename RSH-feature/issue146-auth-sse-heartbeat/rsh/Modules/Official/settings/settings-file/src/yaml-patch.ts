/** YAML node edits shared by the legacy and native file Providers. */
import type { Document } from 'yaml'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'

/** Test whether a parsed YAML value is a map for diffing.
 * @param value - parsed document value.
 * @returns whether keys can be updated independently.
 */
export function isMapLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Apply the difference between one node's stored and next value as minimal
 * `setIn`/`deleteIn` edits, recursing through maps, so every untouched node —
 * and the key node of every changed pair — keeps its comments, anchors, and
 * formatting. Non-map values (arrays and scalars) replace wholesale when
 * unequal, taking any comments inside them along.
 * @param document - mutable parsed document.
 * @param path - exact node path.
 * @param current - previous parsed node value.
 * @param next - replacement node value.
 */
export function patchNode(document: Document, path: readonly string[], current: unknown, next: unknown): void {
  if (isMapLike(current) && isMapLike(next)) {
    for (const key of Object.keys(current)) {
      if (!(key in next)) document.deleteIn([...path, key])
    }
    for (const [key, value] of Object.entries(next)) {
      patchNode(document, [...path, key], current[key], value)
    }
    return
  }
  if (!deepEqualJson(current, next)) document.setIn([...path], next)
}
