# Agent Note: The Native `@` reference source reads one projection and two discoveries

Status: implemented

English | [中文](2026-11-06-native-reference-source.zh.md)

## Problem

`ui-reference` shipped only a browser half. Its `apply` registered an `@` source over `ctx.inputTriggers`, discovered files through `remote.fileReferences` and sessions through `remote.sessionReferenceResolver`, and projected rows inline in that file. A Native Web client composes no Cordis context and no Remote namespace pair, so the `@` menu it can reach was empty: pressing `@` in the Native composer did nothing. That is the one capability gap the migration had left on the reference side.

Two pieces already existed and were not the gap. `ui-input-trigger`'s Native entry provides `clientNativeInputTrigger` — the same `InputTriggerController` the browser drives, over a Native dispatch adapter — and `native-session` provides `clientNativeFileReferences.search`, the workspace path search. What was missing was a source registered into that pipeline.

## Decision

The package now publishes `./native` and splits its behaviour in two.

`src/client/candidates.ts` owns row production: `fileCandidate`, `sessionCandidate`, `crumbsFor`, `directoryValue` and `pickOf`. Both halves import it. It declares the row, crumb and pick types it returns rather than importing them from `@redspark/rsh-client-ui-input-trigger/client`, because the Native entry must not reach the Cordis-side contract; the declarations describe the same fields the pipeline accepts.

`src/native.ts` supplies only discovery. Files come from `clientNativeFileReferences.search`; sessions come from the durable list `clientNativeConversation` already holds, filtered and ranked by `sessionCandidatesFor` — the asking Session excluded, candidates sharing its workspace first, then a different recorded workspace, then none. The browser resolver does that work on the Host; a Native client has no Host to ask, so the same rule runs over the rows the client has.

The Native entry requires `clientNativeInputTrigger` rather than treating it as optional. A source registered into a pipeline no composition drives would install successfully and show nothing, which is the failure this change exists to remove. `clientNativeInputTrigger` in turn requires `clientNativeConversation`, so the dependency runs one way and the entry goes in `NATIVE_WEB_CLIENT_INSTALLATIONS` after `input-trigger`.

Two smaller facts follow from running in a browser:

`session-reference`'s URI codec used `Buffer`, which a browser bundle cannot carry, so `encodeSessionReferenceUri`/`decodeSessionReferenceUri` now use `TextEncoder`/`btoa` and the inverse. The package publishes `./uri` for that module: the root entry imports the Cordis service, and the Native client bundle rejects a Cordis import outright.

The displayed workspace is abbreviated against the Host home read from the connection generation on each call, so a reconnect to a different Host re-reads it instead of keeping the first value.

## Alternatives considered

**Import the row projection from the browser half's own module.** Rejected: `src/client/index.ts` imports `@redspark/cordis` and the Remote type merges, either of which the Native bundle rejects. The projection had to move to a module with no Cordis edge, and once moved both halves read it.

**Keep two row builders, one per half.** Rejected: the two would drift on exactly the details already settled by earlier work — that a root row names no location, that a drilled listing omits the parent the header carries, that a session omits its own workspace. A shared module makes divergence a compile error rather than a test that has to cover both.

**Register the source without requiring `clientNativeInputTrigger`.** Rejected: `registerSource` would be called on a service that does not exist. Declaring the requirement makes a composition that omits the pipeline fail at plan time, where [the fail-loud rule](../../../../AGENTS.md) wants it.

**Add a Host route so the Native client can call the real `sessionReferenceResolver`.** Rejected for this change: `native-web` composes no `sessionQuery` (the template installs it only for headless profiles), and the resolver's own candidate listing reads session projections the Web client does not have. The durable list the client already holds answers the same question with facts the Host already projected.

## Consequences

- A Native Web client's `@` menu now lists workspace files and durable sessions, and picking one produces the same insert the browser produces.
- Row wording, ordering and pick outcomes have one home, so the two builds cannot disagree about a reference.
- The Native session group is necessarily weaker than the browser's: it ranks and labels from the Client's list, so a Session whose title projection is unavailable is labelled by its id rather than costing a log read.
- Coverage: `tests/native-reference.client.spec.ts` pins the asking-Session exclusion, the affinity rank, the title/id/workspace filter, the id fallback label, quoted-path suppression, a failed search degrading to the session group only, the aborted-result drop, home abbreviation, the createdAt fallback for the age, the drill header, every pick outcome and the codec round-trip. Each was checked by reverting the behaviour it covers: removing the exclusion, the affinity sort, the quoted-path suppression and the abort guard each turned its own case red. Strengthening one case was necessary — quoting the query `SOURCE` instead of an unmatched word — because the original fixture could not distinguish a suppressed group from an empty one.
