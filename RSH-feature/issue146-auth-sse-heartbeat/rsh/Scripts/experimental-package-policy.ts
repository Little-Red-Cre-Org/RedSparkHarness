/** Experimental packages that publish with the dsh release family without changing names. */
export const PUBLIC_EXPERIMENTAL_PACKAGE_DIRECTORIES = [
  'rsh/Modules/Community/experimental/agent-team',
  'rsh/Modules/Community/experimental/agent-team-profile',
  'rsh/Modules/Community/experimental/agent-team-web-profile',
  'rsh/Modules/Community/experimental/client-ui-agent-team',
  'rsh/Modules/Community/experimental/tool-agent-team',
] as const

const publicExperimentalPackageDirectories = new Set<string>(PUBLIC_EXPERIMENTAL_PACKAGE_DIRECTORIES)

/**
 * Whether an experimental package is an explicit public-release exception.
 * @param directory - repository-relative package directory.
 * @returns Whether the package publishes with the dsh family.
 */
export function isPublicExperimentalPackageDirectory(directory: string): boolean {
  return publicExperimentalPackageDirectories.has(directory)
}
