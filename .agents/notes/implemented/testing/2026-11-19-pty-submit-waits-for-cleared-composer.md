# Agent Note: Terminal PTY input waits for the composer to clear

Status: implemented

English | [中文](2026-11-19-pty-submit-waits-for-cleared-composer.zh.md)

## Problem

`terminalFixture().submit()` typed text, waited for it to appear in the PTY output, then wrote `\r`. It returned before the application reported the submitted input, so the next typed text could reach the process while the Enter was unread. A slow reader then delivered `\r` and the following text in one chunk, and `ink-text-input` inserted the carriage return into the composer instead of treating it as Enter. `snapshots/native-tui/native-tui.snapshot.ts` failed this way on the Linux CI runner, where `/sessions` arrived as `"\r/sessions"` and the busy-terminal refusal never appeared.

## Decision

`submit()` waits after Enter until the terminal renders a frame that no longer contains the input: either the empty composer placeholder (`terminalCopy('en').placeholder`) for the fixture's default locale, or the process exit that `/exit` and `/quit` request. It polls the accumulated PTY output directly rather than through `vi.waitFor`; awaiting `vi.waitFor` a second time inside one test stalled the child's output for the whole 30-second timeout.

## Consequences

Every `submit()` call now costs one extra rendered frame, so scenarios observe the application's accepted state before typing again instead of relying on echo timing. The wait keys on the English placeholder because every fixture launches the default locale; a scenario that selects `zh` would need the matching copy.

## Alternatives considered

**Scope the queued-input assertion in the scene.** Rejected as the only fix: `waitFor('1 queued')` matched the previous turn's queue state, but the same coalescing can affect every caller of `submit()`, including the cancellation lifecycle test.

**Sleep briefly between Enter and the next write.** Rejected: the delay would hide the race without proving the application consumed the Enter, and slow CI runners would still be able to coalesce the chunks.

## Verification

`pnpm exec vitest run rsh/Programs/TUI/native-tui/tests` and `RSH_EXAMPLE_MODE=lib pnpm exec vitest run --config vitest.snapshot.config.ts snapshots/native-tui/{native-tui,human-interaction}.snapshot.ts` pass, including under `taskset -c 0`, which reproduced the original failure before the change.
