/**
 * Command-directory cache re-exported for the Cordis entry.
 *
 * The cache itself is transport-free and lives in `catalog.ts`, which the
 * Native entry shares; this module keeps the Cordis package's existing public
 * name for it.
 */
export { CommandDirectory } from './catalog.ts'
export type { CommandDescriptor, DirectoryStatus, FetchCommands } from './catalog.ts'
