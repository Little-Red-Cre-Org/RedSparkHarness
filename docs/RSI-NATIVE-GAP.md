# Native 侧的 RSI 缺口：为什么桌面上挂不上，以及怎么补

Status: open. Written 2026-10-30 for whoever picks this up next.
Scope: why the `subagent_rsi` route that works in the Compatibility assembly has
no path in the Native assembly, and which repair is worth doing.

This note does not restate the working Compatibility route. For that, see the
`rsi.patch.yml` fixture and the `subagent-acp` row in
`rsh/Compatibility/DSH/bundle/base/cordis.patch.yml`.

---

## 1. The two assemblies register delegation differently

A Harness deployment picks one assembly. The Desktop release ships them
separately (`desktop-packages.json`, `assembly: "native" | "compatibility"`), and
the Desktop Host dispatches on the profile's own `runtime` marker:

```
rsh/Programs/DesktopHost/src/index.ts:168
  const runtime = profileDirectoryRuntime(absoluteProject) === 'native'
    ? await import('./native-host.ts').then(module => module.createNativeDesktopRuntime(...))
    : await createCompatibilityRuntime(...)
```

The two assemblies reach `ctx.subagents` through different seams, and that
difference is the entire gap:

| | Compatibility | Native |
|---|---|---|
| Registry | `ctx.subagents.registerProvider()` | `externalSubagentDriver` service |
| Plugin | `@deepseek-ai/dsh-subagent-acp` | `@deepseek-ai/dsh-acp-child` |
| Child command | config `command` / `args` / `env`, any executable | fixed launcher, dsh CLI only |
| Start capabilities | `agentOptions/outputSchema/depthLimit/toolFilter/persona` all `false` | one-shot, route from the parent's provider catalog |

The Compatibility provider genuinely starts an arbitrary process. The Native
driver does not, and cannot be configured to.

---

## 2. `fixedChildProcess` is the wall

`rsh/Programs/CLI/src/native-acp-child-runtime-launcher.ts:27`

```ts
function fixedChildProcess(request: NativeAcpChildRuntimeRequest, cwd: string, home: string, overlay: string): FixedChildProcess {
  const manifestPath = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh/package.json'))
  const packageRoot = dirname(manifestPath)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as CliManifest
  const bin = typeof manifest.bin === 'object' && manifest.bin !== null
    ? (manifest.bin as Record<string, unknown>).dsh : manifest.bin
  if (typeof bin !== 'string' || bin === '') throw new Error('dsh: CLI package declares no dsh executable')
  const builtBin = resolve(packageRoot, bin)
```

Read the argument list of the function. It takes `cwd`, `home`, and `overlay`,
and **not a command**. The executable is derived from
`@deepseek-ai/dsh`'s own `package.json` `bin`, resolved from this module's import
graph. There is no field on any layer above it that could substitute a
different executable, because there is no parameter to carry one.

The spawn shape is fixed too, `:56`:

```ts
argv: [process.execPath, ...nodeArgs, '--profile', 'native-acp-dsh-child', '--patch', overlay],
```

Note what that means. The child is always **this Node binary, running this dsh
CLI, booting the `native-acp-dsh-child` profile**. An ACP child under Native is
by construction another RedSpark Harness instance. `python -m rsi.cli
acp-stdio` is not expressible in that shape at all.

The profile it boots is likewise fixed, `rsh/Programs/CLI/src/native-profile-template.ts:172`:

```ts
if (profile === 'native-acp-dsh-child') {
  const parent = shippedNativeProfileComposition(home, 'native-acp', platform)
```

So both the program and the composition it runs are decided inside the launcher,
before any config is read.

---

## 3. `dsh-acp-child` refuses a third field

`rsh/Modules/Official/subagent/acp-child/src/native.ts:33` declares the whole
config surface:

```ts
interface Config {
  readonly providerName: string
  readonly providers: Readonly<Record<string, unknown>>
}
```

and `:54` enforces it as a closed set:

```ts
if (Object.keys(fields).some(field => field !== 'providerName' && field !== 'providers')) {
  throw new TypeError('dsh-acp-child configuration accepts only providerName and providers')
}
```

This rejection is deliberate, not incidental. `providers` is a **route catalog**,
not a process description: `:400` reads `config.providers[request.route.provider]`
and `:405` requires an `apiKeyEnv` off that entry. The driver's job is to start
a dsh child on a route the parent already knows. Adding `command` would not be a
field addition — it would change what the driver *is*.

There is a third wall behind these two, worth knowing before choosing a repair:
the Host credential Provider resolves the child's route from the parent's
visible pi-ai catalog, and the child keeps that exact route. That is a security
property (the child cannot widen its own authority), and any repair that
injects a foreign program has to answer what its route and credential mean.

---

## 4. Two candidates, and what each actually costs

### Candidate A — add `command`/`args` to `dsh-acp-child`

Rejected. Three reasons, in increasing severity:

1. The closed field set at `:54` exists to keep the driver's contract small. A
   `command` field makes every Native installation able to spawn any binary the
   Host user can execute, from a config file. That is the same authority
   Compatibility already grants, but Compatibility grants it through a
   first-class provider designed for it, while `dsh-acp-child` is on the Native
   security boundary where route and credential are derived, not configured.
2. `fixedChildProcess` would still need a new parameter, a new validation path,
   and a decision about what `--profile` means for a non-dsh child — because a
   Python process cannot boot a dsh profile. The overlay argument, the
   `DSH_HOME` write, and the `native-acp-dsh-child` template all become
   conditional on "is this child a dsh child", which is exactly the branch the
   design avoids today.
3. Every consumer that reasons about the driver would need the same conditional.
   Native Subagent, workflow, and ralph all select a driver by name and assume
   one uniform child shape.

Net: you would be adding a mode switch to a package whose entire value is that
it has no mode switch.

### Candidate B — a separate Native external driver package, outside `@deepseek-ai/*`

Recommended. A new package, e.g. `dsh-native-subagent-acp-external`, that
implements `NativeExternalSubagentDriver` and spawns a configured command. It
would:

- declare `provides: ['externalSubagentDriver']`, exactly like `acp-child` at
  `native.ts:566`, so `dsh-native-subagent` selects it by `providerName` with no
  change to the subagent Provider;
- own a `command` / `args` / `env` / `cwd` config of its own, mirroring what
  `@deepseek-ai/dsh-subagent-acp` already does — the shape is proven, and its
  README documents every field;
- answer the route question explicitly. Either it declares no route (an opaque
  foreign child, like Compatibility's `acp` provider, whose capabilities are all
  `false`), or it maps a named route to an `apiKeyEnv` the way `acp-child` does.
  Both are defensible; the first is what RSI actually needs, because RSI gets
  its model from its own `config.toml`, not from the parent's catalog.

Why separate rather than inside `acp-child`: no existing consumer changes, no
existing security property weakens, and the two drivers can be selected
independently. The cost is a new package and its own tests — but that package is
a bounded adapter, not a rework: `subagent-acp`'s whole client side is
`run.ts` at 25 KB, and the Native side would reuse the same
`@agentclientprotocol/sdk` 1.4.0 already pinned by `acp-child`.

**Judgement: Candidate B.** Candidate A pays in security surface and permanent
conditional branching to save one package. B pays one new package and leaves
every existing contract intact.

---

## 5. What is proven and what is not

Proven (real runs, this session):

- Compatibility assembly boots a legacy profile and serves the client:
  `{"ok":true,"status":200,"bytes":28786,"hasRoot":true}`.
- A real delegation over that assembly returns the RSI child's answer:
  `{"output":"child reported:\nRSI-ENGINE-OK"}`.
- RSI's own ACP handshake and one prompt, captured frame by frame:
  `initialize` -> `session/new` -> `agent_message_chunk("RSI-ENGINE-OK")` ->
  `{"stopReason":"end_turn","usage":{...}}`.

Not proven, and not to be reported as working:

- **A real model.** This machine has no usable plaintext API key.
  `.dsh/.credentials.yaml` holds an encrypted token; `api.deepseek.com` answers
  **401** for it. Every run above used a local stand-in model server. The
  transport, the ACP relay, the child spawn, and the tool loop are real; the
  token producer is not.
- **The Native route end to end.** Only the absence of a path is proven here
  (sections 2 and 3), not the behaviour of a package that does not exist yet.
- **Desktop double-click acceptance.** The development profile is prepared as
  Native on every `dev.ts` launch — `scripts/dev.ts:108` calls
  `prepareDevelopmentProject`, which ends at
  `src/project-manager.ts:1806 createDevelopmentProjectMetadata` and writes a
  Native manifest — so running a legacy profile under `dev.ts` needs that step
  changed, or a packaged release built with `--assembly compatibility`.

---

## 6. Three environment facts the next person will otherwise rediscover

1. **The venv ships only pip.** `openhands-sdk` and `openhands-tools` are both
   required; `rsi.cli acp-stdio` fails at the first prompt with
   `BackendError: the openhands SDK is not installed in this interpreter`.
2. **The two OpenHands packages must match.** Installing `openhands-tools`
   alone downgrades `openhands-sdk` (1.59.0 -> 1.49.1 here) and the prompt then
   dies with `ModuleNotFoundError: No module named 'openhands.sdk.subagent.scope'`.
   Pin both to the same version.
3. **`rsi` cannot be pip-installed, and `cwd` does not fix it.** The project
   file is `rsi-pyproject.toml`, not `pyproject.toml`, so
   `pip install -e .` refuses. `python -m` resolves against `sys.path`, not the
   working directory, so setting `cwd` has no effect — the child needs
   `PYTHONPATH` pointing at the project root.

---

## 7. Where the working pieces are

- Provider (host plane, both assemblies):
  `rsh/Compatibility/DSH/bundle/base/cordis.patch.yml` — `subagent-acp`.
- Tool row (agent plane):
  `rsh/Engine/preset/agent-presets/presets/standard/agent.cordis.yml` —
  `tool-subagent-rsi`, `disabled: true` until a deployment supplies a command.
  A delegation tool belongs to the agent plane because `web-app` disables every
  host-plane `tool-subagent` row (`bundle/web-app/cordis.patch.yml:475-489`) and
  lets each preset mount the ones its agent should see.
- Proof harness:
  `rsh/Compatibility/DSH/subagent/subagent-acp/tests/fixtures/loader/`
  — `rsi.patch.yml`, `rsi-driver.ts`, `rsi-delegating-llm.ts`.
