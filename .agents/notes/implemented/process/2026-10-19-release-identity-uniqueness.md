# Agent Note: One package identity publishes one payload

Status: implemented

English | [中文](2026-10-19-release-identity-uniqueness.zh.md)

## Problem

A npm package identity is a name plus a version, and npm has no room for a second payload under that identity. `@deepseek-ai/dsh-tool-fs@0.1.5-rc.2` names exactly one tarball; a second one either overwrites the first or fails publication, and a consumer that received the first has no way to ask for the other. Publishing therefore has to prove, before it ships anything, that no package identity is claimed twice and that one identity never carries two versions.

`releaseFamily().members()` already enforced both halves while discovering a family's publishable manifests: it throws `<name> appears twice in release family <id>` when a second directory claims a name, and `verifyVersions` throws when members disagree on a version. Nothing exercised either rule. A release defect that only the guard prevents, with no test that the guard fires, leaves the guarantee resting on code nobody has run on purpose.

## Decision

One package identity carries one payload, and the packaging path enforces it at two points.

`releaseFamily().members()` keeps rejecting a duplicate name across a family, so two directories can never contribute one identity to a publication set. `verifyVersions()` keeps requiring one version across a family, so a single tag names the whole set.

`families.spec.ts` now proves both rules fire. Each case builds a throwaway root containing only the manifests the rule needs, so the guard is exercised against a real family rather than a mocked member list. A negative control that disables the `seen.has(name)` check fails the duplicate case, which shows the test measures the guard instead of passing beside it.

The packed artifact set is checked against the same rule: the 331 tarballs of the dsh family produced at the frozen P6 SHA carry 331 distinct names, all at `0.1.5-rc.2`, with no name appearing twice.

## Alternatives considered

**Compare the packed tarballs against each other and call that the check.** Rejected because it inspects one build's output. The rule has to hold for the next package too, so it belongs in the step that discovers what will publish, not in a scan of what already did.

**Trust the guard because it is obviously correct.** Rejected because "obviously correct" is exactly the claim a negative test settles. The duplicate case is cheap, and the disabled-guard control proves it is measuring the intended line.

**Let the registry reject duplicates at publish time.** Rejected because publication is the last step: a duplicate identity discovered there has already packed, uploaded part of a family, and can leave a partial release that needs manual repair. Failing during discovery costs nothing.

## Consequences

A second directory claiming an existing package name now fails `release:pack` with the name and the family, before any tarball is written. A family with two versions fails at the same stage, which keeps one tag sufficient to name a release.

The two spec cases add a temp root per run; they build only the manifests they read, so they stay fast and do not depend on the repository's own package set.

The check is per family. A package that legitimately publishes one name from two families — a compatibility build beside the native one — would need the rule extended rather than bypassed; today no such member exists, and the repository holds no duplicate publishable identity at all.
