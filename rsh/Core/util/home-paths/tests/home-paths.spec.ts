import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_RSH_HOME_DISPLAY,
  RSH_HOME_DIR_NAME,
  canonicalizeWatchPath,
  defaultRshHome,
  rshCachePath,
  dshHomeDisplay,
  rshHomePath,
  expandHomePath,
  resolveRshHome,
} from '@redspark/rsh-home-paths'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('dsh path helpers', () => {
  it('owns the shared default DSH home directory name', () => {
    expect(RSH_HOME_DIR_NAME).toBe('.redspark')
    expect(DEFAULT_RSH_HOME_DISPLAY).toBe('~/.redspark')
    expect(defaultRshHome()).toBe(join(homedir(), '.redspark'))
  })

  it('expands tilde paths without changing non-tilde paths', () => {
    expect(expandHomePath('~')).toBe(homedir())
    expect(expandHomePath('~/.redspark')).toBe(join(homedir(), '.redspark'))
    expect(expandHomePath('~\\.redspark')).toBe(join(homedir(), '.redspark'))
    expect(expandHomePath('/tmp/.dsh')).toBe('/tmp/.dsh')
    expect(expandHomePath('~other/.dsh')).toBe('~other/.dsh')
  })

  it('resolves explicit path before RSH_HOME and the default', () => {
    const envHome = join(homedir(), 'env-dsh')

    expect(resolveRshHome('/tmp/explicit-dsh', { RSH_HOME: '~/env-dsh' })).toBe(resolve('/tmp/explicit-dsh'))
    expect(resolveRshHome(undefined, { RSH_HOME: '~/env-dsh' })).toBe(envHome)
    expect(resolveRshHome(undefined, {})).toBe(defaultRshHome())
  })

  it('treats an empty or whitespace-only RSH_HOME as unset', () => {
    expect(resolveRshHome(undefined, { RSH_HOME: '' })).toBe(defaultRshHome())
    expect(resolveRshHome(undefined, { RSH_HOME: '   ' })).toBe(defaultRshHome())
  })

  it('joins child segments onto the resolved RSH_HOME', () => {
    vi.stubEnv('RSH_HOME', '~/env-dsh')
    expect(rshHomePath()).toBe(join(homedir(), 'env-dsh'))
    expect(rshHomePath('storages', 'cache')).toBe(join(homedir(), 'env-dsh', 'storages', 'cache'))
  })

  it('labels a resolved home by whether it is the default root', () => {
    expect(dshHomeDisplay(resolve(defaultRshHome()))).toBe('~/.redspark')
    expect(dshHomeDisplay('/some/other/root')).toBe('$RSH_HOME')
  })

  it.each([
    [undefined, join(homedir(), '.redspark')],
    ['', join(homedir(), '.redspark')],
    ['   ', join(homedir(), '.redspark')],
    ['~/env-dsh', join(homedir(), 'env-dsh')],
    ['./relative-dsh', resolve('./relative-dsh')],
  ] as const)('resolves cache paths with RSH_HOME=%j', (home, expectedHome) => {
    vi.stubEnv('RSH_HOME', home)
    try {
      expect(rshCachePath()).toBe(join(expectedHome, 'cache'))
      expect(rshCachePath('models', 'index.json')).toBe(join(expectedHome, 'cache', 'models', 'index.json'))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('resolves configured cache homes before the environment', () => {
    vi.stubEnv('RSH_HOME', '~/env-dsh')
    try {
      expect(rshCachePath({ rshHome: '~/explicit-dsh' })).toBe(join(homedir(), 'explicit-dsh', 'cache'))
      expect(rshCachePath({ rshHome: './explicit-dsh' }, 'attachments', 'request-images'))
        .toBe(resolve('./explicit-dsh/cache/attachments/request-images'))
      expect(rshCachePath({}, 'attachments')).toBe(join(homedir(), 'env-dsh', 'cache', 'attachments'))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('canonicalizes a watcher ancestor while preserving a missing suffix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-watch-path-'))
    const target = join(root, 'target')
    const alias = join(root, 'alias')
    try {
      await mkdir(target)
      await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
      await expect(canonicalizeWatchPath(alias)).resolves.toBe(await realpath(target))
      await expect(canonicalizeWatchPath(join(alias, 'later', 'config.yml'))).resolves.toBe(
        join(await realpath(target), 'later', 'config.yml'),
      )
      const file = join(root, 'file')
      await writeFile(file, 'not a directory')
      await expect(canonicalizeWatchPath(join(file, 'child'))).rejects.toMatchObject({ code: 'ENOTDIR' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
