# Agent Note: Native Session Schedule fold

Status: implemented

English | [中文](2026-11-14-native-session-schedule-fold.zh.md)

## Problem

The Cordis Web catalog reads the `schedule` session projection for the selected Session and shows the same records in the sidebar marker. The Native catalog read only `scheduler.listSchedules()`, which is owner-scoped and lists task-scheduler plans, not `schedule/change` records written by the Schedule package. A stored reminder therefore produced neither the header catalog nor the sidebar marker, and seeding the replay fixture did not fill the scheduler.

## Decision

The Host Session list folds `schedule/change` from the bounded history it already reads for the row's title and blank state, after the Session's `inheritedEventCount`. An unreadable history or a record that cannot be decoded reports `hasActiveSchedule: false`; the list does not read a second copy of the log.

The Native catalog subscribes to `clientNativeConversation`, folds the selected Session's already-loaded events with the same rule, and merges those rows with scheduler frames by id. A log row wins a shared id. Log rows use the browser half's `formatScheduleFrequency`, so the frequency text matches the Cordis catalog.

The fold reads only events the controller has loaded. The catalog does not scan persisted Sessions, adopt an already-published root, or wake a cold owner. Those limits are the Schedule package's owner rules, not an optimization.

## Alternatives considered

**Mount the Schedule projection plugin in `native-web`.** That is the Cordis implementation the Native client is replacing, and the runtime owner would attach only to future live roots. It still would not cover a stored Session that the user opened without sending a prompt.

**Make `scheduler.listSchedules()` scan Session logs.** The scheduler is owner-scoped and the list runs for every stored Session; reading and folding every log there would cross the owner boundary and duplicate the history read.

**Render only scheduler rows.** The catalog would stay empty for every reminder that exists only in the durable `schedule/change` stream, including the replay fixtures.

## Consequences

A stored reminder is visible in the header catalog and sidebar marker while its Session is open, without an active scheduler owner or a model request. Log rows are read-only, which the catalog already is; scheduler rows keep their own controls. A corrupt or undecodable record degrades to no marker instead of failing the Session list, and the selected Session's loaded events remain the only input.
