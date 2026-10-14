# Agent Note: Native ACP presentation and listing

Status: implemented

English | [中文](2026-10-14-native-acp-presentation-and-listing.zh.md)

## Problem

Native ACP already accepted image prompts and durable Session facts, but its output projection and session listing lagged the compatibility ACP carrier.

## Decision

Native ACP projects committed assistant and tool-result image references as inline ACP image content through the existing attachment Provider. Asynchronous reads and notifications remain on the prompt's ordered notification queue; read-integrity and delivery failures reach the prompt response and close waits for accepted prompt work to drain.

Native ACP reports `usage_update` only when an assistant event records provider usage and its exact Session request context has a context-window capacity and the optional token meter is installed. Live events use their active Engine-owned Session. Resume presentation measures each event prefix through the read-only `Session.fromRestore` path with its stored header and inherited-event count; it creates no Session writer and does not select a replacement model route.

`sessionListPageSize` is a positive safe-integer configuration field with default `100`. Native ACP uses the compatibility carrier's canonical base64url cursor for newest-first ordering by descending `createdAt` and ascending UTF-8 Session id, so equal timestamps have a deterministic continuation order.

This addition does not claim ACP-wide parity. Audio and embedded-resource input, ACP question requests (human elicitation), MCP resources or prompts, and shutdown remain unsupported; resource-link input and machine permission requests retain their existing behavior.

## Alternatives considered

**Create another Session writer or measure usage through the current parent model.** Rejected because the Engine-owned Session and recorded request route are the authorities for durable events and capacity.

**Advertise every ACP channel while adding the missing output projection.** Rejected because audio, embedded-resource input, and human elicitation remain outside the confirmed compatibility surface.

## Consequences

ACP clients receive image output, route-backed token occupancy when its facts exist, and resumable pages without duplicating Agent, Session, or storage ownership. Stored-image corruption now fails the accepted prompt instead of silently dropping output.
