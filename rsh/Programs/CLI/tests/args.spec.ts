import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseRshArgs } from '../src/args.ts'

const parse = (argv: string[]) => parseRshArgs(argv, '1.2.3')

/** Capture the process exit code while muting Commander's output. */
function exitCode(argv: string[]): number {
  return exitResult(argv).code
}

function exitResult(argv: string[]): { code: number; stderr: string } {
  let stderr = ''
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderr += String(chunk)
    return true
  })
  try {
    parse(argv)
    throw new Error(`expected ${JSON.stringify(argv)} to exit`)
  } catch {
    return { code: exit.mock.calls.at(-1)?.[0] as number, stderr }
  } finally {
    vi.restoreAllMocks()
  }
}

afterEach(() => { vi.restoreAllMocks() })

describe('parseRshArgs', () => {
  it('routes profile boots, handing the rest to the app', () => {
    expect(parse(['--profile', 'tui'])).toEqual({ mode: 'profile', profile: 'tui', patches: [], args: [] })
    expect(parse(['--profile', 'tui', '--patch', 'a.yml', '--patch', 'b.yml']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: ['a.yml', 'b.yml'], args: [] })
    expect(parse(['--profile', 'rescue', '--from-default-profile', 'native-web']))
      .toEqual({ mode: 'profile', profile: 'rescue', fromDefaultProfile: 'native-web', patches: [], args: [] })
  })

  it('refuses the retired web profile name and alias', () => {
    expect(exitResult(['--profile', 'web']).stderr).toContain('profile "web" is retired')
    expect(exitResult(['--profile', 'web']).stderr).toContain('--profile native-web')
    expect(exitResult(['--profile', 'rescue', '--from-default-profile', 'web']).stderr)
      .toContain('--from-default-profile "web" is retired')
    // `web` is no longer a command, so the root parser rejects it as a missing profile.
    expect(exitCode(['web'])).toBe(1)
  })

  it('ends the launcher flags at the first token it does not own', () => {
    // App flags, including its -h, and positionals reach the app verbatim.
    expect(parse(['--profile', 'tui', '--resume', 'abc']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: [], args: ['--resume', 'abc'] })
    expect(parse(['--profile', 'native-web', '-h']))
      .toEqual({ mode: 'profile', profile: 'native-web', patches: [], args: ['-h'] })
    expect(parse(['--profile', 'native-web', '--host', '127.0.0.1', '--port', '8080', '--no-open', '--future-web-flag']))
      .toEqual({ mode: 'profile', profile: 'native-web', patches: [], args: ['--host', '127.0.0.1', '--port', '8080', '--no-open', '--future-web-flag'] })
    expect(parse(['--profile', 'headless', 'run', 'the', 'tests']))
      .toEqual({ mode: 'profile', profile: 'headless', patches: [], args: ['run', 'the', 'tests'] })
    // Launcher flags placed after that boundary belong to the app too.
    expect(parse(['--profile', 'tui', '--patch', 'a.yml', '--resume', 'b', '--patch', 'late.yml']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: ['a.yml'], args: ['--resume', 'b', '--patch', 'late.yml'] })
    expect(parse(['--profile', 'rescue', '--resume', 'abc', '--from-default-profile', 'native-web']))
      .toEqual({
        mode: 'profile',
        profile: 'rescue',
        patches: [],
        args: ['--resume', 'abc', '--from-default-profile', 'native-web'],
      })
  })

  it('routes profile config dumps', () => {
    expect(parse(['--profile', 'native-web', '--dump-config']))
      .toEqual({ mode: 'dump-config', profile: 'native-web', patches: [] })
    expect(parse(['--profile', 'rescue', '--from-default-profile', 'native-web', '--dump-config']))
      .toEqual({
        mode: 'dump-config',
        profile: 'rescue',
        fromDefaultProfile: 'native-web',
        patches: [],
      })
    expect(parse(['--profile', 'tui', '--dump-config', '--patch', 'x.yml']))
      .toEqual({ mode: 'dump-config', profile: 'tui', patches: ['x.yml'] })
    expect(parse(['--profile', 'native-web', '--dump-config']))
      .toEqual({ mode: 'dump-config', profile: 'native-web', patches: [] })
  })

  it('rejects missing profile, removed flags, and contradictory inputs', () => {
    expect(exitCode([])).toBe(1)
    expect(exitCode(['tui'])).toBe(1) // an app argument without --profile has no app to reach
    expect(exitCode(['--config', 'c.yml'])).toBe(1) // removed
    expect(exitCode(['-p', 'task'])).toBe(1) // removed
    expect(exitCode(['run', 'task'])).toBe(1) // app-owned task replaced the launcher subcommand
    expect(exitCode(['--profile', ''])).toBe(1)
    expect(exitCode(['--profile', 'x', '--from-default-profile='])).toBe(1)
    expect(exitCode(['--profile', 'x', '--from-default-profile'])).toBe(1)
    expect(exitCode(['--profile', 'x', '--patch='])).toBe(1)
    expect(exitCode(['--dump-config'])).toBe(1)
    // Removed with the Cordis exit: the launcher no longer owns this flag, so it
    // reaches the booted app as an ordinary argument.
    expect(parse(['--profile', 'x', '--dump-default-config']))
      .toEqual({ mode: 'profile', profile: 'x', patches: [], args: ['--dump-default-config'] })
    expect(exitCode(['--profile', 'x', '--dump-config', 'task'])).toBe(1)
    expect(exitCode(['--bogus'])).toBe(1)
    expect(parse(['--profile', 'x', 'web']))
      .toEqual({ mode: 'profile', profile: 'x', patches: [], args: ['web'] })
    expect(parse(['--profile', 'native-web', '--dump-default-config']))
      .toEqual({ mode: 'profile', profile: 'native-web', patches: [], args: ['--dump-default-config'] })
    expect(exitCode(['--profile', 'native-web', '--patch='])).toBe(1)
    // A dump never runs app command-line providers, so it cannot show what
    // those flags would decide; printing a tree that differs from the same
    // invocation's boot would mislead.
    expect(exitCode(['--profile', 'native-web', '--dump-config', '--port', '8080'])).toBe(1)
    expect(exitCode(['--profile', 'native-web', '--dump-config', '-h'])).toBe(1)
    expect(exitCode(['--profile', 'desktop'])).toBe(1)
    expect(exitCode(['--profile', 'Desktop'])).toBe(1)
    expect(exitCode(['--profile', 'DESKTOP'])).toBe(1)
    expect(exitCode(['--profile', 'desktop', '--dump-config'])).toBe(1)
    expect(exitCode(['--profile', 'sdk-minimal'])).toBe(1)
    expect(exitCode(['--profile', 'sdk-minimal', '--dump-config'])).toBe(1)
    expect(exitCode(['--profile', 'rescue', '--from-default-profile', 'sdk-minimal'])).toBe(1)
    // `plugin` is no longer a launcher subcommand; it reaches the app verbatim.
    expect(parse(['--profile', 'x', 'plugin', 'add', 'y']))
      .toEqual({ mode: 'profile', profile: 'x', patches: [], args: ['plugin', 'add', 'y'] })
    expect(exitCode(['--from-default-profile', 'native-web', 'plugin', '--profile', 'x', 'add', 'y'])).toBe(1)
  })

  it('points a refused sdk-minimal invocation at the sdk profile and the migration reference', () => {
    const boot = exitResult(['--profile', 'sdk-minimal'])
    expect(boot.code).toBe(1)
    expect(boot.stderr).toContain('profile "sdk-minimal" no longer boots')
    expect(boot.stderr).toContain('use --profile sdk')
    expect(boot.stderr).toContain('rsh/Docs/native-config-migration.md')
    const template = exitResult(['--profile', 'rescue', '--from-default-profile', 'sdk-minimal'])
    expect(template.code).toBe(1)
    expect(template.stderr).toContain('--from-default-profile "sdk-minimal" no longer initializes a profile')
  })

  it('keeps its own help for an invocation with no app to hand it to', () => {
    expect(exitCode(['--help'])).toBe(0)
    expect(exitCode(['-h'])).toBe(0)
    expect(exitCode(['--version'])).toBe(0)
  })
})
