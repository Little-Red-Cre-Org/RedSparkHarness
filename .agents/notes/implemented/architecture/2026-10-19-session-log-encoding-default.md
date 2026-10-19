# Agent Note: One plaintext default for session logs

Status: implemented

English | [中文](2026-10-19-session-log-encoding-default.zh.md)

## Problem

Three places decided the physical encoding of a session log, and they disagreed. Every shipped profile template wrote `compression: 'none'`, and the Desktop profile writer inherited that choice. The JSONL backend, mounted without the field, fell back to `zstd`. So the same product stored plaintext through a shipped profile and compressed frames through any composition that omitted the field — including mounts whose only configured key was `root`.

The split was invisible because no single surface named it. A support question about a log that "cannot be read with `cat`" and one about logs that "grew too fast" both came from the same product, decided by which composition happened to have mounted the backend. It also made the encoding rule impossible to state: `inspectSessionRootCompression` reports the encoding a root already holds, so a fresh root's encoding could only be explained by naming whichever layer mounted the backend.

The three decisions were recorded in the P6 handover as unresolved product questions. A default that two of the three layers already agree on is not a product choice left open; it is the backend disagreeing with the shipped product.

## Decision

The backend default is `none`, the same encoding every shipped profile template and the Desktop profile writer select. `DEFAULT_COMPRESSION` and therefore `JsonlCompressionSchema`'s default are plaintext; Zstandard is chosen explicitly by setting `compression: 'zstd'`.

Plaintext is the default because it is what the product already wrote, and because a session log is evidence: an operator can read it, grep it, and hand a line to a bug report. Compression stays available as an explicit, per-root choice for deployments that would rather spend CPU than disk. A root still belongs to exactly one encoding, and the refusal to mix them is unchanged.

## Alternatives considered

**Default to `zstd` and change the templates to match.** Rejected because it reverses the direction the product already ships in and takes readability away from the common case to buy disk that no deployment has asked for. It would also require migrating the roots every existing shipped profile created.

**Leave both defaults and document the difference.** Rejected because it keeps the same behavior decided by an invisible mounting detail. The P6 handover listed this as a question precisely because the difference could not be explained from the product's own rules.

**Make the encoding mandatory with no default.** Rejected because `root` is the one required configuration and every shipped composition already states the encoding; a required field would add a failure mode for hand-written compositions without changing what any shipped profile stores.

## Consequences

A composition that omits `compression` now writes newline-delimited UTF-8, readable by an external line reader without going through the backend. Deployments that relied on the inherited compressed default must now say `compression: 'zstd'`.

Existing roots are unaffected: each one keeps the encoding it holds, `inspectSessionRootCompression` still reports it, and the mismatch refusal still fires when a backend's configured encoding differs from the root's. Only the choice made for a *new* root changed.

The encoding rules in the package README, the Zstandard session-log Agent Note, and the two keyless profile smokes now state the plaintext default. The headless smoke is the only place that observes it end to end: its fixture sets `root` alone, so it asserts the default rather than a configured value.

## Testing

`zstd.spec.ts` pins `compression: 'zstd'` at every mount that exercises Zstandard framing, so those cases test the codec rather than the default, and its contract fixture states the encoding it means to exercise.

A new case in the encoding-selection suite mounts the backend with only `root` and asserts the written artifact is the plaintext `.jsonl` generation with no `.jsonl.zstd` beside it, which is the user-visible consequence of the default.
