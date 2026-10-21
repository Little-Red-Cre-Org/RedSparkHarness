/** Shared model text for native and compatibility code transports. */
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Two-space JSON presentation, matching the existing shallow `run_code` text contract. */
const JSON_INDENT = '  '

/**
 * ECMAScript caps `JSON.stringify`'s `space` string at ten characters. The
 * renderer also caps TOTAL indentation there, compacting deeper subtrees, so
 * formatted output remains linear in the canonical JSON size.
 */
const MAX_JSON_INDENT_CHARS = 10

/** A pending fragment in the iterative JSON presentation traversal. */
type JsonRenderTask =
  | { kind: 'text'; text: string }
  | { kind: 'value'; value: JsonValue; depth: number; compact: boolean }

/** Render one non-string JSON root without recursive traversal or unbounded indentation growth. */
function renderJsonValue(value: Exclude<JsonValue, string>): string {
  const chunks: string[] = []
  const tasks: JsonRenderTask[] = [{ kind: 'value', value, depth: 0, compact: false }]
  for (let task = tasks.pop(); task !== undefined; task = tasks.pop()) {
    if (task.kind === 'text') {
      chunks.push(task.text)
      continue
    }

    const current = task.value
    if (current === null || typeof current === 'boolean' || typeof current === 'number') {
      chunks.push(String(current))
      continue
    }
    if (typeof current === 'string') {
      chunks.push(JSON.stringify(current))
      continue
    }

    const compact = task.compact || (task.depth + 1) * JSON_INDENT.length > MAX_JSON_INDENT_CHARS
    const childDepth = task.depth + 1
    if (Array.isArray(current)) {
      chunks.push('[')
      if (current.length === 0) {
        chunks.push(']')
        continue
      }
      tasks.push({ kind: 'text', text: compact ? ']' : `\n${JSON_INDENT.repeat(task.depth)}]` })
      for (let index = current.length - 1; index >= 0; index--) {
        const item = current[index]
        /* v8 ignore next -- canonical JsonValue arrays are dense. */
        if (item === undefined) throw new Error('cannot render a sparse JSON array')
        tasks.push({ kind: 'value', value: item, depth: childDepth, compact })
        tasks.push({
          kind: 'text',
          text: compact
            ? index === 0 ? '' : ','
            : `${index === 0 ? '\n' : ',\n'}${JSON_INDENT.repeat(childDepth)}`,
        })
      }
      continue
    }

    const keys = Object.keys(current)
    chunks.push('{')
    if (keys.length === 0) {
      chunks.push('}')
      continue
    }
    tasks.push({ kind: 'text', text: compact ? '}' : `\n${JSON_INDENT.repeat(task.depth)}}` })
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index]
      /* v8 ignore next -- the loop is bounded by the captured key count. */
      if (key === undefined) throw new Error('cannot render a missing JSON object key')
      const item = current[key]
      /* v8 ignore next -- canonical JsonValue records contain no undefined properties. */
      if (item === undefined) throw new Error('cannot render an undefined JSON object property')
      tasks.push({ kind: 'value', value: item, depth: childDepth, compact })
      tasks.push({
        kind: 'text',
        text: compact
          ? `${index === 0 ? '' : ','}${JSON.stringify(key)}:`
          : `${index === 0 ? '\n' : ',\n'}${JSON_INDENT.repeat(childDepth)}${JSON.stringify(key)}: `,
      })
    }
  }
  return chunks.join('')
}

/** Render one present program completion value for the model-facing result text. */
function renderValue(value: JsonValue): string {
  return typeof value === 'string' ? value : renderJsonValue(value)
}

/**
 * Join captured program logs and its optional canonical completion for model history.
 * @param logs - bounded program output in capture order.
 * @param result - detached lossless JSON; strings render verbatim, other roots use bounded-indentation JSON.
 * @returns one text result, or the explicit no-output message when both sources are empty.
 */
export function renderCodeOutput(logs: readonly string[], result?: JsonValue): string {
  const rendered = result === undefined ? '' : renderValue(result)
  const parts = [logs.join('\n'), rendered].filter(part => part.length > 0)
  return parts.length > 0 ? parts.join('\n') : '(run_code completed with no output)'
}
