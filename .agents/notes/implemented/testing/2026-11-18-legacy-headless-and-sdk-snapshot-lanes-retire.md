# Agent Note: The legacy headless and SDK snapshot lanes retire

Status: implemented

English | [中文](2026-11-18-legacy-headless-and-sdk-snapshot-lanes-retire.zh.md)

## Problem

Both Cordis snapshot runners had stopped executing their own members.

`snapshots/session/headless.snapshot.ts` collected only `profile: legacy-headless` directories, then read `compositionOwners.get('default')` for the shared model script. The `default` owner is `snapshots/session/text-turn`, which moved to `profile: headless` when its Native replay passed. The map is built only from directories the runner collects, so it stayed empty: five of the six remaining cases threw `headless corpus has no default composition` before starting a process, and the sixth never asserted anything either. The lane reported failures that described the corpus, not the product.

`snapshots/sdk/sdk.snapshot.ts` collected one case, `subagent-continuable`. `snapshots/native-sdk/legacy-continuable.snapshot.ts` already replays that same directory through `dsh --profile sdk`.

Pull-request CI runs snapshot files named one by one in `.github/workflows/redspark-ci.yml`, and that list never named this runner; the whole corpus runs only in the local and master lanes. A red runner therefore stayed invisible while it exercised nothing.

## Decision

Delete both runners. A fixture directory outlives its Cordis runner when a Native replay reads it, and its `snapshot.yml` then names the profile that replay uses.

`snapshots/session/headless.snapshot.ts` and `snapshots/sdk/sdk.snapshot.ts` are gone, and `rsh/Scripts/session-snapshot-corpus.corpus.ts` no longer lists them or accepts `legacy-headless` under `snapshots/session/`.

What happened to each member:

| Directory | Outcome |
|---|---|
| `session/advanced-toolchain`, `session/advanced-toolchain-runtime`, `session/cordis-inspect-jsdoc` | Deleted. They exercise `cordis_define`, `cordis_undefine` and `cordis_inspect_query` from `@redspark/rsh-tool-cordis`; [What still depends on Cordis](../../proposed/architecture/2026-11-10-what-still-depends-on-cordis.md) already records that this capability retires with the package rather than acquiring a Native replay. |
| `session/pwsh-tool-turn` | Kept as the scene of `snapshots/native-headless/pwsh-tool-turn-native.snapshot.ts`; `profile` is now `headless`. |
| `session/persistent-pwsh-tool-turn` | Kept with `profile: headless`. No Native replay reads it yet, so the fixture waits for one instead of disappearing with its runner. |
| `session/subagent-published-run-failure` | Kept with `profile: headless`. It owns the `subagent-durability-failure` composition and header class that `snapshots/sdk/subagent-continuable` pins, and Native still reports a drain failure without the recorded dispose text. |
| `sdk/subagent-continuable` | Kept; `profile` is now `sdk`, which is what `snapshots/native-sdk/legacy-continuable.snapshot.ts` boots. |

`legacy-acp` is the only legacy profile left in the corpus. Its eight cases build a Cordis ACP composition and need that composition rebuilt before they can move; `snapshots/acp/acp.snapshot.ts` keeps `profile: legacy-acp` and stays.

## Consequences

`legacy-headless` and `legacy-sdk` stay in the accepted profile union, because `snapshots/session/` manifests are validated against that union and a custom Cordis profile can still boot. No fixture selects either one.

The three deleted directories carried the only recorded evidence of `cordis_define`, `cordis_undefine` and `cordis_inspect_query`. That capability retires with `@redspark/rsh-tool-cordis`, so the evidence leaves one phase earlier than the package does.

The whole corpus still has no pull-request CI job, so a runner outside the workflow list will again drift unseen.

## Alternatives considered

**Keep the runner and restore a `default` composition owner.** Rejected: the owner would have to carry `cordis.yml` again, which reintroduces a Cordis composition that no Native replay reads, to execute five cases that already fail before starting a process.

**Write Native replays for the five cases instead of deleting or parking them.** Rejected for now: the three toolchain cases exercise a capability that retires with its package, `persistent-pwsh-tool-turn` needs a recorded session this change cannot produce, and `subagent-published-run-failure` asserts a dispose text that Native records rather than throws. The two fixtures that a replay could adopt stay in place with a `headless` manifest.

**Delete every fixture the runner used.** Rejected: `snapshots/session/pwsh-tool-turn` is the scene of a passing Native replay, and `subagent-published-run-failure` owns the composition and header class that the SDK pin resolves.

## Verification

`pnpm run test:snapshot` collects neither deleted runner, and `rsh/Scripts/session-snapshot-corpus.corpus.ts` passes: every `snapshots/session/` manifest now declares `profile: headless`, every composition pin still resolves, and the adapter list matches the remaining `*.snapshot.ts` files.

`snapshots/native-headless/pwsh-tool-turn-native.snapshot.ts` still finds its session fixture in `snapshots/session/pwsh-tool-turn`; it reads that directory by path and never consults the manifest. Its replay needs a prior `pnpm run build` because it launches `rsh/Programs/CLI/lib/bin.js`.

Nothing in `snapshots/` declares `profile: legacy-headless` or `profile: legacy-sdk` any more.
