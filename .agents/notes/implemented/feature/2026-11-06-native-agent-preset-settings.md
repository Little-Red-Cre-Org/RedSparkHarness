# Agent Note: The Native preset registry serves the selection policy the picker writes

Status: implemented

English | [中文](2026-11-06-native-agent-preset-settings.zh.md)

## Problem

Agent presets have a user-writable selection policy: an `agent-presets` settings namespace with `default` and `modeSelectionEnabled`. The Cordis entry's companion adapter registers it, so the browser picker switch writes a field the Host reads when resolving an unnamed new Session.

The Native entry registered no such namespace. `native-web` composes a settings provider and the Native Settings page renders the `agent-presets` section — including the mode-selection switch — but writing that field changed nothing a Native Session could observe. Worse, the state was one-sided in the direction that matters: the switch persisted, and the registry went on resolving every fresh Session through the deployment default, so hiding the picker left a stale user choice able to decide a Session that no control reported.

## Decision

`@redspark/rsh-agent-presets/native` declares `optional: ['settings']` and registers `agent-presets` when the program composes one, with `{ default: config.default, modeSelectionEnabled: true }` as the base — the same base the Cordis adapter uses. The registration carries a `presentation` schema, because `NativeSettings.describe` lists only registrations that publish one and `mutate` refuses one that does not; without it the namespace exists for the document but is invisible to the page. The registration is owned by the installation, so unloading the module withdraws the namespace.

`NativeAgentPresetRegistry` takes that scope and reads a single `policy()` per resolution:

```ts ignore-check
private policy(): { readonly enabled: boolean; readonly defaultId: string } {
  const settings = this.settings?.get()
  if (settings === undefined) return { enabled: true, defaultId: this.defaultPreset }
  return {
    enabled: settings.modeSelectionEnabled,
    defaultId: settings.modeSelectionEnabled ? settings.default : this.defaultPreset,
  }
}
```

Both terms come from one snapshot, so the catalog and the resolution cannot disagree. While the picker is hidden, an unnamed new Session takes the deployment default even when the user document names another preset, because no control reports that choice; an explicitly named preset is unaffected, and a restored Session keeps the standing it ran on.

The resolver reads the merged section, so a partial write resolves the field it omits to the base. The section schema is strict, so an unknown field is refused rather than silently stored.

## Alternatives considered

**Register the namespace from the Web Host instead of the preset package.** Rejected: the policy is the preset domain's, and the Cordis entry already owns it there. Two owners would let the two runtimes resolve the same settings differently.

**Have the Native settings page write the deployment default when the picker is hidden.** Rejected: that is a client-side workaround for a Host policy, and it would still leave a second caller (headless, SDK) resolving the stale choice.

**Make `settings` required.** Rejected: the registry serves a roster with no settings provider composed perfectly well, and `optional` is how the Cordis side treats the same dependency.

**Read the policy once at registration.** Rejected: settings are hot-reloadable, and a cached policy would keep resolving after a write until the module restarted.

## Consequences

- Writing `modeSelectionEnabled` from the Native Settings page changes what the Host resolves, exactly as it does for the Cordis bundle: the page lists the namespace, `settings/mutate` accepts it, and the registry reads the new value on its next resolution.
- A deployment that composes no settings provider keeps the previous behaviour: the roster is served, the policy reports the picker as shown, and the deployment default governs.
- Coverage: `tests/native-settings.spec.ts` pins the no-provider default, the saved default while enabled, the deployment default while hidden, an explicit preset surviving the hidden picker, a settings write observed without rebuilding the registry, a restored Session keeping its standing, and the plugin body (base, empty-section resolution, partial write, unknown-field refusal, roster without a provider, and the owned registration).
