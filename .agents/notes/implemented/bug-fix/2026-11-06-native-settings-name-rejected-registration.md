# Agent Note: Native settings names the registration it cannot show

Status: implemented

English | [中文](2026-11-06-native-settings-name-rejected-registration.zh.md)

## Problem

The Native settings panel draws a fixed page set and then every page a package registered into `settings.section`. It de-duplicated the combined list by id, keeping the first row, and the built-in rows were concatenated ahead of the registered ones. A registration whose id matched a built-in page therefore disappeared: the slot registration succeeded, the page rendered nowhere, and nothing said so. The Plugins section had the same defect for its tab bar, where a registration named `config` produced two rows sharing one DOM id and one `aria-controls` target, so neither `getElementById` nor an assistive technology could tell which panel a tab owned.

Neither fault could fire in the shipped Native Web composition: only `ui-settings-models` (id `models`) and `ui-settings-plugin-inventory` (id `all`) register, and neither collides with a built-in. The first package to reuse a built-in id — the Cordis half's `ui-settings-plugins`, whose id is `plugins` — would have lost a whole page with no signal, which is [the fail-loud rule](../../../../AGENTS.md) the repository states for misconfiguration.

## Decision

Both surfaces walk the ids they are about to show and report the one they refuse:

```ts ignore-check
const shown = new Set(BUILT_IN_SECTIONS.map(section => section.id))
const registered = ledger.sections().flatMap((entry) => {
  if (shown.has(entry.id)) {
    console.warn(`[native-application] settings.section registration "${entry.id}" reuses an existing page id and is not shown`)
    return []
  }
  shown.add(entry.id)
  return [{ id: entry.id, label: entry.label ?? entry.id, order: entry.order }]
})
```

The Plugins tab bar applies the same walk over `['config']` and renders the filtered list, so the built-in configuration tab keeps its own id and the colliding registration contributes no row.

The report is a `console.warn`, not a throw. The panel is the one surface a user reaches to diagnose a composition, so a faulty package must not take it down; the warning names the slot and the id, which is what an author needs to fix it.

## Alternatives considered

**Throw from the shell when a registration collides.** Rejected: the settings panel is the diagnostic surface itself. A package that misregisters an id would then remove the place a user opens to discover which packages are installed.

**Keep the first row silently and let the slot registry reject duplicates.** Rejected for two reasons. The collision is not a slot-registry duplicate — a built-in page is not a registration, so nothing in `register` can see it. And a silent drop is exactly the behavior the issue names: the registration reports success and the product shows something else.

**Give each registration its own row and disambiguate at render time.** Rejected: the panel keys its body, its navigation selection, and its renderSlot filter by the section id, so two rows for one id would each open the same body.

## Consequences

- A composition can no longer lose a settings page or produce a duplicate tab id without a console record naming the slot and the id.
- The warning fires on every render that sees the collision, because the projection is rebuilt from the ledger rather than memoized. That is deliberate: the ledger changes at runtime and a memoized report would go stale.
- Coverage: `settings-slots.client.spec.tsx` registers a section under the built-in `general` id and asserts one navigation row plus the warning; `settings-page.spec.tsx` passes a tab named `config` and asserts the single configuration tab, its unchanged DOM id, no clone row, and the warning.
