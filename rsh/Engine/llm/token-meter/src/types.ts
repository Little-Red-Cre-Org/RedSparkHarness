/** Public compatibility metering and Session projection vocabulary. */
/** Token-meter plugin configuration; the fixed estimator has no settings. */
export type TokenMeterConfig = Record<string, never>
export type * from './meter-types.ts'
export type { ContextBreakdownProjection, ContextPressureProjection, TokenUsageProjection } from './projection.ts'
