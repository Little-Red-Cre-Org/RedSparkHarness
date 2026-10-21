# Agent Note: HMR waits for plugin-host descriptor ownership

Status: implemented

English | [中文](2026-09-22-plugin-host-hmr-descriptor-handoff.zh.md)

## Problem

Cordis module HMR removes a plugin runtime before its Fibers finish asynchronous disposal and starts replacement Fibers immediately. A replacement RSH adapter can therefore encounter its old package-name reservation and fail activation as a duplicate even though the old owner is leaving.

## Decision

`dsh-plugin-host` keeps synchronous duplicate rejection for active owners and direct registrations. An adapter replacement waits only when the existing reservation belongs to a Fiber whose terminal disposal has started. The reservation remains attributed to the old owner until its child and wrapper Fiber finish cleanup; a waiter then rechecks ownership before claiming the name. Disposal removes only its own reservation. A waiting Fiber that is disposed cannot start a child after the old owner settles.

The adapter registers its cleanup effect before starting the child, joins in-flight child disposal, and releases the descriptor after child cleanup. A separate settlement task observes the old wrapper Fiber's completion; the wrapper's own cleanup never awaits that task. Cordis remains the lifecycle authority, and neither the public descriptor format nor the Loader configuration changes. The broader ownership decision is recorded in the [runtime adaptation proposal](../../proposed/architecture/2026-09-21-rsh-runtime-layers-and-cordis-adaptation.md).

## Alternatives considered

**Release the package name as soon as HMR starts unloading.** The old child could still own effects, and its late disposer could erase the replacement's registration. Waiting for quiescence preserves exclusive ownership.

**Accept concurrent duplicate descriptors or change vendored HMR.** Concurrent ownership makes `get()` ambiguous; changing the vendored reload mechanism affects every Cordis plugin and requires upstream synchronization. The adapter owns the narrower wait needed for its own descriptor.

## Consequences

An adapted plugin starts after its predecessor finishes terminal teardown, while a second active adapter still fails immediately. Competing replacements cannot both claim the package name. A canceled replacement holds no reservation. Direct mounts retain synchronous duplicate rejection and do not join the adapter-only HMR handoff.

The package lifecycle tests reproduce Cordis's registry-delete/replacement sequence with a blocked asynchronous disposer, check cancellation and active duplicates, and exercise the Loader composition separately.
