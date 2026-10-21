import { clientBundle } from '../../client/tsdown.client.ts'
import { WorkspaceTypertGenerator } from '../../typert/generator/lib/types/workspace.js'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const name = '@deepseek-ai/dsh-task-scheduler'
// Analyze only this opt-in package; unrelated non-publishing workspace services are not contributors.
const reflection = {
  name: 'task-scheduler-remote',
  writeBundle() {
    const root = resolve(import.meta.dirname, '../../..')
    const generator = new WorkspaceTypertGenerator(root, { checkDiagnostics: false })
    for (const artifact of generator.generate([name], ['host'])) {
      const out = resolve(import.meta.dirname, 'lib')
      writeFileSync(resolve(out, 'typert.host.js'), artifact.js)
      writeFileSync(resolve(out, 'typert.host.d.ts'), artifact.dts)
      if (!artifact.remote) throw new Error('Scheduler Remote methods were not generated')
      writeFileSync(resolve(out, 'typert.remote-client.js'), artifact.remote.js)
      writeFileSync(resolve(out, 'typert.remote-client.d.ts'), artifact.remote.dts)
      writeFileSync(resolve(out, 'typert.remote-client.d.ts.map'), artifact.remote.dtsMap)
    }
  },
}
export default clientBundle(name, ['lib/types/index.js'], { hostPhase: true, lib: { plugins: [reflection] } })
