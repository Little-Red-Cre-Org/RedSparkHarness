/** Native Host Consumer for the durable skill catalog and exact skill loader. */
import { createHash } from 'node:crypto'
import type { NativeContext, NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { createUserMessage } from '@deepseek-ai/dsh-llm/native'
import type { ToolSchema, UserMessage } from '@deepseek-ai/dsh-llm/native'
import type { JsonSchemaNode } from '@deepseek-ai/dsh-native-tools/json-schema'
import type { NativeToolRegistration, NativeValueToolContribution } from '@deepseek-ai/dsh-native-tools'
import type { NativeRequestContextProvider, NativeRequestContextRequest } from '@deepseek-ai/dsh-request-context-definition'
import type { NativeSkills } from '@deepseek-ai/dsh-skill/native'
import { NativeRequestContextProviderId } from '@deepseek-ai/dsh-request-context-definition'
import {
  escapeText,
  isModelInvocable,
  isSkillName,
  isUserInvocable,
  renderSkillContent,
} from '@deepseek-ai/dsh-skill/shared'
import type { SkillDefinition, SkillInvocationSource, SkillResourceBase, SkillSummary } from '@deepseek-ai/dsh-skill/types'
import type { SkillCatalogSource } from './types.ts'
import type {} from '@deepseek-ai/dsh-native-tools/native'
import type {} from '@deepseek-ai/dsh-skill/native'
export type { SkillCatalogSource } from './types.ts'

const PROVIDER_ID = NativeRequestContextProviderId('dsh-tool-skill')
const PROVIDER_ORDER = 100
const DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH = 500

const skillToolSchema: ToolSchema = {
  name: 'skill',
  description: 'Load the full instructions for an available skill. Call this with the exact skill name from the session skill catalog before acting on a task that names or clearly matches the skill.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    properties: {
      name: { type: 'string', description: 'The exact skill name from the available skills list.' },
    },
  },
}

const skillOutputSchema: JsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'provider', 'content'],
  properties: {
    name: { type: 'string' },
    provider: { type: 'string' },
    resourceBase: {
      oneOf: [
        { type: 'object', additionalProperties: false, required: ['kind', 'path'], properties: {
          kind: { type: 'string', const: 'directory' }, path: { type: 'string' },
        } },
        { type: 'object', additionalProperties: false, required: ['kind', 'url'], properties: {
          kind: { type: 'string', const: 'url' }, url: { type: 'string' },
        } },
        { type: 'object', additionalProperties: false, required: ['kind', 'description'], properties: {
          kind: { type: 'string', const: 'opaque' }, description: { type: 'string' },
        } },
      ],
    },
    content: { type: 'string' },
  },
}

interface ResolvedConfig {
  readonly catalogDescriptionMaxLength: number
}

/** Native Host Consumer; its request-context registration records catalog and invocation messages durably. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-tool-skill',
  targets: ['host'],
  requires: ['skills', 'tools', 'requestContexts'],
  provides: [],
  resolve(input) {
    const config = resolveConfig(input)
    return (context: NativeContext) => { install(context, config) }
  },
}

function install(context: NativeContext, config: ResolvedConfig): void {
  const skills = context.require('skills')
  const tools = context.require('tools')
  const requestContexts = context.require('requestContexts')
  const tool: NativeValueToolContribution = {
    schema: skillToolSchema,
    output: {
      schema: skillOutputSchema,
      render(_call, value) {
        return { content: [{ type: 'text', text: renderSkillContent(skillOutputValue(value)) }], isError: false }
      },
    },
    async execute(call) {
      const name = skillNameArgument(call.arguments)
      const options = { scope: call.agent.scope, cwd: call.session.header.cwd, signal: call.signal }
      const summary = (await skills.list(options)).find(item => item.name === name)
      if (summary === undefined) throw new Error(`skill "${name}" is unknown or no longer available`)
      if (!isModelInvocable(summary)) throw new Error(`skill "${name}" is not available for model invocation`)
      const skill = await skills.get(name, options)
      if (skill === undefined) throw new Error(`skill "${name}" is unknown or no longer available`)
      if (!isModelInvocable(skill)) throw new Error(`skill "${name}" is not available for model invocation`)
      return skillToolValue(skill)
    },
  }
  const toolRegistration = tools.registerValueTool(tool, context.scope)
  context.effect(toolRegistration)
  const provider: NativeRequestContextProvider = {
    id: PROVIDER_ID,
    order: PROVIDER_ORDER,
    prepare: request => prepareSkillContext(request, skills, toolRegistration, config),
  }
  context.effect(requestContexts.register(context.scope, provider))
}

async function prepareSkillContext(
  request: NativeRequestContextRequest,
  skills: NativeSkills,
  toolRegistration: NativeToolRegistration,
  config: ResolvedConfig,
): Promise<{ readonly messages: readonly UserMessage[]; commit(): void }> {
  request.signal.throwIfAborted()
  const history = catalogHistory(request)
  const messages: UserMessage[] = []
  const toolVisible = request.toolVisibility.includes(toolRegistration)
  if (toolVisible) {
    const snapshot = await skills.snapshot({ scope: request.scope, cwd: request.owner.session.header.cwd, signal: request.signal })
    request.signal.throwIfAborted()
    if (snapshot.complete) {
      const entries = catalogEntries(snapshot.skills.filter(isModelInvocable), config.catalogDescriptionMaxLength)
      const digest = digestEntries(entries)
      if (history.visibleDigest !== digest && (history.published || entries.length > 0)) {
        messages.push(history.published ? renderCatalogUpdate(entries) : renderCatalogMessage(entries))
      }
    }
  } else if (history.published && history.visibleDigest !== digestEntries([])) {
    messages.push(renderCatalogUpdate([]))
  }

  for (const name of invokedSkillNames(request.inputs)) {
    request.signal.throwIfAborted()
    const skill = await skills.get(name, {
      scope: request.scope,
      cwd: request.owner.session.header.cwd,
      signal: request.signal,
    })
    request.signal.throwIfAborted()
    if (skill === undefined || !isUserInvocable(skill)) continue
    const source: SkillInvocationSource = { kind: 'skill-invocation', name, form: 'instructions' }
    messages.push(createUserMessage({ content: [{ type: 'text', text: renderSkillContent(skill) }], source }))
  }
  return { messages, commit() {} }
}

function catalogEntries(skills: readonly SkillSummary[], maxLength: number): SkillCatalogSource['entries'] {
  return skills.map(skill => ({ name: skill.name, description: catalogDescription(skill.description, maxLength) }))
}

function renderCatalogMessage(entries: SkillCatalogSource['entries']): UserMessage {
  return createUserMessage({
    content: [{
      type: 'text',
      text: [
        '<system-reminder>',
        'A skill is a reusable set of task-specific instructions. The following skills are available in this session:',
        '',
        '<available_skills>',
        ...renderCatalogEntries(entries),
        '</available_skills>',
        '',
        "If the user names a skill, or the task clearly matches a skill's description, call the `skill` tool with the exact skill name before taking task actions. Load all applicable skills, then follow their full instructions. This catalog contains summaries only; do not infer or follow a skill's instructions until it has been loaded.",
        'A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the `skill` tool again for that skill.',
        '</system-reminder>',
      ].join('\n'),
    }],
    source: { kind: 'skill-catalog', form: 'catalog', entries },
  })
}

function renderCatalogUpdate(entries: SkillCatalogSource['entries']): UserMessage {
  const availability = entries.length === 0
    ? [
      'No skills are currently available through the `skill` tool. Do not use names from earlier skill catalogs.',
      'A user may still invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the `skill` tool for it.',
    ]
    : [
      'Use only names in this replacement catalog. If the user names a listed skill, or the task clearly matches its description, call the `skill` tool with the exact name before acting.',
      'A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the `skill` tool again for that skill.',
    ]
  return createUserMessage({
    content: [{
      type: 'text',
      text: [
        '<system-reminder>',
        'The available skill catalog changed. This complete catalog replaces every earlier available-skills list in this session:',
        '',
        '<available_skills>',
        ...renderCatalogEntries(entries),
        '</available_skills>',
        '',
        ...availability,
        '</system-reminder>',
      ].join('\n'),
    }],
    source: { kind: 'skill-catalog', form: 'catalog', update: true, entries },
  })
}

function renderCatalogEntries(entries: SkillCatalogSource['entries']): string[] {
  return entries.map(entry => `- \`${entry.name}\`: ${escapeText(entry.description)}`)
}

function digestEntries(entries: SkillCatalogSource['entries']): string {
  const canonical = entries.map(entry => JSON.stringify([entry.name, entry.description])).join('\n')
  return createHash('sha256').update(canonical).digest('hex')
}

function catalogHistory(request: NativeRequestContextRequest): { readonly visibleDigest?: string; readonly published: boolean } {
  const visible = new Set(request.owner.session.surface.nodes)
  let published = false
  for (let index = request.durableEvents.length - 1; index >= 0; index -= 1) {
    const event = request.durableEvents[index]
    if (event?.type !== 'user/message' || event.data.source.kind !== 'skill-catalog') continue
    const entries = readCatalogEntries(event.data.source)
    if (entries === undefined) continue
    const digest = digestEntries(entries)
    published = true
    if (visible.has(event.seq)) return { visibleDigest: digest, published }
  }
  return { published }
}

function readCatalogEntries(source: unknown): SkillCatalogSource['entries'] | undefined {
  if (typeof source !== 'object' || source === null) return undefined
  const entries = (source as { entries?: unknown }).entries
  if (!Array.isArray(entries)) return undefined
  const readable: { name: string; description: string }[] = []
  for (const entry of entries as readonly unknown[]) {
    if (typeof entry !== 'object' || entry === null) return undefined
    const { name, description } = entry as { name?: unknown; description?: unknown }
    if (typeof name !== 'string' || name.length === 0 || typeof description !== 'string') return undefined
    readable.push({ name, description })
  }
  return readable
}

function catalogDescription(value: string, maxLength: number): string {
  const normalized = value.replaceAll(/\s+/g, ' ').trim()
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`
}

const SKILL_GESTURE = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g

function invokedSkillNames(messages: readonly UserMessage[]): string[] {
  const names: string[] = []
  for (const message of messages) {
    if (message.source.kind !== 'user') continue
    for (const block of message.content) {
      if (block.type !== 'text') continue
      for (const match of block.text.matchAll(SKILL_GESTURE)) {
        const name = match[2]
        if (name !== undefined && !names.includes(name)) names.push(name)
      }
    }
  }
  return names
}

function skillNameArgument(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('skill tool arguments must be an object')
  const name = (value as { name?: unknown }).name
  if (typeof name !== 'string' || !isSkillName(name)) throw new Error(`invalid skill name "${String(name)}"`)
  return name
}

interface SkillToolValue {
  readonly name: string
  readonly provider: string
  readonly resourceBase?: SkillResourceBase
  readonly content: string
}

function skillToolValue(skill: SkillDefinition): SkillToolValue {
  return {
    name: skill.name,
    provider: skill.provider,
    ...skill.resourceBase === undefined ? {} : { resourceBase: { ...skill.resourceBase } },
    content: skill.content,
  }
}

function skillOutputValue(value: unknown): Pick<SkillDefinition, 'name' | 'provider' | 'resourceBase' | 'content'> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('skill tool result must be an object')
  const result = value as Record<string, unknown>
  const { name, provider, resourceBase, content } = result
  if (typeof name !== 'string' || typeof provider !== 'string' || typeof content !== 'string') {
    throw new Error('skill tool result is missing required text fields')
  }
  if (resourceBase === undefined) return { name, provider, content }
  if (typeof resourceBase !== 'object' || resourceBase === null || Array.isArray(resourceBase)) {
    throw new Error('skill tool result has invalid resource guidance')
  }
  const base = resourceBase as Record<string, unknown>
  switch (base.kind) {
    case 'directory':
      if (typeof base.path === 'string') return { name, provider, content, resourceBase: { kind: 'directory', path: base.path } }
      break
    case 'url':
      if (typeof base.url === 'string') return { name, provider, content, resourceBase: { kind: 'url', url: base.url } }
      break
    case 'opaque':
      if (typeof base.description === 'string') return { name, provider, content, resourceBase: { kind: 'opaque', description: base.description } }
      break
  }
  throw new Error('skill tool result has invalid resource guidance')
}

function resolveConfig(input: unknown): ResolvedConfig {
  if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
    throw new Error('tool-skill: configuration must be an object')
  }
  const fields = input as Record<string, unknown> | undefined
  if (Object.keys(fields ?? {}).some(key => key !== 'catalogDescriptionMaxLength')) {
    throw new Error('tool-skill: unknown configuration field')
  }
  const value = fields?.catalogDescriptionMaxLength === undefined
    ? DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH
    : fields.catalogDescriptionMaxLength
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 3) {
    throw new Error('tool-skill: catalogDescriptionMaxLength must be an integer greater than or equal to 3')
  }
  return { catalogDescriptionMaxLength: value }
}
