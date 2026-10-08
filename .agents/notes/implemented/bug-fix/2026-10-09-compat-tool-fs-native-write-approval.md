# Agent Note: Native approval for compatibility filesystem mutations

English | [中文](2026-10-09-compat-tool-fs-native-write-approval.zh.md)

Status: implemented

## Problem

The compatibility filesystem bridge registered legacy `write` and `edit` schemas as Native contributions but invoked their Cordis tools without asking the selected Native approval owner. A Native `never` policy therefore did not protect those legacy-named mutations.

## Decision

When Native `approval` is selected, the bridge calls the admitted invocation's `call.authorize` before a legacy `write` or `edit` that does not provide both sandbox escalation fields. NativeTools binds that request to the live Agent, Session, call ID, and cancellation signal; the Native application owns the durable asked/decided events. The bridge tracks authorization and execution as one active call so Loader suspension drains both. If withdrawal aborts the call, the drain treats only the exact signal reason as expected cancellation while the original rejection remains visible to the Native caller; prompt and other work failures still fail suspension.

Calls that provide both `sandbox_permissions` and `justification` stay on the legacy sandbox escalation path. The bridge does not install another approval service or audit store. With no Native approval Provider, ordinary compatibility mutations retain their existing behavior.

## Alternatives considered

**Attach static approval metadata to every mutation contribution.** NativeTools would ask before the legacy tool can inspect its arguments, so an explicit escalation could receive a generic prompt before reaching its separate legacy approval path. The adapter instead selects ordinary authorization from the existing arguments.

**Mount a Cordis approval service or add adapter-owned audit records.** This would duplicate Native application authority and durable approval ownership. The existing NativeTools callback already carries the current invocation attribution and signal.

## Consequences

Ordinary compatibility writes and edits follow the selected Native approval policy and cannot enter the legacy mutation body after a rejection or unavailable authority. Reads remain unapproved. Explicit sandbox escalation retains the legacy approval requirement and fails closed when that legacy approval service is absent. The bridge creates no additional Session events.

## Testing

The focused compatibility integration cases exercise `never` and `ask` with `write` and `edit`, including the real file outcome and Native asked/decided pairs in the same persisted Session. A second pending `ask` write is cancelled by disabling the legacy tool-fs Loader entry; the write does not run, the entry stays withdrawn, and enabling it restores the contributions. The existing no-Native-approval write/edit case pins unchanged behavior without that Provider.
