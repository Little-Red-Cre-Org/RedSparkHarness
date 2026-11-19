/**
 * Cordis catalog-specific projection over the compiler-independent Typert
 * model. This module owns Cordis validation and text projection mechanics;
 * callers supply repository-specific type classifications and inherited data.
 * @module @redspark/rsh-typert-generator
 */

import { WorkspaceAnalyzer, WorkspaceCaches } from './analyzer.ts'
import { childTypeNodeIds } from './model.ts'
import { TypeGraphRenderer } from './renderer.ts'
import type {
  FaceModel,
  MemberModel,
  ParameterModel,
  ServiceModel,
  SignatureModel,
  SourceLocation,
  SymbolId,
  TypeDeclarationModel,
  TypertFace,
  TypeNodeId,
} from './model.ts'

type Mode = 'emit' | 'bail' | 'waterfall' | 'parallel' | 'serial'

/** The fenced-block info string for generated signature blocks (skipped by
 * doc-typecheck, since a bare signature fragment is not standalone-compilable). */
const FENCE = 'ts cordis-catalog'

/** Append fail-closed signature type-link violations from the retained type tree. */
function checkTypeLinks(
  where: string,
  names: readonly string[],
  policy: CordisCatalogPolicy,
  violations: string[],
): void {
  for (const name of names) {
    if (Object.hasOwn(policy.linkedTypePages, name)
      || policy.foundationTypeNames.has(name)
      || Object.hasOwn(policy.typeLinkExemptions, name)) continue
    violations.push(
      `${where} references unclassified type '${name}'. Add it to linkedTypePages with its documentation page, `
      + 'to foundationTypeNames if TypeScript or the framework owns it, or to typeLinkExemptions with '
      + 'the non-catalog documentation owner.',
    )
  }
}

/** Throw one aggregated diagnostic for every unclassified signature type. */
function reportTypeLinkViolations(gate: string, violations: string[]): void {
  if (violations.length === 0) return
  throw new Error(
    `${gate}: ${violations.length} signature type-link coverage violation(s):\n`
    + violations.map(violation => `  ${violation}`).join('\n'),
  )
}

/** One harness event, extracted from an `interface Events` block. */
export interface EventEntry {
  /** Scoped name, e.g. `agent/request`. */
  name: string
  /** The scope prefix, e.g. `agent` (everything before the first `/`). */
  scope: string
  /** Full signature text (the method-signature member, JSDoc stripped). */
  signature: string
  /** Original declaration JSDoc, dedented from its containing interface. */
  jsDoc: string
  /** Dispatch mode from the `@mode` tag. */
  mode: Mode
  /** Description prose (JSDoc minus the `@mode` tag), one line per paragraph. */
  doc: string
  /** Source pointer `rsh/.file.ts:line` of the declaration. */
  source: string
}

/** One public service method and the source contract attached to it. */
export interface ServiceMethodEntry {
  /** Compiler member category; policy-supplied methods may omit it. */
  kind?: 'method' | 'property'
  /** Public method signature (body stripped). */
  signature: string
  /** Original method JSDoc, dedented from its containing class. */
  jsDoc: string
}

/** One harness service, extracted from an `interface Context` block. */
export interface ServiceEntry {
  /** The `ctx.<key>` name, e.g. `llm`. */
  key: string
  /** The service class/interface name, e.g. `LlmRuntime`. */
  type: string
  /** Whether the service class is abstract (a seam interface). */
  abstract: boolean
  /** Class-level JSDoc prose, one line per paragraph. */
  doc: string
  /** Public methods (bodies stripped), in source order. */
  methods: ServiceMethodEntry[]
  /** Base declaration names whose shapes complete inherited members. */
  inheritedTypes?: readonly string[]
  /** Source pointer of the class declaration. */
  source: string
}

/** A terse inherited-tier entry supplied by the catalog policy. */
export interface InheritedEntry {
  /** Display name of the inherited event or context member group. */
  name: string
  /** One-line description rendered into the catalog. */
  summary: string
  /** Source pointer such as `vendor/…:line`. */
  source: string
}

/** Repository policy consumed by the Cordis catalog parsing and rendering logic. */
export interface CordisCatalogPolicy {
  /** Type names linked from signatures to their documentation pages. */
  readonly linkedTypePages: Readonly<Record<string, string>>
  /** TypeScript or framework types that need no repository documentation link. */
  readonly foundationTypeNames: ReadonlySet<string>
  /** Repository types deliberately documented outside the linked data catalog. */
  readonly typeLinkExemptions: Readonly<Record<string, string>>
  /** Registered source packages used as Context Service Definitions and inherited projected Services. */
  readonly serviceDefinitionPackages?: readonly string[]
  /** Manually curated framework events inherited by every plugin. */
  readonly inheritedEvents: readonly InheritedEntry[]
  /** Manually curated framework context members inherited by every plugin. */
  readonly inheritedServices: readonly InheritedEntry[]
}

/** Complete model-level Cordis projection used by every text renderer. */
export interface CordisCatalogModel {
  readonly events: readonly EventEntry[]
  readonly services: readonly ServiceEntry[]
}

/** Repository-specific Cordis validation and projection over one Typert face. */
export class CordisCatalogProjector {
  private readonly renderer: TypeGraphRenderer

  /**
   * @param face - analyzed Host or Client face containing package business semantics.
   * @param policy - caller-owned type classifications and inherited Cordis data.
   */
  constructor(
    private readonly face: FaceModel,
    private readonly policy: CordisCatalogPolicy,
  ) {
    this.renderer = new TypeGraphRenderer(face.graph)
  }

  /**
   * Validate and project the host model's Cordis API.
   * @returns every validated service and event projected from the host model.
   */
  project(): CordisCatalogModel {
    return {
      events: this.collectEvents(),
      services: this.collectServices(),
    }
  }

  private collectEvents(): EventEntry[] {
    const entries: EventEntry[] = []
    const violations: string[] = []
    const typeLinkViolations: string[] = []
    for (const packageModel of this.face.packages) {
      for (const event of packageModel.events) {
        const parsed = parseJsDoc(event.jsDoc ?? '')
        if (parsed.deprecated) continue
        const source = pointer(event.location)
        const where = `event '${event.name}' (${source})`
        const node = this.renderer.node(event.signature)
        if (node.kind !== 'function') {
          violations.push(`${where} is not represented by a callable type.`)
          continue
        }
        if (this.face.face === 'host') {
          checkTypeLinks(where, signatureTypeNames(this.renderer, node.signature), this.policy, typeLinkViolations)
        }
        const mode = event.mode
        if (!isMode(mode)) {
          violations.push(`${where} is missing an @mode tag. Add '@mode emit|bail|waterfall|parallel|serial' to its JSDoc (see AGENTS.md).`)
        }
        const last = node.signature.parameters.at(-1)
        const hasNext = last?.name === 'next'
        if (isMode(mode) && hasNext && mode !== 'waterfall') {
          violations.push(`${where} has a trailing 'next' parameter (structurally a waterfall) but is tagged '@mode ${mode}'. Fix the tag or the signature.`)
        }
        if (isMode(mode) && !hasNext && mode === 'waterfall') {
          violations.push(`${where} is tagged '@mode waterfall' but has no trailing 'next' parameter. A waterfall delegates via next().`)
        }
        if (parsed.doc === '') {
          violations.push(`${where} has no description prose. Say what happened / what a listener may do, above the block tags.`)
        }
        checkParams(
          where,
          'event',
          node.signature.parameters,
          parsed.params,
          parameter => parameter.receiver || (hasNext && parameter === last),
          violations,
        )
        if (isMode(mode)) {
          entries.push({
            name: event.name,
            scope: event.name.split('/')[0] ?? event.name,
            signature: event.text,
            jsDoc: event.jsDoc ?? '',
            mode,
            doc: parsed.doc,
            source,
          })
        }
      }
    }
    reportViolations('gen-cordis-catalog', violations)
    reportTypeLinkViolations('gen-cordis-catalog', typeLinkViolations)
    return entries
  }

  /**
   * The services this projection describes, one per `ctx.<key>`: those whose
   * Context merge sits one level under a package's `src` and whose declaration
   * belongs to that same package.
   *
   * Interfaces qualify beside classes, because an interface-typed key
   * (`lsp: LspService`) has its Service Definition — and, by repository
   * convention, its member documentation — on the interface; requiring a class
   * would drop a real injectable service from every catalog. The declaration may
   * live in any file of the package (`types.ts` is the usual home), while a
   * declaration from ANOTHER package is not this package's surface to document.
   *
   * One key can have both kinds of candidate across packages: `ctx.typert` is
   * typed by a merge-extensible interface in `type-meta` and implemented by a
   * class in `registry`. The CLASS wins — it carries the documentation and is the
   * object a caller meets — and picking before validating is what keeps a
   * discarded candidate's missing JSDoc from failing the gate.
   */
  private renderableServices(): ServiceModel[] {
    const chosen = new Map<string, ServiceModel>()
    for (const packageModel of this.face.packages) {
      for (const service of packageModel.services) {
        const declaration = this.renderer.declaration(service.symbol)
        const owner = /^(?:.*\/)?src\//.exec(service.location.file)?.[0]
        const definitionPackage = service.symbol.slice(0, service.symbol.indexOf(':'))
        const importedDefinition = this.policy.serviceDefinitionPackages?.includes(definitionPackage) === true
        if ((declaration.kind !== 'class' && declaration.kind !== 'interface')
          || owner === undefined
          || (this.face.face === 'host'
            ? !/^(?:.*\/)?src\/[^/]+\.tsx?$/.test(service.location.file)
            : !/^(?:.*\/)?src\/client\/.+\.tsx?$/.test(service.location.file))
          || (!declaration.location.file.startsWith(owner) && !importedDefinition)) continue
        const current = chosen.get(service.key)
        if (current !== undefined && this.renderer.declaration(current.symbol).kind === 'class') continue
        chosen.set(service.key, service)
      }
    }
    return [...chosen.values()]
  }

  private collectServices(): ServiceEntry[] {
    const entries: ServiceEntry[] = []
    const violations: string[] = []
    const typeLinkViolations: string[] = []
    for (const service of this.renderableServices()) {
      const declaration = this.renderer.declaration(service.symbol)
      const parsedDeclaration = parseJsDoc(declaration.jsDoc ?? '')
      if (parsedDeclaration.deprecated) continue
      const doc = parsedDeclaration.doc
      const source = pointer(declaration.location)
      if (doc === '') {
        violations.push(`service ctx.${service.key} (${source}): ${declaration.kind} ${declaration.name} has no JSDoc.`)
      }
      const methods: ServiceMethodEntry[] = []
      const resolvedMembers = service.resolvedMembers ?? []
      const resolvedNames = new Set(resolvedMembers.map(member => member.name))
      const inheritedTypes = new Set<string>()
      const inheritedMembers = this.serviceMembers(declaration, service.members, new Set(), inheritedTypes)
      const members = [
        ...resolvedMembers,
        ...inheritedMembers.filter(member => !resolvedNames.has(member.name)),
      ]
      for (const member of members) {
        if (member.name.startsWith('[')) continue
        const inherited = /@inheritdoc\b/u.test(member.jsDoc ?? '')
          ? this.inheritedServiceMember(declaration, member, new Set()) : undefined
        const jsDoc = inherited?.jsDoc ?? member.jsDoc
        const parsed = parseJsDoc(jsDoc ?? '')
        if (parsed.deprecated) continue
        if (member.kind === 'property') {
          if (jsDoc === undefined) continue
          methods.push({ kind: 'property', signature: member.text || this.renderer.renderMember(member), jsDoc })
          continue
        }
        if (member.kind !== 'method') continue
        const where = `service method ctx.${service.key}.${member.name} (${pointer(member.location)})`
        if (this.face.face === 'host') {
          checkTypeLinks(where, signatureTypeNames(this.renderer, member.signature), this.policy, typeLinkViolations)
        }
        methods.push({ kind: 'method', signature: member.text || this.renderer.renderMember(member), jsDoc: jsDoc ?? '' })
        if (jsDoc === undefined) {
          violations.push(`${where} has no JSDoc.`)
          continue
        }
        if (parsed.doc === '') violations.push(`${where} has no description prose above its block tags.`)
        checkParams(where, 'service', member.signature.parameters, parsed.params,
          parameter => parameter.receiver, violations)
        checkReturns(where, member.signature, parsed.returns, this.renderer, violations)
      }
      entries.push({
        key: service.key,
        type: declaration.name,
        abstract: declaration.abstract,
        doc,
        methods,
        inheritedTypes: [...inheritedTypes].sort(),
        source,
      })
    }
    reportViolations('gen-cordis-catalog', violations)
    reportTypeLinkViolations('gen-cordis-catalog', typeLinkViolations)
    return entries.sort((left, right) => left.key.localeCompare(right.key))
  }

  private serviceMembers(declaration: TypeDeclarationModel, memberIds: readonly string[],
    visited = new Set<SymbolId>(), inheritedTypes = new Set<string>()): MemberModel[] {
    if (visited.has(declaration.id)) return []
    visited.add(declaration.id)

    const members = memberIds.map(memberId => this.renderer.member(memberId))
      .filter(member => member.name !== 'typertRemote')
    const names = new Set(members.map(member => member.name))
    for (const baseId of declaration.extends) {
      const base = this.renderer.node(baseId)
      if (base.kind !== 'reference' || base.target.kind !== 'declaration') continue
      const baseDeclaration = this.renderer.declaration(base.target.symbol)
      inheritedTypes.add(baseDeclaration.name)
      const inherited = this.serviceMembers(
        baseDeclaration,
        baseDeclaration.members.map(member => member.id),
        visited,
        inheritedTypes,
      )
      const inheritedNames = new Set(inherited.map(member => member.name))
      for (const name of inheritedNames) {
        if (names.has(name)) continue
        members.push(...inherited.filter(member => member.name === name))
        names.add(name)
      }
    }
    return members
  }

  private inheritedServiceMember(owner: TypeDeclarationModel, member: MemberModel,
    visited: Set<SymbolId>): MemberModel | undefined {
    if (visited.has(owner.id)) return undefined
    visited.add(owner.id)
    for (const baseId of [...owner.extends, ...owner.implements]) {
      const base = this.renderer.node(baseId)
      if (base.kind !== 'reference' || base.target.kind !== 'declaration') continue
      const declaration = this.renderer.declaration(base.target.symbol)
      const inherited = declaration.members.find(value => value.name === member.name && value.kind === member.kind)
      if (inherited !== undefined && !/@inheritdoc\b/u.test(inherited.jsDoc ?? '')) return inherited
      const ancestor = this.inheritedServiceMember(declaration, member, visited)
      if (ancestor !== undefined) return ancestor
    }
    return undefined
  }

}

/**
 * Analyze the host project once and return both the model and its projection.
 * @param scanRoot - workspace root containing `tsconfig.host.json`.
 * @param policy - caller-owned type classifications and inherited Cordis data.
 * @param targetFace - Host or Client Typert face to project.
 * @returns the configured projector and its validated catalog model.
 */
export function projectCordisCatalog(scanRoot: string, policy: CordisCatalogPolicy, targetFace: TypertFace = 'host'): {
  readonly projector: CordisCatalogProjector
  readonly model: CordisCatalogModel
} {
  const caches = new WorkspaceCaches()
  const discovery = new WorkspaceAnalyzer({
    root: scanRoot,
    faces: [targetFace],
    checkDiagnostics: false,
    caches,
    ...(policy.serviceDefinitionPackages === undefined ? {} : { serviceDefinitionPackages: policy.serviceDefinitionPackages }),
  }).discoverPackages(policy.serviceDefinitionPackages)
  for (const packageName of policy.serviceDefinitionPackages ?? []) {
    if (!discovery.some(candidate => candidate.package === packageName && candidate.faces.includes(targetFace))) {
      throw new Error(`gen-cordis-catalog: Service Definition package '${packageName}' is not registered for ${targetFace}`)
    }
  }
  const packages = discovery.filter(candidate => candidate.faces.includes(targetFace))
    .map(candidate => candidate.package)
  const workspace = new WorkspaceAnalyzer({
    root: scanRoot,
    faces: [targetFace],
    packages,
    checkDiagnostics: false,
    caches,
    ...(policy.serviceDefinitionPackages === undefined ? {} : { serviceDefinitionPackages: policy.serviceDefinitionPackages }),
  }).analyzeInBatches()
  const face = workspace.faces.find(candidate => candidate.face === targetFace)
  if (face === undefined) throw new Error(`gen-cordis-catalog: Typert produced no ${targetFace} face`)
  const projector = new CordisCatalogProjector(face, policy)
  return { projector, model: projector.project() }
}

/**
 * Collect all modeled events for relationship-document consumers.
 * @param scanRoot - workspace root containing `tsconfig.host.json`.
 * @param policy - caller-owned Cordis catalog policy.
 * @returns all validated event entries.
 */
export function collectEvents(scanRoot: string, policy: CordisCatalogPolicy): EventEntry[] {
  return [...projectCordisCatalog(scanRoot, policy).model.events]
}

/**
 * Collect all modeled services for relationship-document consumers.
 * @param scanRoot - workspace root containing `tsconfig.host.json`.
 * @param policy - caller-owned Cordis catalog policy.
 * @returns all validated service entries.
 */
export function collectServices(scanRoot: string, policy: CordisCatalogPolicy): ServiceEntry[] {
  return [...projectCordisCatalog(scanRoot, policy).model.services]
}

interface ParsedJsDoc {
  readonly doc: string
  readonly params: ReadonlyMap<string, string>
  readonly returns: string | null
  readonly throws: readonly string[]
  readonly deprecated: boolean
}

function parseJsDoc(raw: string): ParsedJsDoc {
  const lines = raw
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map(line => line.replace(/^\s*\*?\s?/, '').replace(/\s+$/, ''))
  const blocks: string[] = []
  let paragraph: string[] = []
  let list: string[] = []
  let item: string[] = []
  let inTags = false
  const join = (parts: readonly string[]): string => parts.join(' ').replace(/\s+/g, ' ').trim()
  const flushItem = (): void => {
    if (item.length > 0) list.push(join(item))
    item = []
  }
  const flushList = (): void => {
    flushItem()
    if (list.length > 0) blocks.push(list.join('\n'))
    list = []
  }
  const flushParagraph = (): void => {
    flushList()
    if (paragraph.length > 0) blocks.push(join(paragraph))
    paragraph = []
  }
  for (const line of lines) {
    const tagLine = line.trimStart()
    if (tagLine.startsWith('@')) {
      flushParagraph()
      inTags = true
      continue
    }
    if (inTags) continue
    if (line.trim() === '') {
      flushParagraph()
      continue
    }
    if (/^-\s+/.test(line)) {
      flushItem()
      if (paragraph.length > 0) {
        blocks.push(join(paragraph))
        paragraph = []
      }
      item.push(line)
      continue
    }
    if (item.length > 0) item.push(line)
    else paragraph.push(line)
  }
  flushParagraph()

  const params = new Map<string, string>()
  let returns: string | null = null
  const throws: string[] = []
  let deprecated = false
  let sink: ((text: string) => void) | undefined
  for (const line of lines) {
    if (/^@deprecated(?:\s|$)/.test(line)) {
      deprecated = true
      sink = undefined
      continue
    }
    const param = /^@param\s+(\[?[\w$]+\]?)\s*(?:[-—–]\s*)?(.*)$/.exec(line)
    if (param !== null) {
      const name = (param[1] ?? '').replace(/^\[|\]$/g, '')
      let value = param[2] ?? ''
      params.set(name, value)
      sink = (text) => {
        value = value === '' ? text : `${value} ${text}`
        params.set(name, value)
      }
      continue
    }
    const returnsTag = /^@returns?(?:\s+[-—–]?\s*(.*))?$/.exec(line)
    if (returnsTag !== null) {
      let value = returnsTag[1] ?? ''
      returns = value
      sink = (text) => {
        value = value === '' ? text : `${value} ${text}`
        returns = value
      }
      continue
    }
    const throwsTag = /^@throws?(?:\s+[-—–]?\s*(.*))?$/.exec(line)
    if (throwsTag !== null) {
      let value = throwsTag[1] ?? ''
      throws.push(value)
      const index = throws.length - 1
      sink = (text) => {
        value = value === '' ? text : `${value} ${text}`
        throws[index] = value
      }
      continue
    }
    if (line.startsWith('@') || line.trim() === '') sink = undefined
    else sink?.(line.trim())
  }
  return {
    doc: blocks.join('\n\n').replace(/\{@link\s+([^}]+)\}/g, '$1').trim(),
    params,
    returns,
    throws,
    deprecated,
  }
}

function checkParams(
  where: string,
  apiKind: string,
  parameters: readonly ParameterModel[],
  tags: ReadonlyMap<string, string>,
  isExempt: (parameter: ParameterModel) => boolean,
  violations: string[],
): void {
  for (const parameter of parameters) {
    if (parameter.binding !== 'identifier') {
      violations.push(`${where}: parameter '${parameter.name}' is a binding pattern; the ${apiKind} API needs simple identifier parameters so @param can name them.`)
      continue
    }
    if (isExempt(parameter)) continue
    const description = tags.get(parameter.name)
    if (description === undefined) violations.push(`${where} is missing @param ${parameter.name}.`)
    else if (description.trim() === '') violations.push(`${where}: @param ${parameter.name} has an empty description.`)
  }
  for (const tag of tags.keys()) {
    if (!parameters.some(parameter => parameter.binding === 'identifier' && parameter.name === tag)) {
      violations.push(`${where}: @param ${tag} does not match any parameter (stale tag?).`)
    }
  }
}

function checkReturns(
  where: string,
  signature: SignatureModel,
  returns: string | null,
  renderer: TypeGraphRenderer,
  violations: string[],
): void {
  const type = renderer.renderType(signature.returns)
  if (type === 'void' || type === 'Promise<void>') return
  if (returns === null) violations.push(`${where} is missing @returns (return type: ${type}).`)
  else if (returns.trim() === '') violations.push(`${where}: @returns has an empty description.`)
}

function reportViolations(gate: string, violations: readonly string[]): void {
  if (violations.length === 0) return
  throw new Error(
    `${gate}: ${String(violations.length)} JSDoc completeness violation(s) (see AGENTS.md):\n`
    + violations.map(violation => `  ${violation}`).join('\n'),
  )
}

function pointer(location: SourceLocation): string {
  return `${location.file}:${String(location.line)}`
}

function isMode(mode: string | undefined): mode is Mode {
  return mode === 'emit' || mode === 'bail' || mode === 'waterfall' || mode === 'parallel' || mode === 'serial'
}

function signatureTypeNames(renderer: TypeGraphRenderer, signature: SignatureModel): string[] {
  const names = new Set<string>()
  const visited = new Set<TypeNodeId>()
  const visitSignature = (current: SignatureModel): void => {
    for (const parameter of current.typeParameters) {
      if (parameter.constraint !== undefined) visit(parameter.constraint)
      if (parameter.default !== undefined) visit(parameter.default)
    }
    for (const parameter of current.parameters) visit(parameter.type)
    visit(current.returns)
  }
  const visitMember = (member: MemberModel): void => {
    if (member.kind === 'property') visit(member.type)
    else visitSignature(member.signature)
  }
  const visit = (id: TypeNodeId): void => {
    if (visited.has(id)) return
    visited.add(id)
    const node = renderer.node(id)
    if (node.kind === 'reference' && node.target.kind !== 'type-parameter') names.add(node.name)
    if (node.kind === 'type-query') names.add(node.expression)
    for (const child of childTypeNodeIds(node)) visit(child)
    if (node.kind === 'object') for (const member of node.members) visitMember(member)
    if (node.kind === 'function' || node.kind === 'constructor') visitSignature(node.signature)
  }
  visitSignature(signature)
  return [...names].sort()
}

/** Opening region delimiter; injected content lives between the pair and the page owns everything outside. */
export const REGION_BEGIN = '<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->'
/** Closing region delimiter matching {@link REGION_BEGIN}. */
export const REGION_END = '<!-- END GENERATED cordis-surface -->'

/**
 * Render the cross-link "Types:" line for a signature relative to one
 * subsystems page, or '' if none apply. A type whose primary page IS the
 * rendering page would link as a fragmentless self-link readers already sit
 * on, so it is dropped instead.
 */
function typeLinks(signature: string, onPage: string, linkedTypePages: Readonly<Record<string, string>>): string {
  const seen = new Set<string>()
  for (const name of Object.keys(linkedTypePages)) {
    if (new RegExp(`\\b${name}\\b`).test(signature)) seen.add(name)
  }
  const links = [...seen].sort()
    .filter(name => linkedTypePages[name] !== onPage)
    .map(name => `[${name}](${linkedTypePages[name]})`)
  if (links.length === 0) return ''
  return `Types: ${links.join(' · ')}`
}

/**
 * GitHub's heading-slug algorithm (lowercase; drop everything but letters,
 * numbers, spaces, hyphens; spaces become hyphens). Region headings carry
 * backticks and em-dashes, which VitePress slugifies differently, so each
 * generated heading is preceded by an explicit `<a id>` carrying this slug —
 * the historical flat-catalog anchor — making `#ctx<key>--<class>` fragments
 * resolve identically on GitHub and the published site.
 */
function githubSlug(heading: string): string {
  return heading.toLowerCase().replace(/[^\p{L}\p{N} -]/gu, '').replaceAll(' ', '-')
}

/** The explicit-anchor line emitted before one generated heading. */
function anchorFor(headingText: string): string[] {
  return [`<a id="${githubSlug(headingText)}"></a>`, '']
}

/** Render a subsystem `file:line` source pointer as a file-only link. */
function sourceLink(source: string): string {
  const [file = source] = source.split(':')
  const target = file.startsWith('rsh/') ? file.slice('rsh/'.length) : file
  return `[\`${file}\`](../../${target})`
}

/** Render one harness event entry onto its owning page, nested under its scope heading. */
function renderEvent(e: EventEntry, onPage: string, linkedTypePages: Readonly<Record<string, string>>): string[] {
  const out = [...anchorFor(`${e.name} — ${e.mode}`), `#### \`${e.name}\` — ${e.mode}`, '']
  if (e.doc) out.push(e.doc, '')
  out.push('```' + FENCE, e.jsDoc, e.signature, '```', '')
  const links = typeLinks(e.signature, onPage, linkedTypePages)
  if (links) out.push(links, '')
  out.push(`Source: ${sourceLink(e.source)}`, '')
  return out
}

/** Render one harness service entry onto its owning page. */
function renderService(s: ServiceEntry, onPage: string, linkedTypePages: Readonly<Record<string, string>>): string[] {
  const kind = s.abstract ? ' (abstract seam)' : ''
  const out = [...anchorFor(`ctx.${s.key} — ${s.type}${kind}`), `### \`ctx.${s.key}\` — \`${s.type}\`${kind}`, '']
  if (s.doc) out.push(s.doc, '')
  const methods = s.methods.filter(member => member.kind !== 'property')
  if (methods.length) {
    const declarations = methods.flatMap((method, index) => [
      ...(index > 0 ? [''] : []),
      method.jsDoc,
      method.signature,
    ])
    out.push('```' + FENCE, ...declarations, '```', '')
    const links = typeLinks(methods.map(method => method.signature).join('\n'), onPage, linkedTypePages)
    if (links) out.push(links, '')
  }
  out.push(`Source: ${sourceLink(s.source)}`, '')
  return out
}

/** The shared generated-file banner comment. */
const BANNER = [
  '<!-- Generated by rsh/Scripts/gen-cordis-catalog.ts — do not edit by hand.',
  '     Run `pnpm run gen-cordis-catalog` to regenerate. -->',
  '',
]

/** The shared GENERATED + freshness-gate + fence notice paragraph. */
const GATE_NOTICE = 'This file is GENERATED from source (`rsh/Scripts/gen-cordis-catalog.ts`) and verified fresh by `pnpm run verify-cordis-catalog` (part of `doc-sync`) — do not edit it by hand. Signature blocks use a `ts cordis-catalog` fence and include the original source JSDoc immediately before each event or service method. doc-typecheck skips these bare declaration fragments; type names in a signature link to the page that documents them.'

/**
 * Render one page's generated Cordis API region: the services mapped to
 * the page, then the event scopes mapped to it, markers included. Pure and
 * deterministic given sorted inputs; identical bytes land in both pair sides.
 * @param page - the owning `rsh/Docs/subsystems/` page basename, e.g. `core.md`.
 * @param services - validated services mapped to this page.
 * @param events - validated events whose scopes map to this page.
 * @param policy - type links supplied by the caller.
 * @returns the complete marker-delimited region text.
 */
export function renderPageRegion(page: string, services: ServiceEntry[], events: EventEntry[], policy: CordisCatalogPolicy): string {
  const lines: string[] = [
    REGION_BEGIN,
    '',
    '<a id="cordis-surface"></a>',
    '',
    '## Cordis API',
    '',
    'Generated from source by `rsh/Scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).',
    '',
  ]
  for (const s of services) lines.push(...renderService(s, page, policy.linkedTypePages))
  const scopes = [...new Set(events.map(e => e.scope))].sort()
  for (const scope of scopes) {
    lines.push(...anchorFor(`${scope}/* events`), `### \`${scope}/*\` events`, '')
    for (const e of events.filter(x => x.scope === scope).sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(...renderEvent(e, page, policy.linkedTypePages))
    }
  }
  while (lines.at(-1) === '') lines.pop()
  lines.push(REGION_END)
  return lines.join('\n')
}

/**
 * Render the inherited (pinned vendor) tier as its own generated page.
 * @param policy - inherited events and services supplied by the caller.
 * @returns the complete generated Markdown document.
 */
export function renderInheritedPage(policy: CordisCatalogPolicy): string {
  const lines: string[] = [
    ...BANNER,
    '# Inherited Cordis API',
    '',
    'The framework `ctx` members and events every plugin sees beyond the harness tier — pinned vendor source ([vendoring policy](../../Core/vendor/README.md)), summarized tersely so the harness pages stay focused on repository-owned vocabulary. Detailed Context, Fiber, Registry, and Service APIs are generated in [context.md](context.md), [fiber.md](fiber.md), [registry.md](registry.md), and [service.md](service.md); the event-dispatch methods in [events.md](events.md).',
    '',
    GATE_NOTICE,
    '',
    '## Inherited `ctx` members (cordis core + loader/hmr/timer)',
    '',
  ]
  for (const s of policy.inheritedServices) {
    const source = s.source.split(':')[0] as string
    lines.push(`- \`${s.name}\` — ${s.summary} ([\`${s.source}\`](../../${source.startsWith('rsh/') ? source.slice('rsh/'.length) : source}))`)
  }
  lines.push(
    '',
    '## Inherited events (cordis core + loader/hmr/timer)',
    '',
  )
  for (const e of policy.inheritedEvents) {
    const source = e.source.split(':')[0] as string
    lines.push(`- \`${e.name}\` — ${e.summary} ([\`${e.source}\`](../../${source.startsWith('rsh/') ? source.slice('rsh/'.length) : source}))`)
  }
  lines.push('')
  return lines.join('\n')
}
