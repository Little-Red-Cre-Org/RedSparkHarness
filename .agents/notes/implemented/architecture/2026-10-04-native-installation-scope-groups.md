# Agent Note: Native installation scope groups

Status: implemented

English | [中文](2026-10-04-native-installation-scope-groups.zh.md)

## Problem

Independent scoped contributions can form one standing execution composition without reading each other's services. Preserving unchanged requests during replacement would retain part of that composition after a sibling changed.

## Decision

`NativeContext.groupInstallations()` registers its installation scope and descendants as one replacement and removal group. Group expansion and dependency propagation reach a fixed point before cancellation. The resolved successor activates only after every affected registration drains and every affected resource is released. Group ownership uses exact scope identity and the installation's effect lifetime; Core holds no Agent or preset types.

`ResourceOwner.drainRegistrations()` cancels and waits without disposing resources. The Host applies this barrier across all affected owners before reverse dependency cleanup. Replacement cleanup failure stops the Host and does not restore disposed predecessors.

## Consequences

Programs can bind independently registered contributions to one standing lifetime. Group replacement cancels every member, so resource consumers must finish admitted work during registration drain. Unrelated installation scopes retain their active owners.

## Alternatives considered

Service dependency inference cannot represent independent sibling contributions. Replacing the entire Host would cancel unrelated scopes. Scoped grouping explicitly names the shared lifetime while preserving unrelated installations.

## Validation

Actual Host tests verify unchanged-plan retention, sibling replacement, descendant removal, early unregistration and callback settlement before sibling resource release. Core does not select product presets; product selection is outside this change.
