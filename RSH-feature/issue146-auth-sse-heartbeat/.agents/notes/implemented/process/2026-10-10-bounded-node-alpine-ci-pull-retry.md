# Agent Note: Bounded retries for Node Alpine CI image pulls

Status: implemented

English | [中文](2026-10-10-bounded-node-alpine-ci-pull-retry.zh.md)

## Problem

The Linux Node addon jobs can fail before their compatibility tests start when Docker times out fetching an auth token for an official Node Alpine image. The observed failures share a specific Docker Hub token endpoint and response-header timeout.

## Decision

The four Linux Alpine steps in the [workflow](../../../../.github/workflows/node-addon-system.yml) use a pull-only [helper](../../../../rsh/Core/native/system/scripts/pull-node-image.mjs). It retries once, after one second, only when pull stderr contains both "auth.docker.io/token" and "Client.Timeout exceeded while awaiting headers". After a successful pull, the workflow invokes the existing container command once with "--pull=never", preserving its image tag, mount, working directory, and test arguments. The [host-side test](../../../../rsh/Core/native/system/test/pull-node-image.test.js) covers both observed timeout messages without Docker or network access.

## Alternatives considered

**Retrying the complete container command.** Rejected because it would rerun tests and could blur a test failure with a registry transport failure.

**Retrying every pull error.** Rejected because authentication denial, missing tags, and unsupported platforms need to fail immediately instead of waiting through another pull.

**Changing the image source or Docker daemon settings.** Rejected because that changes the tested image source or runner configuration; a registry cache does not guarantee a separate recovery path.

## Consequences

Only the observed auth-token header timeout gains one additional pull. The official image references and compatibility test invocations stay unchanged, and a persistent registry failure remains a visible CI failure.