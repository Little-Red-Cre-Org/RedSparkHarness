/** Real dsh terminal fixture; only the external model response is substituted. */
import { mkdtempSync, mkdirSync, writeFileSync, lstatSync, realpathSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn, type IPty } from 'node-pty'
import { vi } from 'vitest'
import type { ReplayEntry } from '@deepseek-ai/dsh-llm-replay'
import { shippedNativeProfileComposition } from '../../../CLI/src/native-profile-template.ts'

const root = fileURLToPath(new URL('../../../../../', import.meta.url))

/** Create an isolated supported native composition and a deterministic model.
 * @param cancellation - whether the fixture model waits for cancellation and explicit cleanup release.
 * @param script - committed assistant responses for replay; omitted only by the cancellation fixture.
 * @param cleanupFailure - inject a controller teardown rejection after its real drain.
 * @param modelControls - publish a real adapter directory and install the shipped model-selection Provider.
 * @param humanInteractions - install existing question, tool and approval Providers.
 * @param presetMode - select the legacy fixture registry or shipped scope-owned compositions.
 * @param taskScheduler - install the shipped persistent task-scheduler Provider and Consumer.
 * @returns fixture paths and actual CLI launch and cleanup operations.
 */
export function terminalFixture(cancellation: boolean, script?: readonly ReplayEntry[], cleanupFailure = false,
  modelControls = false, humanInteractions = false, presetMode?: 'legacy' | 'shipped', taskScheduler = false) {
  const home = mkdtempSync(join(tmpdir(), 'rsh-native-tui-'))
  const workspace = join(home, 'work')
  const storage = join(home, 'sessions')
  const profile = join(home, 'profiles/native-tui')
  mkdirSync(workspace)
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(workspace, 'input.data'), 'visible file contents\n')
  const model = join(profile, 'node_modules/fixture-tui-model')
  const modelProvides = ['model', ...modelControls ? ['modelDirectory'] : [], ...presetMode === 'legacy' ? ['agentPresets'] : []]
  mkdirSync(model, { recursive: true })
  writeFileSync(join(model, 'package.json'), JSON.stringify({ name: 'fixture-tui-model', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: modelProvides } } }))
  writeFileSync(join(model, 'native.mjs'), `import { writeFile, access } from 'node:fs/promises';
    import { setTimeout as wait } from 'node:timers/promises';
    ${presetMode === 'legacy' ? `import { NativeAgentPresetRegistry } from ${JSON.stringify(pathToFileURL(join(root, 'rsh/Engine/preset/agent-presets/lib/native.js')).href)};` : ''}
    ${modelControls ? `import { NativeAdapterModelDirectory } from ${JSON.stringify(pathToFileURL(join(root, 'rsh/Engine/core/native-model-execution/lib/adapter-directory.js')).href)};` : ''}
    ${cleanupFailure ? `import { NativeTuiApplication } from ${JSON.stringify(pathToFileURL(join(root, 'rsh/Programs/TUI/native-tui/lib/native.js')).href)};
    const controller = Object.getPrototypeOf(NativeTuiApplication.prototype);
    const close = controller.close;
    controller.close = async function () { await close.call(this); throw new Error('fixture executor cleanup failed'); };` : ''}
    const home = ${JSON.stringify(home)};
    let pauseFirstRequest = ${String(presetMode === 'shipped')};
    const script = ${JSON.stringify(script ?? [])};
    export const plugin = { apiVersion: 1, name: 'fixture-tui-model', targets: ['host'], requires: [], provides: ${JSON.stringify(modelProvides)},
      resolve: () => context => { const adapter = { async *stream(request) {
        if (pauseFirstRequest && request.messages.at(-1)?.source?.kind === 'goal') {
          pauseFirstRequest = false;
          await writeFile(home + '/goal-request.json', JSON.stringify(request.messages));
          await writeFile(home + '/goal-request-started', 'started');
          await new Promise(resolve => { if (request.signal.aborted) resolve(); else request.signal.addEventListener('abort', resolve, { once: true }); });
          await writeFile(home + '/goal-request-aborted', 'aborted');
          throw request.signal.reason;
        }
        if (${String(cancellation)}) {
          await writeFile(home + '/started', 'started');
          await new Promise(resolve => { if (request.signal.aborted) resolve(); else request.signal.addEventListener('abort', resolve, { once: true }); });
          await writeFile(home + '/aborted', 'aborted');
          for (;;) { try { await access(home + '/release'); break; } catch (error) { if (error.code !== 'ENOENT') throw error; await wait(10); } }
          await writeFile(home + '/cleaned', 'cleaned');
          throw request.signal.reason;
        }
        if (request.messages.filter(message => message.role === 'assistant').length === 0) {
          await writeFile(home + '/started', 'started');
          for (;;) { try { await access(home + '/release'); break; } catch (error) { if (error.code !== 'ENOENT') throw error; await wait(10); } }
        }
        await writeFile(home + '/request.json', JSON.stringify(request.messages));
        await writeFile(home + '/config.json', JSON.stringify({ provider: request.provider, model: request.model, reasoningEffort: request.reasoningEffort }));
        const index = request.messages.filter(message => message.role === 'assistant').length;
        const entry = script[index];
        if (entry?.kind !== 'chunks') throw new Error('terminal replay exhausted');
        for (const chunk of entry.chunks) yield chunk;
      }, ...(${String(modelControls)} ? { providerInfo: id => ({ id, name: 'Fixture Provider' }),
      listModels: async provider => ['fixture', 'fixture-alt'].map(id => ({ provider, id, name: id })),
      resolveModel: async (provider, id) => ({ provider, id, name: id, inputModalities: ['text'], context: { contextWindow: 4096 },
        reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } }) } : {}) };
      context.provide('model', adapter);
      ${presetMode === 'legacy' ? `const registry = new NativeAgentPresetRegistry('standard', context.scope); context.own(() => registry.dispose());
      for (const id of ['standard', 'alternate']) context.effect(registry.register({ id, name: id, scope: context.scope }));
      context.provide('agentPresets', registry);` : ''}
      ${modelControls ? 'const directory = new NativeAdapterModelDirectory(adapter, () => [\'fixture\'], context.signal); context.own(() => directory.dispose()); context.provide(\'modelDirectory\', directory);' : ''}
      } };`)
  if (presetMode === 'shipped') {
    const collision = join(profile, 'node_modules/fixture-tui-help-command')
    mkdirSync(collision, { recursive: true })
    writeFileSync(join(collision, 'package.json'), JSON.stringify({ name: 'fixture-tui-help-command', type: 'module',
      exports: { './native': './native.mjs', './package.json': './package.json' },
      dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['commands'], optional: [], provides: [] } } }))
    writeFileSync(join(collision, 'native.mjs'), `import { writeFile } from 'node:fs/promises';
      const home = ${JSON.stringify(home)};
      export const plugin = { apiVersion: 1, name: 'fixture-tui-help-command', targets: ['host'], requires: ['commands'], provides: [],
        resolve: () => context => context.effect(context.require('commands').register({ name: 'help', description: 'Fixture collision must remain local',
          handler: async () => { await writeFile(home + '/help-command-ran', 'unexpected'); return { kind: 'success', text: 'fixture help ran' }; },
        }, context.scope)) };`)
  }
  const shipped = shippedNativeProfileComposition(home, 'native-tui')
  const selected = new Set(['app', 'session-execution', 'agents', 'tools', 'model-execution', 'storage'])
  if (presetMode === 'shipped') for (const id of ['prompt', 'goal', 'goal-round-driver', 'tool-goal', 'tool-todo', 'tool-todo-minimal',
    'commands', 'command-goal', 'agent-presets', 'preset-standard', 'preset-minimal']) selected.add(id)
  if (modelControls) selected.add('model-selection')
  if (taskScheduler) selected.add('task-scheduler')
  if (humanInteractions) for (const id of ['approval', 'user-questions', 'ask-user-tool']) { selected.add(id) }
  const installations = shipped.installations.filter(row => selected.has(row.id)).map(row => row.id === 'app'
    ? { ...row, config: { ...row.config as object, cwd: workspace, provider: 'fixture', model: 'fixture', maxSteps: humanInteractions ? 5 : 3 } }
    : row.id === 'storage' ? { ...row, config: { root: storage, compression: 'none' } } : row)
  installations.push({ id: 'fs', plugin: '@deepseek-ai/dsh-fs-local', scope: 'root', config: { cwd: workspace } },
    { id: 'model', plugin: 'fixture-tui-model', scope: 'root' })
  if (presetMode === 'shipped') installations.push({ id: 'help-command-fixture', plugin: 'fixture-tui-help-command', scope: 'root' })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'native-tui-fixture', private: true,
    dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } } }))
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({ ...shipped, installations }))
  const processes: { child: IPty; completion: Promise<{ exitCode: number }>; exited: boolean }[] = []
  return {
    home, workspace, storage,
    launch(args: readonly string[] = []) {
      let output = ''
      const env = Object.fromEntries(Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined && !/KEY|SECRET|TOKEN|PASSWORD/i.test(entry[0]),
      ))
      const child = spawn(process.execPath, [join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-tui', ...args], {
        name: 'xterm-256color', cols: 100, rows: 30, cwd: workspace, env: { ...env, DSH_HOME: home, FORCE_COLOR: '0' },
      })
      child.onData((data) => { output += data })
      let resolveCompletion!: (event: { exitCode: number }) => void
      const completion = new Promise<{ exitCode: number }>((resolve) => { resolveCompletion = resolve })
      const run = { child, exited: false, completion }
      child.onExit((event) => { run.exited = true; resolveCompletion(event) })
      processes.push(run)
      return {
        write: (text: string) => { child.write(text) },
        async submit(text: string) {
          const start = output.length
          child.write(text)
          await vi.waitFor(() => { if (!output.slice(start).includes(text)) throw new Error(output.slice(-3000)) }, { timeout: 30000 })
          child.write('\r')
        },
        output: () => output,
        async waitFor(text: string, start = 0) { await vi.waitFor(() => {
          if (!output.slice(start).includes(text)) throw new Error(`terminal missing ${text}: ${output.slice(-3000)}`)
        }, { timeout: 30000 }) },
        done: run.completion,
      }
    },
    async cleanup() {
      writeFileSync(join(home, 'release'), 'release')
      for (const run of processes) {
        if (!run.exited) run.child.kill()
        await run.completion
      }
      if (dirname(realpathSync(home)) !== realpathSync(tmpdir()) || lstatSync(home).isSymbolicLink()) throw new Error('invalid terminal fixture root')
      rmSync(home, { recursive: true })
    },
    fixtureText: (path: string) => readFileSync(join(home, path), 'utf8'),
  }
}
