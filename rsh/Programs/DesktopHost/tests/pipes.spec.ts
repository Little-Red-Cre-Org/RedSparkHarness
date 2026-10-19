/** Descriptor ownership of the Desktop Host byte pipes across a clean stop. */
import { fstatSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDesktopHostPipes } from '../src/pipes.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * Report whether a descriptor is still open in this process.
 * @param fd - descriptor to probe.
 * @returns true while the descriptor resolves.
 */
function descriptorOpen(fd: number): boolean {
  try {
    fstatSync(fd)
    return true
  } catch {
    return false
  }
}

/**
 * Create the two regular files that stand in for the inherited pipe descriptors.
 * @returns their absolute paths.
 */
function pipeFiles(): { request: string; response: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-pipes-'))
  roots.push(root)
  const request = join(root, 'request')
  const response = join(root, 'response')
  writeFileSync(request, '')
  writeFileSync(response, '')
  return { request, response }
}

describe('openDesktopHostPipes', () => {
  it('closes each descriptor once without reporting a descriptor error', async () => {
    const files = pipeFiles()
    const requestFd = openSync(files.request, 'r')
    const responseFd = openSync(files.response, 'a')
    const pipes = openDesktopHostPipes(requestFd, responseFd)
    const errors: NodeJS.ErrnoException[] = []
    pipes.requests.on('error', (error: NodeJS.ErrnoException) => { errors.push(error) })
    pipes.responses.on('error', (error: NodeJS.ErrnoException) => { errors.push(error) })

    await pipes.close()

    expect(errors).toEqual([])
    expect(descriptorOpen(requestFd)).toBe(false)
    expect(descriptorOpen(responseFd)).toBe(false)
  })

  it('flushes queued response bytes before closing the write end', async () => {
    const files = pipeFiles()
    const requestFd = openSync(files.request, 'r')
    const responseFd = openSync(files.response, 'a')
    const pipes = openDesktopHostPipes(requestFd, responseFd)
    const errors: NodeJS.ErrnoException[] = []
    pipes.responses.on('error', (error: NodeJS.ErrnoException) => { errors.push(error) })

    pipes.responses.write('frame')
    await pipes.close()

    expect(errors).toEqual([])
  })

  it('settles repeated close calls through one teardown', async () => {
    const files = pipeFiles()
    const requestFd = openSync(files.request, 'r')
    const responseFd = openSync(files.response, 'a')
    const pipes = openDesktopHostPipes(requestFd, responseFd)
    const errors: NodeJS.ErrnoException[] = []
    pipes.requests.on('error', (error: NodeJS.ErrnoException) => { errors.push(error) })
    pipes.responses.on('error', (error: NodeJS.ErrnoException) => { errors.push(error) })

    await Promise.all([pipes.close(), pipes.close()])
    await pipes.close()

    expect(errors).toEqual([])
  })
})
