import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectProjectReferenceFaceViolations } from './project-reference-faces.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function workspaceFixture(options: {
  readonly host: readonly string[]
  readonly client: readonly string[]
}): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-project-reference-faces-'))
  roots.push(root)
  const shared = join(root, 'rsh/Engine/core/shared')
  const split = join(root, 'rsh/Programs/Web/api/split')
  mkdirSync(shared, { recursive: true })
  mkdirSync(split, { recursive: true })
  writeJson(join(root, 'tsconfig.base.json'), {})
  writeJson(join(root, 'tsconfig.base.client.json'), { extends: './tsconfig.base.json' })
  writeJson(join(shared, 'package.json'), { name: '@deepseek-ai/dsh-shared' })
  writeJson(join(shared, 'tsconfig.json'), {
    extends: '../../../../tsconfig.base.json',
    references: [],
  })
  writeJson(join(split, 'package.json'), { name: '@deepseek-ai/dsh-split' })
  writeJson(join(split, 'tsconfig.json'), {
    files: [],
    references: [{ path: './tsconfig.host.json' }, { path: './tsconfig.client.json' }],
  })
  writeJson(join(split, 'tsconfig.host.json'), { references: [{ path: '../../core/shared' }] })
  writeJson(join(split, 'tsconfig.client.json'), { references: [{ path: '../../core/shared' }] })
  writeJson(join(root, 'tsconfig.host.json'), {
    references: options.host.map(path => ({ path })),
  })
  writeJson(join(root, 'tsconfig.client.json'), {
    references: options.client.map(path => ({ path })),
  })
  return root
}

describe('Project Reference compiler faces', () => {
  it('allows neutral projects in either graph and matching split leaves', () => {
    const root = workspaceFixture({
      host: ['./rsh/Engine/core/shared', './rsh/Programs/Web/api/split/tsconfig.host.json'],
      client: ['./rsh/Engine/core/shared', './rsh/Programs/Web/api/split/tsconfig.client.json'],
    })

    expect(collectProjectReferenceFaceViolations(root)).toEqual([])
  })

  it('rejects the opposite leaf and the solution root of a split project', () => {
    const root = workspaceFixture({
      host: [
        './rsh/Programs/Web/api/split/tsconfig.host.json',
        './rsh/Programs/Web/api/split/tsconfig.client.json',
      ],
      client: ['./rsh/Programs/Web/api/split'],
    })

    expect(collectProjectReferenceFaceViolations(root)).toEqual([
      'tsconfig.client.json: Project Reference "./rsh/Programs/Web/api/split" enters split project rsh/Programs/Web/api/split from a Client config; reference "rsh/Programs/Web/api/split/tsconfig.client.json" instead',
      'tsconfig.host.json: Project Reference "./rsh/Programs/Web/api/split/tsconfig.client.json" enters split project rsh/Programs/Web/api/split from a Host config; reference "rsh/Programs/Web/api/split/tsconfig.host.json" instead',
    ])
  })

  it('uses the referencing project face throughout the reachable graph', () => {
    const root = workspaceFixture({
      host: ['./rsh/Engine/core/host-consumer'],
      client: ['./rsh/Engine/core/client-consumer'],
    })
    const hostConsumer = join(root, 'rsh/Engine/core/host-consumer')
    mkdirSync(hostConsumer, { recursive: true })
    writeJson(join(hostConsumer, 'package.json'), { name: '@deepseek-ai/dsh-host-consumer' })
    writeJson(join(hostConsumer, 'tsconfig.json'), {
      extends: '../../../../tsconfig.base.json',
      references: [{ path: '../../../Programs/Web/api/split/tsconfig.client.json' }],
    })
    const clientConsumer = join(root, 'rsh/Engine/core/client-consumer')
    mkdirSync(clientConsumer, { recursive: true })
    writeJson(join(clientConsumer, 'package.json'), { name: '@deepseek-ai/dsh-client-consumer' })
    writeJson(join(clientConsumer, 'tsconfig.json'), {
      extends: '../../../../tsconfig.base.client.json',
      references: [{ path: '../../../Programs/Web/api/split/tsconfig.host.json' }],
    })

    expect(collectProjectReferenceFaceViolations(root)).toEqual([
      'rsh/Engine/core/client-consumer/tsconfig.json: Project Reference "../../../Programs/Web/api/split/tsconfig.host.json" enters split project rsh/Programs/Web/api/split from a Client config; reference "rsh/Programs/Web/api/split/tsconfig.client.json" instead',
      'rsh/Engine/core/host-consumer/tsconfig.json: Project Reference "../../../Programs/Web/api/split/tsconfig.client.json" enters split project rsh/Programs/Web/api/split from a Host config; reference "rsh/Programs/Web/api/split/tsconfig.host.json" instead',
    ])
  })
})
