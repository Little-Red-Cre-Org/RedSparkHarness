# Agent Note: RedSpark terminal rsh profile

Status: implemented

English | [中文](2026-09-15-redspark-terminal-rsh-profile.zh.md)

## Problem

Shell users need a persistent terminal conversation that shares the existing Agent, permission policy, presets, and durable Session storage. A separate Node application would bypass the supported profile launcher.

## Decision

The shipped `rsh` profile composes `dsh-base` with `dsh-rsh`. The named `tui-runner` plugin waits for Loader settlement and owns an Ink application plus an Agent handle. Presets mount Agent-scoped tools and prompt sections; the `ask` preset deliberately provides no tools.

The renderer derives completed output from Session events and transient output from `agent/assistant-stream`. Failed attempts clear transient output. Accepted user messages retain their transcript rows when later queued work is cancelled. Slash commands dispatch through the command service instead of entering the model inbox. Model and reasoning selectors validate routes through the LLM service; permission changes use the existing command. Preset replacement requires an idle Agent and flushes the previous Session before disposing its handle.

The renderer strips terminal commands and control bytes at every Text component, using Node's VT-control parser before removing remaining control bytes. Filtering only tool output would leave live model text, stored transcripts, and approval reasons able to emit clipboard or cursor commands. Ink adds trusted styling after filtering; the durable Session remains unchanged.

Approval requests for the owned Agent appear in the terminal. The user selects `y` for a one-time grant or `n` for rejection. Requests queue independently, and abort or plugin disposal cancels outstanding requests. Requests for other Agents delegate to the next answerer.

Normal exit cancels active and queued work, waits for Agent idleness, and awaits the final Session flush before requesting launcher shutdown. Flush failures report a failing exit. The launcher owns the bounded whole-application shutdown; the renderer does not force process exit. Plugin disposal removes terminal listeners and timers and disposes the owned Agent.

`rsh resume` lists stored sessions with the `session-` prefix and filters by the calling directory by default. The list reads complete history when persistence cannot supply an event count, so update sorting includes the final recorded event. Direct resume uses `agents.resume` and replays stored events into the transcript. The prefix also includes headless sessions; it is not an RSH-only provenance marker.

The Windows installer creates a checkout-bound shell shim forwarding to `dsh --profile rsh`. It refuses to overwrite an existing command. The UI derives from the MIT-licensed `gxinxing/deepseek-harness-tui`; its license and third-party notices accompany the package.

## Alternatives considered

A separate npm executable would create another application launch path. Reimplementing terminal layout and input would retain more owned renderer code than using Ink. The profile therefore keeps the established launcher and uses the maintained React terminal renderer.

## Verification

Package tests exercise argument parsing, stream conversion, viewport calculations, cancellation-before-flush ordering, flush failure, and mounted Ink interaction for command dispatch, failed-attempt cleanup, and approval selection. Build and documentation checks validate the package integration. These tests do not establish real-provider output quality or every terminal emulator's rendering behavior.

## Consequences

Terminal sessions share the base safety policy and storage. The composer is single-line, and the package does not provide mouse controls or session-wide approval grants. Resume currently selects the configured default model rather than recovering a previous route from the log. The Windows shim requires reinstallation when the checkout moves.
