# Agent Note: the legacy ACP surface retires

Status: implemented

English | [中文](2026-11-18-legacy-acp-surface-retires.zh.md)

## Problem

The shipped `acp` profile name initializes `native-acp`, so the Cordis ACP composition at `rsh/Programs/CLI/tests/profiles/acp/` and `snapshots/acp/` only ran when a test created a `legacy-acp` profile explicitly. That suite was not an oracle: on the merged base it failed 6 of 15 recorded scenarios because provider `config_option_update` ordering differed from the recordings.

`snapshots/acp/` held four compositions: `escalation-approved`, `fs-escalation-approved`, `image-compaction`, and, before #373, `reject-extra-dirs` and `cancel-tool-calls`. Leaving the directories while deleting their profile would leave the corpus gate selecting a profile the launcher no longer boots.

## Decision

Delete `rsh/Programs/CLI/tests/profiles/acp/` and `snapshots/acp/` entirely.

`snapshots/native-acp/fs-escalation.snapshot.ts` replaces `fs-escalation-approved`. It builds a private profile from the shipped `native-acp` composition, overrides `fs` to `@redspark/rsh-fs-sandbox`, sets the standing policy to `read-only`, and registers `@redspark/rsh-tool-fs` through `native-tools`. The recorded write is denied with the sandbox diagnostic and the escalation hint, the retried call carries `sandbox_permissions: workspace-write` and its justification, the client approves once, and `escalated.txt` lands. Escalation stays inside the Session workspace because `tool-fs` refuses paths outside it.

`cancel-tool-calls` and `reject-extra-dirs` left in #373 for `snapshots/native-acp/tool-cancel.snapshot.ts` and the handshake assertions. `snapshots/web/bash-abort-row/session.v3.jsonl` now owns the recorded Session that `bash-abort-row` and `native-bash-abort-row` replay, so deleting `snapshots/acp/` does not remove a Web fixture.

The ACP e2e in `rsh/Compatibility/DSH/subagent/subagent-acp` launches `--profile acp` with no overlay. The shipped composition already selects `deepseek-official` and the recorded DeepSeek route, so the deleted `cordis.yml` overlay is not replaced.

`snapshots/native-acp/external-child/` is re-recorded. Its October recording predated the `request-context` runtime message and the `subagent.run_in_background` parameter, so the parent and child requests no longer matched the shipped profile. The refresh adds only those inputs and the tool description change.

## Not replayed on Native

`image-compaction` priced six images through the DeepSeek route with `retainTokens: 100`. The keyless `pi-ai` replay provider does not price images, and `@redspark/rsh-llm-deepseek` requires credentials, so no keyless Native replay can assert those numbers. The composition is deleted with its numbers recorded only in this note.

`escalation-approved` escalated a Bash call to `danger-full-access` outside the workspace and asserted a Cordis fixture plugin's `subagent/end` marker. The Native profile's Bash escalation path is still unrecorded; `fs-escalation` proves the denial, retry, approval, and effect sequence for `write`, not for `bash`. The marker plugin existed only to observe the Cordis subagent lifecycle, which Native reports as job events.

`rsh/Programs/CLI/package.json` still declares `@redspark/cordis` and the Cordis-era optional packages. Closing the CLI's legacy boot and dump modes is the next cut; this change only removes the ACP-bound surface.

## Alternatives considered

**Keep `snapshots/acp/` and point it at the shipped `acp` profile.** Rejected. The compositions carry Cordis rows, `!!js` expressions, and fixture plugins; the profile name now selects Native, so the runner would either fail resolution or assert a different composition.

**Rewrite `escalation-approved` as a Native Bash escalation replay.** Rejected for this cut. `tool-fs` already gives a recorded denial, retry, and approval path through the same approval service; adding a second in-flight Native ACP scenario before the CLI exit would widen this PR without changing product code.

**Move `image-compaction` to `native-acp` without the price assertions.** Rejected. The scenario exists to assert compaction pricing; a replay that omits the numbers keeps a fixture that proves nothing.

## Consequences

`snapshots/acp/` no longer exists, and `rsh/Scripts/session-snapshot-corpus.corpus.ts` lists `native-acp` plus `fs-escalation`. The snapshot manifest accepts only `headless`, `sdk`, `native-headless`, `native-sdk`, `native-acp`, `native-web`, and `web`. The legacy ACP profile directory is gone, so `dsh --profile legacy-acp --from-default-profile acp` is the only remaining way to compose that Cordis tree; the CLI exit removes that path next.
