const { execSync } = require('node:child_process')
const { readFileSync } = require('node:fs')
const root = 'D:/RedSparkHarness'
const all = execSync('git ls-files', { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n').filter(Boolean)

const probes = [
  ['package scope', /@deepseek-ai/],
  ['env DSH_', /(?<![A-Za-z])DSH_[A-Z]/],
  ['display name', /DeepSeek Harness|deepseek-harness|DeepSeekHarness/],
  ['camel ident', /\b[A-Za-z_][A-Za-z0-9_]*[Dd]sh[A-Z][A-Za-z0-9_]*\b/],
]

for (const [label, re] of probes) {
  const live = []
  const kept = []
  let liveHits = 0
  for (const file of all) {
    let text
    try {
      text = readFileSync(`${root}/${file}`, 'utf8')
    } catch {
      continue
    }
    if (!re.test(text)) continue
    const hits = (text.match(new RegExp(re.source, 'g')) ?? []).length
    const isHistory = file.startsWith('.agents/') || file.startsWith('.github/pr-evidence/')
    const isKept = file === 'rsh/Core/util/home-paths/src/index.ts'
      || file.startsWith('LICENSE')
      || file === 'rsh/Scripts/rename-to-redspark.ts'
      || file === 'LICENSING.md'
      || file === 'THIRD_PARTY_NOTICES.md'
    if (isHistory || isKept) kept.push(file)
    else {
      live.push(file)
      liveHits += hits
    }
  }
  console.log(`${label}: live ${liveHits} hits / ${live.length} files | kept ${kept.length} files`)
  for (const f of live.slice(0, 10)) console.log('    live:', f)
}
