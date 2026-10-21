# Agent Note: Native terminal preset controls

Status: implemented

English | [中文](2026-10-05-native-terminal-preset-controls.zh.md)

## Problem

The native terminal could not select an installed standing Agent composition before its first turn.

## Decision

The terminal lists the selected Registry's metadata through `/mode`. Selection uses the existing root executor with the observed durable revision. Complete persisted history determines first-turn locking and cold restoration. Registry scopes, Agent leases and Session writers remain on the Host.

## Alternatives considered

Creating a terminal-owned preset registry would separate selection from the executor's persisted facts and installation lifetimes.

## Consequences

Custom profiles can select their explicitly installed standing compositions. The shipped template still needs its own preset installer. Selection submits no model request, and a started Session refuses further changes.
