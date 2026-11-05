# Agent Note: One `/` boundary rule for both client surfaces

Status: implemented

English | [中文](2026-11-04-shared-slash-boundary-rule.zh.md)

## Problem

Two Native surfaces offered a `/` menu under contradictory rules. The Web trigger pipeline accepted a slash at start-of-draft, after whitespace, and after punctuation; the Native composer palette accepted one only at start-of-draft. The same keystroke therefore opened a menu in one surface and typed a literal character in the other.

The narrower rule was a port-time simplification, not a product decision. `ui-commands` already filters a menu by `req.position === 'leading' || c.hint === undefined`, so inline command rows are intended product behavior, and the pipeline `position` field is the vocabulary that expresses it.

## Decision

`slashTokenAt` in `@redspark/rsh-client-ui-primitives` is the single boundary rule. `detectTrigger` in `ui-input-trigger` calls it for `/` and keeps only what belongs to detection there: the guard tier and the leading/inline position. The Native composer palette calls the same function instead of owning a copy.

A slash opens a token at start-of-draft, after whitespace (newlines included), or after punctuation, and stays an ordinary character directly after a word character. Two carve-outs keep it dead inside URLs: directly after another `/`, and directly after a `:` that follows a non-whitespace character. The scan walks left to the first whitespace, so a token ends where an ordinary word ends.

The rule is unchanged from the ported pipeline. It already refused `see src/main` and `1/2 cup` on its own terms — the character directly left of the slash is a word character in both, and a word character closes the boundary. Neither case needs a special arm, and the two surfaces now agree by construction rather than by two implementations that happened to match.

Where the shared code lives: `ui-primitives` is a narrow static owner that both feature packages may import. Sharing through the injected `clientNativeInputTrigger` service was unavailable, because `ui-input-trigger` requires `clientNativeConversation`, which only `native-application` provides; native installation planning resolves that pair into a hard dependency cycle and fails the profile load.

## Alternatives considered

**Sharing through the `clientNativeInputTrigger` service.** It would have made the palette a real consumer of the service the port added. Native `resolveInstallation` rejects it: with `native-application` requiring `clientNativeInputTrigger` while `ui-input-trigger` requires `clientNativeConversation`, both required and `optional` forms throw `native-runtime: dependency cycle`, verified against the real planner. Avoiding the cycle would mean dropping the pipeline's `clientNativeConversation` edge, which owns its per-Session controller scoping and cannot be removed for the palette's convenience.

**Tightening the rule so a slash needs a following letter.** This would have kept a menu off `1/2 cup` under a second rule while leaving `say /co` open. It was rejected because the existing word-character boundary already handles fractions: the digit left of the slash closes it, so the extra requirement would only forbid legitimate punctuation-adjacent typing without changing any fraction case.

**Keeping two implementations and pinning them with a parity test.** A parity test detects drift after the fact and requires both copies to be edited together. A single function makes drift unrepresentable.

## Consequences

The Native palette now opens on an inline slash — after a space, a newline, or punctuation — which widens what it claims from the composer. Arrow keys and Tab are still reported as consumed only while the menu is open and has a row, and Enter still falls through to submit when no row exists, so ordinary text containing a slash keeps working.

`detectTrigger` no longer contains a slash boundary rule, so a change to slash behavior has exactly one home and one spec (`ui-primitives/tests/slash-token.client.spec.ts`) instead of two that must agree.

The `clientNativeInputTrigger` service still has no Native consumer; the palette reaches the rule through a static owner rather than through that service. That gap is unchanged by this decision and remains open.

## Testing

`slash-token.client.spec.ts` pins the rule where it is defined, including the fraction cases, the URL carve-outs, the mid-token caret, and the offset of the slash that actually opened the token. `core-detect.client.spec.ts` covers the guard tiers and the leading/inline position that `detectTrigger` still owns. `command-palette.client.spec.tsx` drives the palette through a textarea and asserts the menu opens on a leading slash and stays shut for `see src/main`.
