/** Synthetic workspace paths owned by tests, not repository source references. */
const FIXTURE_REFERENCES: Readonly<Record<string, RegExp>> = {
  'rsh/Core/typert/generator/tests/type-model.spec.ts': /^packages\/client(?:\/|$)/,
  'rsh/Core/typert/generator/tests/tsdown-plugin.spec.ts': /^packages\/core\/tools(?:\/|$)/,
  'rsh/Programs/Web/client/modules/tests/node-half.client.spec.ts': /^packages\/client\/generated-/,
}

/**
 * Identify references to an owning test's synthetic workspace.
 * @param file - repository-relative filename with forward slashes.
 * @param reference - path token extracted by the package-path gate.
 * @returns whether this file owns the synthetic reference.
 */
export function isSyntheticPackageReference(file: string, reference: string): boolean {
  return FIXTURE_REFERENCES[file]?.test(reference) ?? false
}
