# Agent Note: Desktop Startup Error Redaction

Status: implemented

English | [中文](2026-10-16-desktop-startup-error-redaction.zh.md)

## Problem

Schema validation messages can contain configuration values. Renderer-facing startup failures must not expose those messages, nested causes, or user-named dictionary keys.

## Decision

The pi-ai native configuration producer keeps the original Schemastery validation error and its message for local diagnostics, and attaches the first schema issue with a path whose dictionary keys use their input-order positions when such a path exists. Composition resolution and stored settings use the same validation.

Desktop and DesktopHost project the first structured issue with a string rule found along an error cause or AggregateError chain; raw validator issues without a rule may name user dictionary keys and are ignored. They expose only string or number path segments and a string rule, without reading messages. Error types come from a fixed Error.name set; other names become `Error`.

## Alternatives considered

**Maintain a configuration-field whitelist in each Desktop package.** Rejected because pi-ai owns the schema and can produce safe paths directly.

**Show only a generic error.** Rejected because a safe field path helps users locate the invalid configuration entry.

## Consequences

Renderer state contains a localized error type, optional path and rule, and the local log path. Desktop appends raw startup and backend failures, including Host stderr, to `app.getPath('logs')/desktop.log`, and both the startup page and the emergency page show that path. Legacy plugin retries refresh backend state and report completion only after it reaches `ready`.

## Verification

The startup regression passes a real Authorization-array schema failure through `pi-ai` resolution and checks the numeric path, the absence of the fake token from error messages, stacks, causes, renderer payload JSON, and both error pages, and its presence in the local log file. The legacy plugin manager test checks that a failed retry does not report completion. Existing adapter and native module management tests retain cause-chain redaction assertions.
