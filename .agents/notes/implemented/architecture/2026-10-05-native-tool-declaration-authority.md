# Agent Note: Pure tool declaration authority

Status: implemented

English | [中文](2026-10-05-native-tool-declaration-authority.zh.md)

## Problem

Native and compatibility Consumers need the same file diff fields and durable PTC event payloads without importing a Cordis tool registry. Separate declarations could diverge while describing the same recorded data.

## Decision

NativeTools owns FileDiff in its pure presentation export and the two PTC payloads and SessionEventMap members in its pure types export. Tools forwards those declarations. Host and Client compiler faces share only these leaves; the native registry remains Host-only.

## Consequences

Existing imports through Tools preserve the same types and Session augmentation. Event names, payload fields, known-event vocabulary and released Session generations remain unchanged. This declaration publication does not add PTC execution, result policies or another writer.

## Alternatives considered

Duplicating payloads would split the recorded-data authority. Importing the compatibility registry would unnecessarily require Cordis for native declarations. Publishing an unused restriction interface would expand the API without a Consumer.

## Verification

Owner compilation and publication checks validate both declaration leaves and the compatibility forwarding exports. The persistence catalog generator locates the PTC events at the NativeTools source; its event vocabulary is unchanged.
