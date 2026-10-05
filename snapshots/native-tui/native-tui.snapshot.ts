/** Committed terminal input and tool results replay through the actual dsh profile. */
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'
import { terminalScene } from '../../rsh/Programs/TUI/native-tui/tests/terminal-scene.ts'

it('records terminal tools and multiple inputs, then resumes the same durable Session through dsh', async () => {
  await terminalScene(fileURLToPath(new URL('./interactive/', import.meta.url)))
})
