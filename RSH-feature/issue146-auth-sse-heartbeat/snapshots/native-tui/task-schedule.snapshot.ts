/** Persistent root tasks survive native TUI session resume and application restart. */
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'
import { terminalScene } from '../../rsh/Programs/TUI/native-tui/tests/terminal-scene.ts'

it('creates and lists a scheduled root task through dsh and retains it after restart', async () => {
  await terminalScene(fileURLToPath(new URL('./task-schedule/', import.meta.url)), { taskScheduler: true })
})
