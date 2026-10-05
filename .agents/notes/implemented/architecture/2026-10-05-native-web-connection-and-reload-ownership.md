# Agent Note: Native Web Connection and Client reload ownership

Status: implemented

English | [中文](2026-10-05-native-web-connection-and-reload-ownership.zh.md)

## Problem

The native HTTP listener owns an authenticated Connection registry, but domain Providers need a service on the same registry to contribute RPC and Fetch routes. Watching only `rsh.client.json` misses changes to selected Client code and styles. Accepted requests and rebuilds must finish cleanup before their owner closes.

## Decision

The Web Host publishes `hostConnection` from its existing listener handle. Domain Providers register routes there; the carrier keeps browser authentication and route ownership. The Connection package exposes a bounded request owner that combines carrier and installation cancellation, closes admission before shutdown, and awaits accepted callbacks. Consumers retain their own JSON validation and failure classification.

The Client bundler records compiled input and unresolved import locations, including existing `node_modules` directories for missing package imports. Live reload observes those directories, serializes rebuilds, and publishes a complete asset map and revision only after a successful build. A failed build retains the current publication until missing relative or package imports are restored. Shutdown stops observation and waits for the accepted build.

## Alternatives considered

**Create a domain-specific Connection registry:** Rejected because it would split authentication and route ownership between the carrier and its Consumers.

**Watch the whole workspace recursively:** Rejected because unrelated changes would rebuild the browser graph and broaden filesystem observation.

## Consequences

Web domain Providers can use the carrier's authenticated `/api` channel without Cordis. The Host still does not create Agent or Session authority. Client reload replaces a built graph; it does not provide legacy plugin HMR or select the full product UI.

## Verification

Focused Connection request-lifetime and native Client reload scenarios cover admission, cancellation, source edits, failed builds and shutdown. Package build and native dependency gates verify the published Host and Client entries.
