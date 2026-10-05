# Agent Note: Native ACP resource links

Status: implemented

English | [中文](2026-10-05-native-acp-resource-links.zh.md)

## Problem

Standard ACP resource links carry references alongside text and images. Rejecting these references prevents native clients from submitting prompts supported by the compatibility carrier.

## Decision

Native ACP accepts standard resource links as the compatibility carrier's bracketed text with JSON-quoted name and URI. Adjacent text concatenates; image positions remain unchanged. The executor records the complete converted user message before model admission, so restored history contains the same references. The carrier does not fetch linked resources or accept embedded resources.

## Alternatives considered

Fetching linked resources would add unrequested filesystem or network operations and durable admission requirements. A separate content type would change model input semantics instead of preserving the existing textual reference.

## Consequences

Links require no additional Provider. Image preparation retains root execution ownership and cancellation. Protocol metadata does not enter model input. Context usage remains unavailable until the native token-meter capability supplies measured occupancy and capacity; the carrier publishes no invented token counts. Compatibility defaults remain unchanged.
