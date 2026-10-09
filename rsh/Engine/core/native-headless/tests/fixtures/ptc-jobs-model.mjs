/** Controlled model; jobs and code execution are the selected real services. */
import { appendFileSync } from 'node:fs'

export const plugin = {
  apiVersion: 1, name: 'native-ptc-model', targets: ['host'], requires: ['agents', 'jobs', 'activeSessions'], optional: [], provides: ['model'],
  resolve(input) {
    if (typeof input.audit !== 'string') throw new Error('ptc-jobs: audit path required')
    return context => {
      const agents = context.require('agents')
      const jobs = context.require('jobs')
      const activeSessions = context.require('activeSessions')
      context.effect(activeSessions.onAttached(async owner => {
        if (owner.invocation !== 'root') return
        context.effect(owner.beforeStep(async (admission, next) => {
          if (admission.owner === owner && admission.turn === 1 && admission.step === 2) {
            owner.append('sandbox/mode', { mode: 'danger-full-access' })
            await owner.flush()
          }
          return next()
        }, 0))
      }))
      let step = 0
      context.provide('model', { async *stream(request) {
        const requestStep = step++
        if (requestStep === 0) {
          const programs = [
            ['wait-timeout', 'Hold a real job wait until code execution times out.', `await tools.bash({command: "printf 'background task running\\n'; sleep 30", description: 'Produce live background output', run_in_background: true});
const listed = await tools.job_list({});
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
            for (const chunk of replay.chunks) yield chunk.type === 'block-end' && chunk.block.type === 'tool-call' && ['wait-timeout', 'cancel-job'].includes(chunk.block.id)
              ? { ...chunk, block: { ...chunk.block, arguments: JSON.stringify({ code: programs[chunk.block.id === 'wait-timeout' ? 0 : 1][2], description: programs[chunk.block.id === 'wait-timeout' ? 0 : 1][1] }) } } : chunk
            return
          }
          for (const [index, [id, description, code]] of programs.entries()) {
            yield { type: 'block-start', index, blockType: 'tool-call' }
            yield { type: 'block-end', index, block: { type: 'tool-call', id, name: 'run_code', arguments: JSON.stringify({code, description}) } }
          }
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
        } else if (requestStep === 1) {
          const agent = agents.requireInitiator()
          if (jobs.list(agent)[0]?.status !== 'cancelled') throw new Error('ptc-jobs: Shell cancellation pending')
          appendFileSync(input.audit, 'cancelled\n')
          const call = ['session-mode-refusal', 'Verify the current Session mode is enforced by the confined runtime.', 'return 42']
          const replay = input.script?.[1]
          const recordedCall = replay?.kind === 'chunks' && replay.chunks.some(chunk => chunk.type === 'block-end'
            && chunk.block.type === 'tool-call' && chunk.block.id === call[0])
          if (recordedCall) {
            for (const chunk of replay.chunks) yield chunk.type === 'block-end' && chunk.block.type === 'tool-call'
              && chunk.block.id === call[0] ? { ...chunk, block: { ...chunk.block,
                arguments: JSON.stringify({ code: call[2], description: call[1] }) } } : chunk
            return
          }
          yield { type: 'block-start', index: 0, blockType: 'tool-call' }
          yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: call[0], name: 'run_code',
            arguments: JSON.stringify({ code: call[2], description: call[1] }) } }
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
        } else if (requestStep === 2) {
          const refusal = request.messages.flatMap(message => message.content)
            .find(block => block.type === 'tool-result' && block.toolCallId === 'session-mode-refusal')
          if (refusal?.isError !== true || !refusal.content.some(block => block.type === 'text'
            && block.text.includes('code-runtime-process-sandbox: confined policy required'))) {
            throw new Error('ptc-jobs: following model request lacks the durable confined-policy refusal')
          }
          const replay = input.script?.[2]
          if (replay !== undefined) {
            if (replay.kind !== 'chunks') throw new Error('ptc-jobs: recorded final chunks missing')
            for (const chunk of replay.chunks) yield chunk
            return
          }
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Background task cancelled.' } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        } else {
          throw new Error('ptc-jobs: unexpected model request ' + (requestStep + 1))
        }
      } })
    }
  },
}
