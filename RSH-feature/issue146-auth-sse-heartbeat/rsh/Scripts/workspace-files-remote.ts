/** Generate workspace-files Remote artifacts before Client source compilation. */

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { WorkspaceTypertGenerator } from '../Core/typert/generator/src/workspace.ts'

const PACKAGE = '@deepseek-ai/dsh-api-workspace-files'

/** Generate the Remote modules imported by the workspace-files Client sources. */
export function generateWorkspaceFilesRemoteArtifacts(): void {
  const root = resolve(import.meta.dirname, '..', '..')
  const output = resolve(root, 'rsh/Programs/Web/api/workspace-files/lib')
  const generator = new WorkspaceTypertGenerator(root)
  for (const artifact of generator.generate([PACKAGE], ['host'])) {
    mkdirSync(output, { recursive: true })
    writeFileSync(resolve(output, 'typert.host.js'), artifact.js)
    writeFileSync(resolve(output, 'typert.host.d.ts'), artifact.dts)
    if (!artifact.remote) throw new Error('Workspace Files Remote methods were not generated')
    writeFileSync(resolve(output, 'typert.remote-client.js'), artifact.remote.js)
    writeFileSync(resolve(output, 'typert.remote-client.d.ts'), artifact.remote.dts)
    writeFileSync(resolve(output, 'typert.remote-client.d.ts.map'), artifact.remote.dtsMap)
  }
}

if (import.meta.main) generateWorkspaceFilesRemoteArtifacts()
