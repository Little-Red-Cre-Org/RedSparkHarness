# Agent Note: Installed optional packages in profile fallbacks

Status: implemented

English | [中文](2026-09-25-profile-module-fallback-optional-dependencies.zh.md)

## Problem

The dsh installation keeps Cordis compatibility packages optional so native profiles can start without them. Isolated profile directories still need installed optional packages in their module fallback when a selected compatibility composition names those packages.

## Decision

Profile fallback discovery follows installed `dependencies`, `optionalDependencies`, and `peerDependencies` at each package. It links an optional package only when the package is present in the installation; dependencies owned only by a selected bundle stay profile-local.

## Alternatives considered

**Continue traversing only `dependencies` and `peerDependencies`** — rejected because Cordis compatibility packages are installed as optional dependencies, so isolated profiles could not resolve them by package name.

## Consequences

Native profiles do not load compatibility packages merely because they are listed as optional installation dependencies. Cordis-enabled profiles can resolve installed compatibility rows from `$DSH_HOME/profiles/<name>`.

## Verification

The app-boot profile tests verify links for an optional installation dependency and its optional transitive dependency. The shipped Web scaffold exercises package-name resolution through the profile fallback.
