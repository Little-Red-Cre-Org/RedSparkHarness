---
description: "Persistent terminal conversations with model selection, session resume, and one-time approvals."
kind: "package-bundle"
---

# RedSpark terminal bundle

English | [中文](README.zh.md)

## Summary

The shipped `rsh` profile provides an interactive Ink terminal conversation over `dsh-base`. Users can choose a model, reasoning effort, Agent preset, and permission preset, then resume stored conversations. It requires an interactive terminal and uses the existing Agent and Session services.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Launch through `dsh --profile rsh`. The Windows [installer](../../../../Scripts/install-rsh.ps1) provides a checkout-bound `rsh` shim and refuses to overwrite an existing command. Use `rsh resume` for the session browser, or `rsh resume <session-id>` for direct resume. Resume uses the configured default model and the stored Agent preset.

`/model`, `/reasoning`, `/mode`, and `/permissions` open selectors. Other slash commands use the scoped command registry; unknown commands report an error. Enter submits or queues a message. During generation, Esc cancels and immediately submits a non-empty draft; Ctrl+C cancels without submitting. While idle, Ctrl+C exits. `/clear` clears the view without deleting model history.

Approval requests accept `y` for a one-time grant or `n` for rejection. Other keys do not grant permission. Cancellation withdraws the request. On normal exit the runner cancels queued and active work, waits for settlement, and flushes the Session before requesting shutdown; flush failures exit unsuccessfully.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Transcript rows and text helpers come from the [shared terminal presentation library](../../../../Programs/TUI/terminal-ui/README.md).

The [bundle patch](cordis.patch.yml) leaves shared services in the base composition and moves Agent-owned tools into the selected preset. The named runner waits for Loader settlement before mounting an Agent. Durable events drive completed transcript rows, while live assistant frames provide temporary output. Plugin teardown owns the Ink instance, timers, approval requests, and Agent handle.

No runtime invariant companion is published: the Agent, Session, and preset services own the independently observable relationships consumed by this renderer. Development checks are `pnpm --filter @deepseek-ai/dsh-rsh test` and `pnpm --filter @deepseek-ai/dsh-rsh lint`.

The UI derives from the MIT-licensed `gxinxing/deepseek-harness-tui`. Its license is preserved in [LICENSE](LICENSE), with dependency notices in [THIRD_PARTY_NOTICES.md](../../../../../THIRD_PARTY_NOTICES.md).

All displayed text passes through terminal-control filtering before Ink applies styling. Model output, tool results, session titles, and approval reasons cannot supply executable terminal escape sequences.

</details>

## Model Experience

None, as the runner submits ordinary user messages and the selected preset owns model-facing prompts and tools.

#### KV Cache effect

The renderer adds no request prefix. Model, preset, and command changes retain the cache behavior of their owning services.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The composer is single-line and has no mouse controls.
- Resume lists the shared `session-` namespace, which includes headless sessions; it does not restore the last model route.
- Terminal output can retain provider reasoning.
- The Windows shim requires reinstallation after moving the checkout.

<a id="dev-note"></a>
### Dev Note

None.
