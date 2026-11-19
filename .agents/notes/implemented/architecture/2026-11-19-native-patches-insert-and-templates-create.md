# Agent Note: Native patches insert installations and templates create custom profiles

Status: implemented

English | [中文](2026-11-19-native-patches-insert-and-templates-create.zh.md)

## Problem

Native `--patch` could only replace `config` and `disabled` on an installation that the profile already declared. A deployment that needed one extra plugin had to rewrite `rsh.profile.json` by hand, and the Python SDK smoke patches could not express their MCP client or code-runtime rows at all.

`--from-default-profile` created a Cordis profile from a bundle template. After the shipped standard names began booting Native, that flag was the only documented way to make a custom profile, and it produced a tree the Native runtime cannot boot. A custom Native profile therefore had no supported creation path.

## Decision

A Native patch row that carries `plugin` and `scope` appends a new installation. The id must be unused by the profile and by the same patch, the scope must be declared, and the plugin must be a package name. A row without `plugin` keeps the existing replacement behavior; a row that declares `scope` without `plugin` is refused rather than ignored. The composed result is re-validated through `parseNativeProfileConfig`, so insertion cannot bypass the scope, cycle, duplicate-id, or package-name checks.

`--from-default-profile native-<name>` copies one explicit Native template into a new custom profile directory. It writes `rsh.profile.json`, the `runtime: "native"` marker, and `rsh.client.json` for `native-web`; it writes no Cordis bundle list, `cordis.patch.yml`, or pnpm workspace. The target must be a non-shipped name and its directory must be absent or empty. Creation runs before the runtime resolver, so `--dump-config` prints the new composition without booting it.

Standard template names (`web`, `headless`, `sdk`, `acp`, `rsh`) keep creating legacy profiles in this cut. Their Native replacements are ready, but the Python SDK smoke and `dsh-pack-vfs-image` still create legacy profiles and patch Cordis rows; switching the names now would break those consumers before their Native ports land. The CLI exit makes the switch together with those ports.

## Alternatives considered

**Map every template name to Native immediately.** Rejected. `rsh/Scripts/smoke-python-runtime.py` and the WebWorker preview packer create `legacy-sdk`/`legacy-web` profiles and patch Cordis row ids; they need their own Native ports first.

**Add a separate `--from-native-template` flag.** Rejected. It would duplicate the creation rules and leave a second flag to delete when the legacy boot retires.

**Rewrite `rsh.profile.json` in the caller.** Rejected. That duplicates validation and gives the Python SDK's ordered `--patch` interface no Native form.

## Consequences

A Native deployment can add a plugin through one ordered patch row instead of editing the profile. `createNativeProfileFromTemplate` is the creation path the CLI exit uses for every template name. `dsh plugin` still manages only Cordis bundle lists, and the standard template names still create legacy profiles until that exit lands.
