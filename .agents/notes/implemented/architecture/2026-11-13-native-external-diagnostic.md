# Agent Note: Native external diagnostic

Status: implemented

English | [中文](2026-11-13-native-external-diagnostic.zh.md)

## Problem

A product child can fail for a reason `stopReason` does not name. The recorded `product-subagent-result-diagnostic` tool result carries that reason as `Diagnostic: ...` between the headline and any partial output. `NativeExternalSubagentOutcome` had `output`, `structured`, and `stopReason` only, so a Native host could not show the same text.

## Decision

`NativeExternalSubagentOutcome.diagnostic` is an optional string. `acceptExternalOutcome` keeps it only for a non-completed outcome, drops blank text, and limits it to 4096 UTF-8 bytes. A cut falls on a code-point boundary and appends `\n[diagnostic truncated]`. The subagent tool renders a non-empty diagnostic after the stop-reason headline and before partial output. Codex's Native adapter forwards a diagnostic its product run already produced. ACP, SDK, and Claude adapters do not invent one. [Product subagent noninteractive permissions](../feature/2026-08-15-product-subagent-noninteractive-permissions.md) owns the product text this field carries.

The field is not a session event. The model sees it in the tool result, and that result is already in the session log. `external-end` still records `stopReason` only. `SESSION_FORMAT_VERSION` is unchanged.

## Alternatives considered

**Record the diagnostic as a session event.** The model-visible text is the tool result. A second event would copy text the log already stores. Replay does not read this text, so a new required session field would raise `SESSION_FORMAT_VERSION` or need `ignorable: true`.

**Render a diagnostic for every provider, including local spawn failures.** Local failures have no product text. Inventing one would change recorded native-sdk output that does not contain `Diagnostic:`.

**Re-record `product-subagent-result-diagnostic` on a Native profile with this field.** Rejected as a live-product recording. The recorded calls now replay against a stub driver that returns the recorded diagnostics. Background calls are Agent-owned jobs, so `job_output` reads `subagent-1` and `subagent-2`. The scene does not start a product child.

## Consequences

A product that already returns a diagnostic, including the Codex Native run, can show it. A product that does not return one still renders the headline and partial output only. An empty string is omitted, so the label never appears with no text. The field is not a profile installation, and the legacy scenario is not re-recorded. The recorded calls replay against a stub driver and Agent-owned jobs. [Native SDK persistent shell](2026-11-13-native-sdk-persistent-shell.md) mounts the shell and leaves the Python entry unmounted.
