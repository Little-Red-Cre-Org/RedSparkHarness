/**
 * Adapt an Engine binding to the legacy validated-section callback names.
 * @param binding - owner-local source attachment and validation operations.
 * @returns callbacks consumed by Cordis Settings registration.
 */
export function validatedSourceCallbacks<Source, Value>(binding: {
  bindSource(source: Source): void
  validate(value: Value): void
}): {
  setSource(source: Source): void
  validate(value: Value): void
  onChange(): void
} {
  return {
    setSource(source) { binding.bindSource(source) },
    validate(value) { binding.validate(value) },
    onChange() {},
  }
}
