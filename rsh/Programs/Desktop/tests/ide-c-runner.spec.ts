/** Real compiler checks for interactive tasks and rejected source edits. */
import { it, expect, type TestContext } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cRunner } from '../src/ide-c-runner.ts'

const compilers = [
  { language: 'c', compiler: process.env.RSH_TEST_CC ?? 'gcc', source: '#include <stdio.h>\nint main(void) { int n; if(scanf("%d", &n)!=1) return 1; printf("received=%d\\n", n); return 0; }' },
  { language: 'cpp', compiler: process.env.RSH_TEST_CXX ?? 'g++', source: '#include <iostream>\nint main() { int n; std::cin >> n; std::cout << "received=" << n << std::endl; }' },
]

it.for(compilers)('$language task uses the new build and interactive stdin', async ({ language, compiler, source }: typeof compilers[number], context: TestContext) => {
  if (spawnSync(compiler, ['--version']).status !== 0) { context.skip(); return }
  const root = await mkdtemp(join(tmpdir(), 'rsh compiled test '))
  try {
    const file = join(root, `main.${language}`)
    const script = join(root, 'runner.cjs')
    await writeFile(script, cRunner)
    await writeFile(file, source)
    await writeFile(join(root, 'main.exe'), 'existing user artifact')
    const execute = () => spawnSync(process.execPath, [script, file, compiler, 'Compiler missing'], {
      cwd: root, input: '42\n', encoding: 'utf8', timeout: 20000,
    })
    const result = execute()
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('received=42')
    await writeFile(file, 'not valid source code')
    const failed = execute()
    expect(failed.error).toBeUndefined()
    expect(failed.status).not.toBe(0)
    expect(failed.stdout).not.toContain('received=')
    expect(failed.stderr).toContain(`main.${language}`)
    expect(await readFile(join(root, 'main.exe'), 'utf8')).toBe('existing user artifact')
  } finally { await rm(root, { recursive: true, force: true }) }
}, 30000)
