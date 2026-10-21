# Agent Note: Native SDK closed-turn forks

Status: implemented

English | [中文](2026-10-05-native-sdk-fork.zh.md)

## Problem

Native SDK callers cannot create independent Sessions from accepted history, although the Engine already owns durable root forks.

## Decision

The native-sdk transport exposes session/fork and both SDKs expose Session and client methods. The Program uses its existing rootExecution.fork with an explicit route, readable source, fresh destination and optional closed-turn event anchor. Its shipped profile installs the existing Session-execution Provider; the Program explicitly requires execution and active-owner services.

## Consequences

The destination receives durable inherited history without a model request. Its next prompt restores that history; source bytes remain unchanged. Workspace, source ownership, closed-turn selection and fresh-destination admission remain Engine-owned. No second writer or history store is added. Compatibility SDK profiles do not serve this method.

## Alternatives considered

Copying history in SDK clients would duplicate released-format and storage admission. Replaying source prompts would invoke models and change accepted facts.
