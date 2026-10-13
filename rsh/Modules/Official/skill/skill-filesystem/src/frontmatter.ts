import { parse as parseYaml } from 'yaml'
import { isSkillName } from '@deepseek-ai/dsh-skill/shared'
import type { SkillInvocationPolicy } from '@deepseek-ai/dsh-skill/types'

/** Valid skill fields extracted from one Markdown instruction file. */
export interface ParsedSkillContent {
  readonly path: string
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly invocation: SkillInvocationPolicy
  readonly metadata?: Record<string, unknown>
  readonly content: string
}

/** Parse the shared skill frontmatter grammar and report invalid files through the caller's logger.
 * @param path - source path used in diagnostics and the returned definition.
 * @param content - complete Markdown file text.
 * @param warn - caller-owned diagnostic sink for malformed skill files.
 * @returns parsed skill metadata and instruction body, or undefined when the file is invalid.
 */
export function parseSkillContent(
  path: string,
  content: string,
  warn: (message: string) => void,
): ParsedSkillContent | undefined {
  let parsed
  try {
    parsed = parseFrontmatter(content)
  } catch (error) {
    warn(`skill file ${path} ignored: invalid YAML frontmatter: ${String(error)}`)
    return undefined
  }
  if (!parsed) {
    warn(`skill file ${path} ignored: missing YAML frontmatter`)
    return undefined
  }
  const name = stringField(parsed.data, 'name')
  const description = stringField(parsed.data, 'description')
  if (name === undefined || description === undefined) {
    warn(`skill file ${path} ignored: frontmatter requires name and description`)
    return undefined
  }
  if (!isSkillName(name)) {
    warn(`skill file ${path} ignored: invalid skill name "${name}"`)
    return undefined
  }
  let invocation
  try {
    invocation = parseInvocationPolicy(parsed.data)
  } catch (error) {
    warn(`skill file ${path} ignored: invalid invocation frontmatter: ${String(error)}`)
    return undefined
  }
  return {
    name,
    description,
    ...optionalString(parsed.data, 'whenToUse'),
    invocation,
    ...optionalMetadata(parsed.data),
    path,
    content: parsed.body.trim(),
  }
}

function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } | undefined {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return undefined
  const firstLine = raw.slice(0, firstLineEnd).replace(/\r$/, '')
  if (firstLine !== '---') return undefined
  const start = firstLineEnd + 1
  const closing = findClosingFrontmatter(raw, start)
  if (closing === undefined) return undefined
  const yaml = raw.slice(start, closing.start)
  const parsed = parseYaml(yaml) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  return { data: parsed as Record<string, unknown>, body: raw.slice(closing.bodyStart) }
}

function findClosingFrontmatter(raw: string, start: number): { start: number; bodyStart: number } | undefined {
  let lineStart = start
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    const line = raw.slice(lineStart, lineEnd).replace(/\r$/, '')
    if (line === '---') {
      return { start: lineStart, bodyStart: nextNewline < 0 ? raw.length : nextNewline + 1 }
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalString(data: Record<string, unknown>, key: string): { [K in typeof key]?: string } {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? { [key]: value } : {}
}

function parseInvocationPolicy(data: Record<string, unknown>): SkillInvocationPolicy {
  rejectLegacyInvocationKey(data, 'disableModelInvocation', 'disable-model-invocation')
  rejectLegacyInvocationKey(data, 'modelInvocable', 'disable-model-invocation')
  rejectLegacyInvocationKey(data, 'userInvocable', 'user-invocable')
  const disableModelInvocation = frontmatterBoolean(data, 'disable-model-invocation')
  const userInvocable = frontmatterBoolean(data, 'user-invocable')
  return {
    modelInvocable: disableModelInvocation !== true,
    userInvocable: userInvocable !== false,
  }
}

function rejectLegacyInvocationKey(data: Record<string, unknown>, legacy: string, canonical: string): void {
  if (Object.hasOwn(data, legacy)) {
    throw new Error(`frontmatter field "${legacy}" is unsupported; use "${canonical}"`)
  }
}

function frontmatterBoolean(data: Record<string, unknown>, key: string): boolean | undefined {
  if (!Object.hasOwn(data, key)) return undefined
  const value = data[key]
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  if (typeof value === 'string') {
    switch (value.toLowerCase()) {
      case 'true':
      case 'yes':
      case 'on':
        return true
      case 'false':
      case 'no':
      case 'off':
        return false
    }
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`)
}

function optionalMetadata(data: Record<string, unknown>): { metadata?: Record<string, unknown> } {
  const value = data.metadata
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return { metadata: value as Record<string, unknown> }
  }
  return {}
}
