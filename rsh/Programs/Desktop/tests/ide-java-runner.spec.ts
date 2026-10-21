/** Real JDK coverage for interactive execution and compile-failure isolation. */
import { it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { javaRunner } from '../src/ide-java-runner.ts'

const hasJdk = spawnSync('javac', ['-version']).status === 0

it.skipIf(!hasJdk).each([true, false])('Java task uses fresh compilation, valid=%s', async (valid) => {
  const root = await mkdtemp(join(tmpdir(), 'rsh java test '))
  try {
    const file = join(root, 'Demo.java')
    const script = join(root, 'runner.cjs')
    await writeFile(script, javaRunner)
    await writeFile(join(root, 'Demo.class'), 'existing user artifact')
    await writeFile(file, valid
      ? 'package example; public class Demo { public static void main(String[] args) { System.out.print("请输入："); int n = new java.util.Scanner(System.in).nextInt(); System.out.println("结果=" + (n * 24)); } }'
      : 'public class Demo { this is not valid Java; }')
    const result = spawnSync(process.execPath, [script, file, 'java', 'javac', 'JDK missing'], {
      cwd: root, input: '5\n', encoding: 'utf8', timeout: 20000,
    })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(valid ? 0 : 1)
    if (valid) expect(result.stdout).toContain('请输入：结果=120')
    else { expect(result.stderr).toContain('Demo.java'); expect(result.stdout).not.toContain('结果=') }
    expect(await readFile(join(root, 'Demo.class'), 'utf8')).toBe('existing user artifact')
  } finally { await rm(root, { recursive: true, force: true }) }
}, 30000)
