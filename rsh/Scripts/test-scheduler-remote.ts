/** Source-only Remote substitution for unit-test plugin assemblies. */

/**
 * Replace the scheduler's generated Remote contribution in source-mode unit tests.
 * Whole-client endpoint proxies own its namespace; the real Gateway still mounts and disposes the empty contribution.
 * @returns A virtual-module plugin that needs no generated lib files.
 */
export function schedulerRemoteTestPlugin() {
  const specifier = '@deepseek-ai/dsh-task-scheduler/remote'
  const virtualId = '\0dsh-test-task-scheduler-remote'
  return {
    name: 'dsh-test-task-scheduler-remote',
    enforce: 'pre' as const,
    resolveId(id: string) { return id === specifier ? virtualId : undefined },
    load(id: string) {
      if (id === virtualId) return 'export default { package: "@deepseek-ai/dsh-task-scheduler", descriptors: [] }'
    },
  }
}
