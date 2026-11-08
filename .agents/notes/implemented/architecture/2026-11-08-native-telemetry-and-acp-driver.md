# Agent Note: Native composes session telemetry and takes over ACP subagents

Status: implemented

English | [中文](2026-11-08-native-telemetry-and-acp-driver.zh.md)

## Problem

Two Cordis base rows had no Native counterpart row. `session-telemetry-otel` shipped a Native Provider that no Native profile composed, so a Native session never exported an authorized feedback prefix even though the Provider, its policy gates, and its shutdown drain were all present. `subagent-acp` had no Native entry at all, and nothing in the Native composition recorded what took over its capability.

## Decision

`native-sdk`, `native-acp`, `native-headless`, `native-web`, and `native-tui` compose `session-telemetry-otel` under the id the Cordis base bundle uses. The install bounds are the Cordis ones verbatim: `maxExportBatchSize` equals `maxQueueSize` so the drain is one batch, and the backend's `shutdownTimeoutMillis` is the outer bound when a transport promise never settles. `RSH_TELEMETRY_MODE` and `RSH_TELEMETRY_OTLP_URL` stay deployment overrides, read exactly as the bundle reads them. The row's `launchEnvironment` requirement is satisfied by the loader's per-scope injection, so the row needs no companion.

`subagent-acp` gains no Native entry. ACP subagents already run out of process through `@redspark/rsh-acp-child`, which provides `externalSubagentDriver` to the Native subagent Provider, requires `credentials` and `acpChildRuntimeLauncher`, and is selected by the ACP and SDK child profiles. The compatibility plugin remains the Cordis half of the same protocol; `native-package-policy.ts` now records it as compatibility-only and names that successor, so the classification states the takeover instead of leaving the package merely unclassified.

## Alternatives considered

**Give `subagent-acp` its own Native entry.** Rejected. It would put two implementations of one protocol carrier in the Native runtime. The ACP driver contract, its permission policy, and its child runtime launcher are already implemented once in `acp-child`; a second entry would need to justify diverging from it on every future protocol change.

**Leave `subagent-acp` unclassified.** Rejected. The publication gates pass either way today, but an unclassified compatibility package records no answer to "what replaced this?", which is the question the next deletion pass asks. The entry above answers it in the policy file itself.

**Compose telemetry in one profile only, or default it to `DISABLED`.** Rejected. Every shipped Cordis mode carries the row enabled with `FEEDBACK_ONLY`, and the Provider already withholds upload unless a durable feedback commit authorizes the prefix. Restricting it to one profile would make the runtimes disagree on what a session exports.

## Consequences

A Native session now exports the same feedback-only prefix the Cordis profile does, and an operator disabling telemetry through `RSH_TELEMETRY_DISABLED` or a `DISABLED` mode reaches both runtimes the same way.

The telemetry row is load-bearing for test coverage: `native-profile-template.spec.ts` previously asserted the row was absent, and now asserts its id, plugin, and bounds. That assertion fails when the row is renamed away.

`subagent-acp` keeps shipping as the Cordis half. Deleting it requires proving `acp-child` covers every ACP consumer, which the policy entry now names as the successor but does not itself establish.
