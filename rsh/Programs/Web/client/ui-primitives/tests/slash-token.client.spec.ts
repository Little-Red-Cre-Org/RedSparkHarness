/**
 * The single `/` boundary rule, exercised where it is defined.
 *
 * Every surface that offers a slash menu reads `slashTokenAt`, so this spec is
 * the one place the rule is pinned: the Web trigger pipeline and the Native
 * composer palette cannot disagree because neither owns a copy of it.
 */
import { describe, expect, it } from 'vitest'
import { slashTokenAt } from '../src/slash-token.ts'

describe('slashTokenAt', () => {
  it('recognizes a bare slash at the start of the draft', () => {
    expect(slashTokenAt('/', 1)).toEqual({ query: '', start: 0, end: 1 })
  })

  it('carries the text between the slash and the caret as the query', () => {
    expect(slashTokenAt('/com', 4)).toEqual({ query: 'com', start: 0, end: 4 })
  })

  it('opens after whitespace, including a newline', () => {
    // Inline commands are the product rule the Web trigger pipeline already
    // implements; the Native palette must not contradict it.
    expect(slashTokenAt('say /co', 7)).toEqual({ query: 'co', start: 4, end: 7 })
    expect(slashTokenAt('line1\n/go', 9)).toEqual({ query: 'go', start: 6, end: 9 })
  })

  it('opens after punctuation', () => {
    expect(slashTokenAt('see (/go', 8)).toEqual({ query: 'go', start: 5, end: 8 })
    expect(slashTokenAt('note: /go', 9)).toEqual({ query: 'go', start: 6, end: 9 })
  })

  it('stays closed after a word character', () => {
    // A path is not a command.
    expect(slashTokenAt('see src/main', 12)).toBeNull()
    expect(slashTokenAt('a/b', 3)).toBeNull()
  })

  it('stays closed on a fraction, whose slash follows a digit', () => {
    // `1/2 cup` is a measurement. The digit before the slash is a word
    // character, so the rule that protects `src/main` protects this too and
    // the menu never opens over a quantity.
    expect(slashTokenAt('1/2 cup', 3)).toBeNull()
    expect(slashTokenAt('1/2', 3)).toBeNull()
    expect(slashTokenAt('2 + 3/4', 7)).toBeNull()
  })

  it('does not treat every digit-adjacent slash as a quantity', () => {
    // `(/go` follows punctuation, so it opens even though the token before it
    // ends in a digit; only the character DIRECTLY left of the slash decides.
    expect(slashTokenAt('2+(/go', 6)).toEqual({ query: 'go', start: 3, end: 6 })
  })

  it('stays closed inside a URL', () => {
    expect(slashTokenAt('https://example', 15)).toBeNull()
    expect(slashTokenAt('see https://example', 19)).toBeNull()
    expect(slashTokenAt('C:/path', 7)).toBeNull()
  })

  it('ignores a caret before the first character', () => {
    expect(slashTokenAt('/', 0)).toBeNull()
    expect(slashTokenAt('', 0)).toBeNull()
  })

  it('ignores a caret past the end of the draft', () => {
    expect(slashTokenAt('/com', 99)).toBeNull()
  })

  it('stops at the whitespace that ended the token', () => {
    expect(slashTokenAt('/goal x', 7)).toBeNull()
  })

  it('keeps the name while the caret is still on the terminating space', () => {
    // `/compact ` — the caret sits ON the space: the name is complete but the
    // arguments are empty, which is the instant a user presses space expecting
    // the menu to settle.
    expect(slashTokenAt('/compact ', 8)).toEqual({ query: 'compact', start: 0, end: 8 })
    expect(slashTokenAt('/compact ', 9)).toBeNull()
  })

  it('reports the offset of the slash that actually opened the token', () => {
    expect(slashTokenAt('a /path', 7)).toEqual({ query: 'path', start: 2, end: 7 })
    expect(slashTokenAt('args /path', 10)).toEqual({ query: 'path', start: 5, end: 10 })
    expect(slashTokenAt('see src/main and /go', 20)).toEqual({ query: 'go', start: 17, end: 20 })
  })
})
