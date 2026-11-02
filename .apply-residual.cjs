const { execSync } = require('node:child_process')
const { readFileSync, writeFileSync, existsSync } = require('node:fs')
const root = 'D:/RedSparkHarness'

const KEEP = new Set([
  'rsh/Core/util/home-paths/src/index.ts',
  'rsh/Scripts/rename-to-redspark.ts',
  'LICENSE', 'LICENSING.md', 'LICENSE-UPSTREAM-MIT.txt',
  'THIRD_PARTY_NOTICES.md', 'rsh/Core/vendor/README.md',
  'README.md', 'README.zh.md',
])

const files = execSync('git ls-files', { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 })
  .split('\n')
  .filter(Boolean)
  .filter((f) => !f.startsWith('.agents/') && !f.startsWith('.github/pr-evidence/'))
  .filter((f) => !KEEP.has(f))

const rules = [
  [/@deepseek-ai\/dsh-typert-generator/g, '@redspark/rsh-typert-generator'],
  [/@deepseek-ai\/cordis/g, '@redspark/cordis'],
  [/@deepseek-ai\//g, '@redspark/'],
  [/@deepseek-ai\b/g, '@redspark'],
  [/deepseek_harness_runtime/g, 'redspark_harness_runtime'],
  [/deepseek_harness/g, 'redspark_harness'],
  [/deepseek-harness-sdk-runtime/g, 'redspark-harness-sdk-runtime'],
  [/\bdeepseek-harness\b/g, 'redspark-harness'],
  [/\bDeepSeek Harness\b/g, 'RedSpark Harness'],
  [/\bDeepSeekHarness\b/g, 'RedSparkHarness'],
  [/__DSH_/g, '__RSH_'],
  [/\bDSH_/g, 'RSH_'],
]

let changed = 0
const touched = []
for (const file of files) {
  const abs = `${root}/${file}`
  if (!existsSync(abs)) continue
  if (!/\.(ts|tsx|mts|cts|mjs|cjs|js|json|jsonl|yml|yaml|md|html|css|patch|txt|ps1|sh|py|cmd|toml|lock|in|cfg)$/.test(file)) continue
  let text
  try {
    text = readFileSync(abs, 'utf8')
  } catch {
    continue
  }
  let next = text
  for (const [re, to] of rules) next = next.replace(re, to)
  if (next === text) continue
  writeFileSync(abs, next, 'utf8')
  changed += 1
  touched.push(file)
}
console.log('files rewritten:', changed)
for (const f of touched) console.log(' ', f)
