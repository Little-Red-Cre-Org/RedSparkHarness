# Agent Note: SIWC login waits for callback completion

Status: implemented

English | [中文](2026-10-17-siwc-login-callback-completion.zh.md)

## Problem

The loopback callback replied to the browser before token exchange and identity validation completed, so the browser could report success for a login that later failed. Listener shutdown awaited `server.close()` while idle Chrome preconnect sockets remained open, delaying login completion until `requestTimeout`.

## Decision

The callback replies with success only after token exchange and identity validation succeed; failures receive generic text. Listener shutdown calls `closeAllConnections()` so idle sockets do not hold the callback server open. This extends the SIWC flow described in the [provider decision](../architecture/2026-10-08-codex-siwc-provider.md).

## Alternatives considered

**Reply before token exchange and identity validation.** Rejected because the browser could show success before the login was valid.

**Wait for `server.close()` to drain idle connections.** Rejected because Chrome preconnect sockets can keep shutdown pending until `requestTimeout`.

## Consequences

The browser waits for token exchange and identity validation before showing success, and failure text does not expose a specific authentication error. Idle browser connections no longer delay listener shutdown.

## Testing

Idle-connection regression tests cover both callback success and failure; they fail without the SIWC implementation change.
