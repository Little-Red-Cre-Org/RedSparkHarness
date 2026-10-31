---
name: editing-native-presets
description: Use when creating, changing, or validating a Native Agent preset — writing agent.native.json, adding or removing a plugin row, deciding whether a row belongs in the profile or in one preset, or checking why a preset did not become selectable.
---

# Editing Native presets

A preset is one directory. `preset.yml` holds the display name and description. `agent.native.json` holds the plugins that apply only to sessions that select it.

## Off-limits

Do not edit or delete a shipped preset. Copy it into the Harness home's `.agent-presets/<id>/` directory — take the real path from the roster rather than assuming the home's name. An upgrade overwrites the shipped directory.

## File

`agent.native.json` uses `formatVersion: 1`. Each installation has `id`, `plugin`, and optional `config` and `disabled`. `plugin` is a package name the profile can already resolve. Writing a package on disk does not install it.

The Host installs those rows into that preset's child scope. Shared services stay in the profile `rsh.profile.json`. A preset owns only rows that should apply to sessions that select it: persona, a tool presentation, a skill root, or another preset-scoped contribution.

## Check

After writing the file, restart the Host. A missing `agent.native.json` shows as needs-migration. An unresolvable package, or a row whose required service the profile does not provide, shows as invalid and does not stop the Host. A ready preset appears in the picker.

Do not write `cordis.yml` for a new preset.
