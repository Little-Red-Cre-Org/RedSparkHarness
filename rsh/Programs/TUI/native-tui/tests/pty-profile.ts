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
 * @returns fixture paths and actual CLI launch and cleanup operations.
 */
export function terminalFixture(cancellation: boolean, script?: readonly ReplayEntry[], cleanupFailure = false) {
  const home = mkdtempSync(join(tmpdir(), 'rsh-native-tui-'))
  const workspace = join(home, 'work')
  const storage = join(home, 'sessions')
  const profile = join(home, 'profiles/native-tui')
  mkdirSync(workspace)
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(workspace, 'input.data'), 'visible file contents\n')
  const model = join(profile, 'node_modules/fixture-tui-model')
  mkdirSync(model, { recursive: true })
  writeFileSync(join(model, 'package.json'), JSON.stringify({ name: 'fixture-tui-model', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['model'] } } }))
  writeFileSync(join(model, 'native.mjs'), `import { writeFile, access } from 'node:fs/promises';
    import { setTimeout as wait } from 'node:timers/promises';
    ${cleanupFailure ? `import { NativeTuiApplication } from ${JSON.stringify(pathToFileURL(join(root, 'rsh/Programs/TUI/native-tui/lib/native.js')).href)};
    const controller = Object.getPrototypeOf(NativeTuiApplication.prototype);
    const close = controller.close;
    controller.close = async function () { await close.call(this); throw new Error('fixture executor cleanup failed'); };` : ''}
    const home = ${JSON.stringify(home)};
    const script = ${JSON.stringify(script ?? [])};
    export const plugin = { apiVersion: 1, name: 'fixture-tui-model', targets: ['host'], requires: [], provides: ['model'],
      resolve: () => context => context.provide('model', { async *stream(request) {
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
        const index = request.messages.filter(message => message.role === 'assistant').length;
        const entry = script[index];
        if (entry?.kind !== 'chunks') throw new Error('terminal replay exhausted');
        for (const chunk of entry.chunks) yield chunk;
      } }) };`)
  const shipped = shippedNativeProfileComposition(home, 'native-tui')
  const selected = new Set(['app', 'session-execution', 'agents', 'tools', 'model-execution', 'storage'])
  const installations = shipped.installations.filter(row => selected.has(row.id)).map(row => row.id === 'app'
    ? { ...row, config: { ...row.config as object, cwd: workspace, provider: 'fixture', model: 'fixture', maxSteps: 3 } }
    : row.id === 'storage' ? { ...row, config: { root: storage, compression: 'none' } } : row)
  installations.push({ id: 'fs', plugin: '@deepseek-ai/dsh-fs-local', scope: 'root', config: { cwd: workspace } },
    { id: 'model', plugin: 'fixture-tui-model', scope: 'root' })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'native-tui-fixture', private: true,
    dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } } }))
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({ ...shipped, installations }))
  let child: IPty | undefined
  let completion: Promise<{ exitCode: number }> | undefined
  let output = ''
  let exited = true
  return {
    home, workspace, storage,
    launch(args: readonly string[] = []) {
      output = ''
      exited = false
      const env = Object.fromEntries(Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined && !/KEY|SECRET|TOKEN|PASSWORD/i.test(entry[0]),
      ))
      child = spawn(process.execPath, [join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-tui', ...args], {
        name: 'xterm-256color', cols: 100, rows: 30, cwd: workspace, env: { ...env, DSH_HOME: home, FORCE_COLOR: '0' },
      })
      child.onData((data) => { output += data })
      completion = new Promise(resolve => child!.onExit((event) => { exited = true; resolve(event) }))
      return {
        write: (text: string) => { child!.write(text) },
        async submit(text: string) {
          const start = output.length
          child!.write(text)
          await vi.waitFor(() => { if (!output.slice(start).includes(text)) throw new Error(output.slice(-3000)) }, { timeout: 30000 })
          child!.write('\r')
        },
        output: () => output,
        async waitFor(text: string) { await vi.waitFor(() => { if (!output.includes(text)) throw new Error(`terminal missing ${text}: ${output.slice(-3000)}`) }, { timeout: 30000 }) },
        done: completion,
      }
    },
    async cleanup() {
      if (child !== undefined) {
        writeFileSync(join(home, 'release'), 'release')
        if (!exited) child.kill()
        await completion
      }
      if (dirname(realpathSync(home)) !== realpathSync(tmpdir()) || lstatSync(home).isSymbolicLink()) throw new Error('invalid terminal fixture root')
      rmSync(home, { recursive: true })
    },
    fixtureText: (path: string) => readFileSync(join(home, path), 'utf8'),
  }
}
