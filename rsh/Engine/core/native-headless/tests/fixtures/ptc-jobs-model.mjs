/** Controlled model; jobs and code execution are the selected real services. */
import { appendFileSync } from 'node:fs'

export const plugin = {
  apiVersion: 1, name: 'native-ptc-model', targets: ['host'], requires: ['agents', 'jobs'], optional: [], provides: ['model'],
  resolve(input) {
    if (typeof input.audit !== 'string') throw new Error('ptc-jobs: audit path required')
    return context => {
      const agents = context.require('agents')
      const jobs = context.require('jobs')
      let step = 0
      context.provide('model', { async *stream() {
        if (step++ === 0) {
          const agent = agents.requireInitiator()
          jobs.start({ agent, kind: 'task', label: 'Controlled background work', async run(signal, publishOutput) {
            publishOutput('background task running')
            await new Promise(resolve => {
              if (signal.aborted) resolve()
              else signal.addEventListener('abort', resolve, { once: true })
            })
            appendFileSync(input.audit, 'cancelled\n')
            return { status: 'cancelled', output: 'background task cancelled' }
          } })
          const programs = [
            ['wait-timeout', 'Hold a real job wait until code execution times out.', `const listed = await tools.job_list({});
void tools.job_output({job_id: listed.jobs[0].id, wait: true, timeout_ms: 600000});
while (true) {}`],
            ['cancel-job', 'Cancel the background job and read its terminal output.', `const listed = await tools.job_list({});
const live = await tools.job_output({job_id: listed.jobs[0].id});
await tools.job_kill({job_id: listed.jobs[0].id, reason: "finished"});
return live.text + "\\n" + (await tools.job_output({job_id: listed.jobs[0].id, wait: true})).text;`],
          ]
          const replay = input.script?.[0]
          if (replay !== undefined) {
            if (replay.kind !== 'chunks') throw new Error('ptc-jobs: expected recorded chunks')
            for (const chunk of replay.chunks) yield chunk.type === 'block-end' && chunk.block.type === 'tool-call' && chunk.block.id === 'cancel-job'
              ? { ...chunk, block: { ...chunk.block, arguments: JSON.stringify({ code: programs[1][2], description: programs[1][1] }) } } : chunk
            return
          }
          for (const [index, [id, description, code]] of programs.entries()) {
            yield { type: 'block-start', index, blockType: 'tool-call' }
            yield { type: 'block-end', index, block: { type: 'tool-call', id, name: 'run_code', arguments: JSON.stringify({code, description}) } }
          }
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
        } else {
          const replay = input.script?.[step - 1]
          if (input.script !== undefined) {
            if (replay?.kind !== 'chunks') throw new Error('ptc-jobs: recorded chunks exhausted')
            for (const chunk of replay.chunks) yield chunk
            return
          }
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Background task cancelled.' } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        }
      } })
    }
  },
}
