import { describe, expect, it } from 'vitest'
import { parsePetPresentation } from '../src/pet-presentation.ts'

const valid = { visible: true, atlasUrl: '/brand/kitsune-sprites.png', frame: 2, label: 'Thinking' }

describe('desktop pet presentation parser', () => {
  it('resolves built-in and provider-local atlases on the application origin', () => {
    expect(parsePetPresentation(valid)).toEqual({ ...valid, atlasUrl: 'dsh-app://app/brand/kitsune-sprites.png' })
    expect(parsePetPresentation({ ...valid, atlasUrl: '/plugins/example/atlas.png' }))
      .toEqual({ ...valid, atlasUrl: 'dsh-app://app/plugins/example/atlas.png' })
  })
  it('allows an embedded PNG', () => {
    const embedded = { ...valid, atlasUrl: 'data:image/png;base64,aGVsbG8=' }
    expect(parsePetPresentation(embedded)).toEqual(embedded)
  })
  it.each(['https://example.com/pet.png', 'file:///C:/secret.png', 'javascript:alert(1)', '/brand/../secret.png',
    'data:image/svg+xml,<svg/>', '/brand/pet.png?token=secret', '/plugins/.private/atlas.png'])('rejects an untrusted atlas %s', (atlasUrl) => {
    expect(() => parsePetPresentation({ ...valid, atlasUrl })).toThrow('local PNG')
  })
  it('accepts a hidden update even if it carries a stale formerly selected atlas', () => {
    expect(parsePetPresentation({ ...valid, visible: false, atlasUrl: 'https://old-provider.invalid/atlas.png' }))
      .toEqual({ ...valid, visible: false, atlasUrl: 'https://old-provider.invalid/atlas.png' })
  })
  it.each([null, {}, { ...valid, frame: 4 }, { ...valid, frame: 0.5 }, { ...valid, visible: 'true' },
    { ...valid, label: 'x'.repeat(501) }])('rejects invalid presentation fields', (value) => {
    expect(() => parsePetPresentation(value)).toThrow('Invalid pet presentation')
  })
})
