import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = process.cwd()

const prefixEntries = [
  ['packages/attachment', 'rsh/Modules/Official/attachment'],
  ['packages/automation', 'rsh/Modules/Official/automation'],
  ['packages/code-runtime', 'rsh/Modules/Official/code-runtime'],
  ['packages/credentials', 'rsh/Modules/Official/credentials'],
  ['packages/extensions', 'rsh/Modules/Official/extensions'],
  ['packages/feedback', 'rsh/Modules/Official/feedback'],
  ['packages/guard', 'rsh/Modules/Official/guard'],
  ['packages/interaction', 'rsh/Modules/Official/interaction'],
  ['packages/runtime-diagnostics', 'rsh/Core/runtime-diagnostics'],
  ['packages/experimental', 'rsh/Modules/Community/experimental'],
  ['packages/test-support', 'rsh/Tests/test-support'],
  ['packages/session-query', 'rsh/Engine/session-query'],
  ['packages/identity', 'rsh/Core/identity'],
  ['packages/subprocess', 'rsh/Core/subprocess'],
  ['packages/storage', 'rsh/Core/storage'],
  ['packages/typert', 'rsh/Core/typert'],
  ['packages/compaction', 'rsh/Engine/compaction'],
  ['packages/context', 'rsh/Engine/context'],
  ['packages/subagent', 'rsh/Engine/subagent'],
  ['packages/workflow', 'rsh/Engine/workflow'],
  ['packages/session', 'rsh/Engine/session'],
  ['packages/preset', 'rsh/Engine/preset'],
  ['packages/schedule', 'rsh/Engine/schedule'],
  ['packages/goal', 'rsh/Engine/goal'],
  ['packages/jobs', 'rsh/Engine/jobs'],
  ['packages/llm', 'rsh/Engine/llm'],
  ['packages/core', 'rsh/Engine/core'],
  ['packages/util', 'rsh/Core/util'],
  ['packages/webhook', 'rsh/Modules/Official/webhook'],
  ['packages/workspace', 'rsh/Modules/Official/workspace'],
  ['packages/terminal', 'rsh/Modules/Official/terminal'],
  ['packages/todo', 'rsh/Modules/Official/todo'],
  ['packages/spill', 'rsh/Modules/Official/spill'],
  ['packages/skill', 'rsh/Modules/Official/skill'],
  ['packages/shell', 'rsh/Modules/Official/shell'],
  ['packages/settings', 'rsh/Modules/Official/settings'],
  ['packages/sandbox', 'rsh/Modules/Official/sandbox'],
  ['packages/plan', 'rsh/Modules/Official/plan'],
  ['packages/mcp', 'rsh/Modules/Official/mcp'],
  ['packages/lsp', 'rsh/Modules/Official/lsp'],
  ['packages/fs', 'rsh/Modules/Official/fs'],
  ['packages/e2b', 'rsh/Modules/Official/e2b'],
  ['packages/hooks', 'rsh/Modules/Official/hooks'],
  ['packages/web', 'rsh/Modules/Official/web'],
  ['packages/attachment', 'rsh/Modules/Official/attachment'],
  ['packages/boot', 'rsh/Compatibility/DSH/boot'],
  ['packages/bundle', 'rsh/Compatibility/DSH/bundle'],
  ['packages/sdk', 'rsh/Programs/SDK/packages'],
  ['packages/acp', 'rsh/Programs/ACP/packages'],
  ['packages/api', 'rsh/Programs/Web/api'],
  ['packages/host', 'rsh/Programs/Web/host'],
  ['packages/client', 'rsh/Programs/Web/client'],
  ['apps/cli', 'rsh/Programs/CLI'],
  ['apps/web', 'rsh/Programs/Web/application'],
  ['apps/desktop-host', 'rsh/Programs/DesktopHost'],
  ['apps/desktop', 'rsh/Programs/Desktop'],
  ['python', 'rsh/Programs/SDK/python'],
  ['vendor', 'rsh/Core/vendor'],
  ['native', 'rsh/Core/native'],
  ['benchmarks', 'rsh/Tests/benchmarks'],
  ['website', 'rsh/Docs/website'],
  ['scripts', 'rsh/Scripts'],
  ['docs', 'rsh/Docs'],
  ['apps', 'rsh/Programs'],
  ['packages', 'rsh'],
]

const prefixes = prefixEntries.map(([oldPrefix, newPrefix]) => ({ oldPrefix, newPrefix }))
const prefixesByOldPath = [...prefixes].sort(({ oldPrefix: left }, { oldPrefix: right }) => right.length - left.length)
const prefixesByNewPath = [...prefixes].sort(({ newPrefix: left }, { newPrefix: right }) => right.length - left.length)

const oldFiles = new Set(
  execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean),
)
const oldDirectories = new Set()
for (const file of oldFiles) {
  let current = path.posix.dirname(file)
  while (current !== '.') {
    oldDirectories.add(current)
    current = path.posix.dirname(current)
  }
}

function mapOldPath(oldPath) {
  for (const { oldPrefix, newPrefix } of prefixesByOldPath) {
    if (oldPath === oldPrefix || oldPath.startsWith(oldPrefix + '/')) {
      return newPrefix + oldPath.slice(oldPrefix.length)
    }
  }
  return oldPath
}

function inversePath(newPath) {
  for (const { oldPrefix, newPrefix } of prefixesByNewPath) {
    if (newPath === newPrefix || newPath.startsWith(newPrefix + '/')) {
      return oldPrefix + newPath.slice(newPrefix.length)
    }
  }
  return newPath
}

function isKnownOldPath(candidate) {
  return oldFiles.has(candidate) || oldDirectories.has(candidate)
}

function mapKnownOldPath(candidate) {
  if (isKnownOldPath(candidate)) return mapOldPath(candidate)
  let ancestor = candidate
  while (ancestor !== '.') {
    ancestor = path.posix.dirname(ancestor)
    if (isKnownOldPath(ancestor)) {
      const suffix = candidate.slice(ancestor.length)
      return mapOldPath(ancestor) + suffix
    }
  }
  return undefined
}

function rewriteRelativeReferences(text, oldFile, newFile) {
  const directory = path.posix.dirname(oldFile)
  const newDirectory = path.posix.dirname(newFile)
  return text.replace(
    /(?<![A-Za-z0-9_\\])(?:\.\.?\/)+[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.*{}[\]-]+)*(?:#[A-Za-z0-9_./-]+)?/g,
    (match) => {
      const anchorIndex = match.indexOf('#')
      const reference = anchorIndex === -1 ? match : match.slice(0, anchorIndex)
      const anchor = anchorIndex === -1 ? '' : match.slice(anchorIndex)
      const candidate = path.posix.normalize(path.posix.join(directory, reference))
      const mapped = mapKnownOldPath(candidate)
      if (!mapped) return match
      const relative = path.posix.relative(newDirectory, mapped) || '.'
      const rendered = relative === '.' ? './' : relative
      const withCurrentPrefix = reference.startsWith('./') && !rendered.startsWith('.') ? `./${rendered}` : rendered
      return withCurrentPrefix + anchor
    },
  )
}

function rewriteRootReferences(text, oldFile, newFile) {
  return text.replace(
    /(?<![A-Za-z0-9_/.:-])(?:packages|apps|vendor|native|benchmarks|docs|scripts|website|python)(?:\/[A-Za-z0-9_@.*{}?=-]+)+/g,
    (match) => {
      const mapped = mapOldPath(match)
      return mapped === match ? match : mapped
    },
  )
}

function isTextFile(file) {
  return /\.(?:cjs|css|cts|html|js|json|md|mjs|mts|ts|tsx|txt|yaml|yml)$/i.test(file)
}

const files = []
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.dsh-build') continue
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) collect(absolute)
    else files.push(absolute)
  }
}
collect(root)

let changed = 0
for (const absolute of files) {
  const newFile = path.relative(root, absolute).split(path.sep).join('/')
  // Archived Agent Notes are frozen historical records. Their links retain
  // the repository layout that existed when the decision was recorded.
  if (newFile.startsWith('.agents/notes/archived/')) continue
  const oldFile = inversePath(newFile)
  if (!oldFiles.has(oldFile) || !isTextFile(newFile)) continue
  const before = fs.readFileSync(absolute, 'utf8')
  const after = rewriteRootReferences(rewriteRelativeReferences(before, oldFile, newFile), oldFile, newFile)
  if (after === before) continue
  fs.writeFileSync(absolute, after)
  changed += 1
}

console.log(JSON.stringify({ changed }))
