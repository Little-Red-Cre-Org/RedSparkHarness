import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import tsconfigPaths from 'vite-tsconfig-paths'
import { resolvePwshPath } from './rsh/Modules/Official/shell/pwsh-local/src/resolve.ts'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin, vitestExecArgv } from './vitest.shared.ts'
import { schedulerRemoteTestPlugin } from './rsh/Scripts/test-scheduler-remote.ts'
import { COVERAGE_EXEMPT_ENV, coverageExemptHeavySuites } from './rsh/Scripts/coverage-exempt.ts'
import { COVERAGE_PARTITION_MODE_ENV } from './rsh/Scripts/coverage-partitions.ts'
import { PACKAGE_MANIFEST_GLOBS } from './rsh/Scripts/workspace-manifest-globs.ts'

// Prints exact `path:line:col` records for every uncovered statement, branch
// path, and function when a file misses the per-file 100% gate — the built-in
// threshold ERRORs name only the file. Absolute path because istanbul-reports
// require()s custom reporters (which is also why the reporter is CJS).
const uncoveredLocationsReporter = fileURLToPath(new URL('./rsh/Scripts/coverage-uncovered-locations.cjs', import.meta.url))

// Resolution facade shared by every plugin instance below: tsconfig.base.json
// has no include, which vite-tsconfig-paths treats as match-all, so its paths
// map applies to every test file. paths must win over package exports so built
// lib/ never loads a second module-singleton copy.
const pathsPlugin = (): ReturnType<typeof tsconfigPaths> => tsconfigPaths({ projects: ['./tsconfig.base.json'] })

const windowsUnsupportedPackages = process.platform === 'win32'
  ? [
      // Bash-requiring suites (a real POSIX shell is unavailable on Windows).
      // The pwsh-requiring suites (pwsh-local, tool-pwsh) deliberately stay
      // INCLUDED: PowerShell ships with Windows, so they run natively here.
      // This explicit list (not a 'rsh/Modules/Official/shell/*' glob) keeps
      // rsh/Modules/Official/shell/shell — the Service Definition package — running on Windows.
      'rsh/Modules/Official/shell/bash-local',
      'rsh/Modules/Official/shell/bash-sandbox',
      'rsh/Modules/Official/shell/tool-bash',
      'rsh/Modules/Official/hooks/*',
      'rsh/Modules/Community/experimental/code-runtime-python',
      'rsh/Modules/Official/sandbox/sandbox-local',
    ]
  : []

const windowsUnsupportedTests = process.platform === 'win32'
  ? [
      ...windowsUnsupportedPackages.map(path => `${path}/tests/**/*.spec.ts`),
      'rsh/Core/subprocess/subprocess/tests/**/*.spec.ts',
      'rsh/Core/subprocess/subprocess-local/tests/local.spec.ts',
      'rsh/Core/subprocess/subprocess-local/tests/process-inspector.spec.ts',
      'rsh/Core/subprocess/subprocess-local/tests/spawn.spec.ts',
      'rsh/Core/subprocess/subprocess-local/tests/terminal.spec.ts',
      // Oracle-diff suites: they compare the worker's POSIX path/url faces
      // against the host Node's own answers, which are win32 semantics on
      // Windows. The worker always speaks POSIX; the Linux lanes hold the diff.
      'rsh/Modules/Community/experimental/webworker-runtime/tests/node/path-diff.spec.ts',
      'rsh/Modules/Community/experimental/webworker-runtime/tests/node/shim-diff.spec.ts',
      // The subprocess ladder over the worker's child_process face: its kill
      // rung reaches the in-worker process table through `process.kill`,
      // which the ladder's win32 branch replaces with taskkill-by-real-pid —
      // undeliverable to a table pid. The worker host always reports 'linux',
      // so the Linux lanes hold the ladder.
      'rsh/Modules/Community/experimental/webworker-runtime/tests/node/child-process.spec.ts',
    ]
  : []

// These suites compare against or assemble the Worker's fixed Linux platform.
// Host-native Windows and macOS behavior is not their oracle.
const nonLinuxWebWorkerTests = process.platform === 'linux'
  ? []
  : [
      'rsh/Modules/Community/experimental/webworker-runtime/tests/node/fs-watch-stream.spec.ts',
      'rsh/Modules/Community/experimental/webworker-runtime/tests/node/sandbox-stack.spec.ts',
    ]

const platformUnsupportedTests = [...windowsUnsupportedTests, ...nonLinuxWebWorkerTests]

const windowsUnsupportedCoveragePackages = process.platform === 'win32'
  ? [...windowsUnsupportedPackages, 'rsh/Core/subprocess/*']
  : []

// Windows-only packages: their sources execute exclusively on win32 (koffi
// loads Win32 libraries), so the Linux coverage lane can never cover them.
// The Windows dev/CI lane exercises them through the probe/runner suites; the
// per-file 100% gate must not fail on their Linux-uncovered paths.
const windowsOnlyCoverageExclusions = process.platform !== 'win32'
  ? [
      'rsh/Modules/Official/sandbox/sandbox-windows-acl/src/**/*.ts',
      // The koffi-backed Win32 table (Toolhelp32/GetProcessTimes/taskkill)
      // executes only on win32; its decision logic is unit-pinned on every
      // host through the injected-internals suites.
      'rsh/Core/subprocess/subprocess-local/src/windows-inspector.ts',
    ]
  : []

// The confinement runner entry executes exclusively as a spawned child
// process (the sandbox seam's argv-prefix wrapper): its module-level main()
// would run the confinement in-process if imported, and vitest's v8 coverage
// never measures child processes. Its behavior is pinned end-to-end by
// tests/runner.spec.ts, which spawns the real entry through tsx.
const windowsRunnerCoverageExclusions = process.platform === 'win32'
  ? [
      'rsh/Modules/Official/sandbox/sandbox-windows-acl/src/runner.ts',
      // The session write lock's POSIX face (fs-ext flock plus inode
      // verification) executes only off-Windows: the Linux lanes hold its
      // per-file 100%, while the Windows branch is unit-pinned by
      // win32.spec's injected bindings and exercised natively by every
      // Windows suite through the real backend.
      'rsh/Engine/session/session-persistence-jsonl/src/lease.ts',
    ]
  : []

// pwsh-local's run/start/lifecycle suites self-skip without a real pwsh
// (executor.spec.ts hasPwsh), leaving this file
// far below per-file 100% on pwsh-less hosts; the exemption keeps those hosts
// green while CI runners ship pwsh and still enforce the full bar. The probe
// runs the suites' own resolution (the dependency-free resolve.ts module),
// so the exemption is active exactly when the suites skip — a mismatched
// narrower probe could exempt the file on hosts whose suites actually run.
const pwshCoverageExclusions = spawnSync(resolvePwshPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$true'], { encoding: 'utf8' }).status === 0
  ? []
  : [
      'rsh/Modules/Official/shell/pwsh-local/src/index.ts',
      'rsh/Modules/Official/shell/pwsh-sandbox/src/**/*.ts',
    ]

const testIncludes = [
  ...PACKAGE_MANIFEST_GLOBS.map(pattern => pattern.replace('/package.json', '/tests/**/*.spec.{ts,tsx}')),
  'rsh/Programs/*/tests/**/*.spec.ts',
  'rsh/Programs/Web/application/tests/**/*.spec.ts',
  'rsh/Scripts/**/*.spec.ts',
]

// The instrumented coverage gate sets this env; the exempt heavy suites then
// run beside it uninstrumented (membership contract in rsh/Scripts/coverage-exempt.ts).
// A set-but-not-'1' value is a misconfiguration, not a silent no-op.
const coverageExemptRaw = process.env[COVERAGE_EXEMPT_ENV]
if (coverageExemptRaw !== undefined && coverageExemptRaw !== '' && coverageExemptRaw !== '1') {
  throw new Error(`vitest config: ${COVERAGE_EXEMPT_ENV} must be '1' or unset, got ${JSON.stringify(coverageExemptRaw)}.`)
}
const coverageExemptExcludes = coverageExemptRaw === '1'
  ? coverageExemptHeavySuites.map(suite => suite.exclude)
  : []

const coveragePartitionRaw = process.env[COVERAGE_PARTITION_MODE_ENV]
if (coveragePartitionRaw !== undefined && coveragePartitionRaw !== '' && coveragePartitionRaw !== '1') {
  throw new Error(`vitest config: ${COVERAGE_PARTITION_MODE_ENV} must be '1' or unset, got ${JSON.stringify(coveragePartitionRaw)}.`)
}
const coveragePartitionMode = coveragePartitionRaw === '1'

// These suites exercise process-global state, process APIs, or timing-sensitive process I/O
// that worker threads cannot isolate reliably under aggregate gate contention.
// Keep the narrow exception in forks while the rest of the inventory avoids per-file processes.
const processBoundTests = [
  'rsh/Engine/session/session-persistence-jsonl/tests/jsonl.spec.ts',
  'rsh/Engine/subagent/subagent-acp/tests/subagent-acp.spec.ts',
  'rsh/Core/subprocess/subprocess-local/tests/process-exit.spec.ts',
  'rsh/Core/subprocess/subprocess-local/tests/spawn.spec.ts',
  'rsh/Engine/context/time-context/tests/time-context.spec.ts',
  'rsh/Engine/llm/llm-pi-ai/tests/adapter.spec.ts',
  'rsh/Compatibility/DSH/boot/app-boot/tests/app-boot.spec.ts',
  'rsh/Engine/workflow/workflow-worker-thread/tests/session.spec.ts',
]

export default defineConfig({
  plugins: [pathsPlugin(), standardDecoratorPlugin(), schedulerRemoteTestPlugin()],
  test: {
    setupFiles: ['./rsh/Scripts/test-proxy-environment.ts', './rsh/Scripts/test-invariants.ts'],
    // .tsx: client component specs (jsdom via per-file @vitest-environment pragma).
    include: testIncludes,
    exclude: platformUnsupportedTests,
    // One coverage invocation aggregates both projects. Every suite forks for
    // Node stability; process-bound suites stay separate for inventory control.
    projects: [
      {
        plugins: [pathsPlugin(), standardDecoratorPlugin(), schedulerRemoteTestPlugin()],
        test: {
          name: 'thread-safe',
          execArgv: vitestExecArgv,
          // Node 24 has aborted in its CJS lexer (v8::ToLocalChecked Empty
          // MaybeLocal in cjs_lexer::Parse) from worker threads on macOS,
          // Linux, and Windows. Forked workers avoid that shared thread path.
          pool: 'forks',
          setupFiles: ['./rsh/Scripts/test-proxy-environment.ts', './rsh/Scripts/test-invariants.ts'],
          include: testIncludes,
          exclude: [
            ...platformUnsupportedTests,
            ...processBoundTests,
            ...coverageExemptExcludes,
          ],
        },
      },
      {
        plugins: [pathsPlugin(), standardDecoratorPlugin(), schedulerRemoteTestPlugin()],
        test: {
          name: 'process-bound',
          execArgv: vitestExecArgv,
          pool: 'forks',
          setupFiles: ['./rsh/Scripts/test-proxy-environment.ts', './rsh/Scripts/test-invariants.ts'],
          include: processBoundTests,
          exclude: [
            ...platformUnsupportedTests,
            ...coverageExemptExcludes,
          ],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      // Coverage measures OUR runtime source. Types-only files carry no
      // executable code; vendor/ and application/config fixtures are out of scope.
      // .tsx: client components are gated like everything else (jsdom lane).
      include: PACKAGE_MANIFEST_GLOBS.map(pattern => pattern.replace('/package.json', '/src/**/*.{ts,tsx}')),
      // Types-only files have no runtime coverage. Importing self-executing bins/workers would boot
      // them inside the unit process, so real subprocess/Worker tests cover their thin entry glue.
      exclude: [
        ...PACKAGE_MANIFEST_GLOBS.flatMap(pattern => ['types.ts', 'bin.ts', 'worker.ts']
          .map(file => pattern.replace('/package.json', `/src/${file}`))),
        // Dynamic Host/Client composition is covered by its focused lifecycle
        // tests and assembled application checks rather than per-file coverage.
        'rsh/Modules/Official/extensions/*/src/**/*.{ts,tsx}',
        // A killed executable lint-contract test can leave a non-product source probe behind.
        ...PACKAGE_MANIFEST_GLOBS.map(pattern => pattern.replace('/package.json', '/src/oxlint-contract-*.ts')),
        // Client/web UI files whose remaining branches need a browser-grade
        // harness the jsdom lane doesn't cover yet. TODO(gui): cover and
        // remove as the client test lane matures.
        'rsh/Programs/Web/client/ui-trajectory/src/*',
        // Trajectory's compact Markdown projection retains deferred branch coverage.
        'rsh/Programs/Web/client/ui-primitives/src/markdown/plain-text.ts',
        'rsh/Programs/Web/client/ui-user-questions/src/client/QuestionComposer.tsx',
        'rsh/Programs/Web/client/ui-primitives/src/Menu.tsx',
        'rsh/Programs/Web/client/ui-primitives/src/RiskConfirmation.tsx',
        'rsh/Programs/Web/client/ui-workspace/src/client/WorkspaceBrowser.tsx',
        'rsh/Programs/Web/client/ui-workspace/src/client/WorkspacePicker.tsx',
        'rsh/Programs/Web/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx',
        'rsh/Programs/Web/client/ui-renderer/src/client/*',
        // Session object internals retain the runtime GUI debt exemption; the
        // assistant-stream reconciler, Controller entry, transport, Agent scope,
        // and adapters stay gated.
        'rsh/Programs/Web/api/session-controller/src/client/sessions/!(assistant-stream).ts',
        'rsh/Programs/Web/api/session-controller/src/client/ordered-baseline.ts',
        'rsh/Programs/Web/api/session-controller/src/client/time-zone.ts',
        // Keep the browser conversation tree under its existing GUI debt
        // exemption while gating the newly stateful Host half and vocabulary.
        'rsh/Programs/Web/client/ui-conversation/src/client/*',
        // Chat presentation and assembly retain the same GUI debt exemption;
        // package wiring and the new approval-detail adapter remain gated.
        'rsh/Programs/Web/client/ui-chat/src/client/chat/!(ApprovalCommand).{ts,tsx}',
        'rsh/Programs/Web/client/ui-chat/src/client/conversation-nodes/*',
        'rsh/Programs/Web/client/ui-chat/src/client/details/*',
        'rsh/Programs/Web/client/ui-chat/src/client/model/*',
        'rsh/Programs/Web/client/ui-chat/src/client/contract/context-provenance.ts',
        'rsh/Programs/Web/client/ui-chat/src/client/contract/snapshot.ts',
        'rsh/Programs/Web/client/ui-chat/src/client/historical-images.ts',
        'rsh/Programs/Web/client/ui-primitives/src/DisclosureRow.tsx',
        'rsh/Programs/Web/client/ui-tool/src/*',
        'rsh/Programs/Web/client/ui-slots/src/*',
        'rsh/Programs/Web/client/ui-layout/src/*',
        'rsh/Programs/Web/client/web/src/*',
        'rsh/Programs/Web/host/webserver/src/*',
        // The browser-worker runtime and its image packer: the executing
        // composition is a real dedicated Worker driven by the web browser lane
        // (rsh/Programs/Web/application/tests/preview-boot.e2e.ts), which unit-process V8 coverage
        // cannot observe. Unit specs cover the algorithmic cores; the assembled
        // evidence is that boot. TODO(webworker): revisit when a browser-grade
        // coverage lane exists.
        'rsh/Modules/Community/experimental/webworker-runtime/src/**',
        'rsh/Modules/Community/experimental/webworker-packer/src/*',
        // Inspector execution adapters run in a Node Worker, the Host native
        // inspector session, or a browser realm, outside attributable parent
        // Vitest coverage.
        'rsh/Modules/Community/experimental/inspector/src/client/**',
        'rsh/Modules/Community/experimental/inspector/src/host/bridge/**',
        'rsh/Modules/Community/experimental/inspector/src/host/cdp/**',
        'rsh/Modules/Community/experimental/inspector/src/worker/bridge/**',
        'rsh/Modules/Community/experimental/inspector/src/worker/cdp/**',
        'rsh/Modules/Community/experimental/inspector/src/worker/realms/**',
        'rsh/Modules/Community/experimental/inspector/src/worker/{entry,server}.ts',
        // Keep already-complete Inspector modules under the per-file gate and
        // enumerate the remaining direct-test debt instead of exempting src/**.
        // TODO(inspector): close these branch gaps and remove the entries.
        'rsh/Modules/Community/experimental/inspector/src/host/plugin.ts',
        'rsh/Modules/Community/experimental/inspector/src/shared/bridge/{control-codec,rpc}.ts',
        'rsh/Modules/Community/experimental/inspector/src/shared/bridge/messages/observation.ts',
        'rsh/Modules/Community/experimental/inspector/src/shared/bridge/messages/query/codec.ts',
        'rsh/Modules/Community/experimental/inspector/src/shared/bridge/messages/runtime/{command-codec,console-frames,frames,value-codec}.ts',
        'rsh/Modules/Community/experimental/inspector/src/shared/bridge/messages/sources/{codec,frames}.ts',
        'rsh/Modules/Community/experimental/inspector/src/worker/inspection/{cordis-store,query-router,realm-store}.ts',
        'rsh/Programs/Web/client/modules/src/client/system.ts',
        'rsh/Programs/Web/client/hmr/src/client/index.ts',
        // Web config-tree boot round: the new host-side web-transport halves
        // whose remaining branches need real-composition/process harnesses.
        // TODO(gui): cover and remove with the client test lane above.
        'rsh/Programs/Web/client/modules/src/index.ts',
        'rsh/Programs/Web/client/modules/src/invariant.ts',
        'rsh/Programs/Web/client/modules/src/client/index.ts',
        'rsh/Programs/Web/client/modules/src/client/manifest.ts',
        'rsh/Programs/Web/client/hmr/src/index.ts',
        'rsh/Programs/Web/client/hmr/src/invariant.ts',
        'rsh/Programs/Web/client/connection/src/index.ts',
        'rsh/Programs/Web/client/connection/src/http-bridge.ts',
        // This assembly imports generated Host-for-Client code that exists
        // only in lib; the post-build built-bin smoke executes both entries.
        'rsh/Programs/Web/api/remotes/src/index.ts',
        'rsh/Programs/Web/api/remotes/src/client/index.ts',
        // The Team browser entry binds its source-covered mount lifecycle to
        // the generated Team Remote contribution, which likewise exists only in lib.
        'rsh/Modules/Community/experimental/client-ui-agent-team/src/client/index.ts',
        // Slash/command/input round: per-file gaps deferred with the same
        // client-lane debt. TODO(gui): cover and remove with the lane above.
        'rsh/Programs/Web/client/connection/src/client/fixture.ts',
        'rsh/Programs/Web/client/ui-commands/src/index.ts',
        'rsh/Programs/Web/client/ui-skill/src/index.ts',
        'rsh/Programs/Web/client/ui-input-trigger/src/index.ts',
        'rsh/Programs/Web/client/ui-subagent/src/index.ts',
        'rsh/Programs/Web/client/ui-commands/src/client/popup.ts',
        'rsh/Programs/Web/client/ui-commands/src/client/directory.ts',
        'rsh/Programs/Web/client/ui-commands/src/client/service.ts',
        'rsh/Programs/Web/client/ui-commands/src/client/PopupSelectView.tsx',
        'rsh/Programs/Web/client/ui-model-selection/src/index.ts',
        'rsh/Programs/Web/client/ui-permission-presets/src/index.ts',
        'rsh/Programs/Web/client/ui-model-selection/src/client/ModelSelect.tsx',
        'rsh/Programs/Web/client/ui-model-selection/src/client/directory.ts',
        'rsh/Programs/Web/client/ui-model-selection/src/client/index.ts',
        'rsh/Programs/Web/client/ui-model-selection/src/client/service.ts',
        'rsh/Programs/Web/client/ui-input-trigger/src/client/controller.ts',
        'rsh/Programs/Web/client/ui-input-trigger/src/client/service.ts',
        'rsh/Programs/Web/client/ui-input-trigger/src/core/menu.ts',
        'rsh/Programs/Web/client/ui-input-trigger/src/core/detect.ts',
        'rsh/Programs/Web/client/ui-sidebar/src/client/index.ts',
        'rsh/Programs/Web/client/ui-skill/src/client/index.ts',
        'rsh/Programs/Web/client/ui-workspace/src/client/index.ts',
        'rsh/Tests/test-support/client-runtime/src/translate.ts',
        'rsh/Programs/Web/client/ui-primitives/src/JsonTree.tsx',
        'rsh/Programs/Web/client/ui-settings-models/src/client/DeepSeekOnboardingDialog.tsx',
        'rsh/Programs/Web/client/ui-settings-models/src/client/welcome-store.ts',
        // Typert correctness is checked by its uninstrumented suites,
        // including compiler fixtures and byte-for-byte catalog reproduction.
        'rsh/Core/typert/*/src/**/*.{ts,tsx}',
        // Experimental webworker-runtime is outside the coverage requirement
        // by decision: its correctness signal is its uninstrumented suite and
        // the packer's end-to-end image spec.
        'rsh/Modules/Community/experimental/webworker-runtime/src/**/*.ts',
        // Projection/command round: executor lifecycle branches and the
        // registry's drive tails need the same maturing lanes. TODO(gui):
        // cover and remove with the client test lane above.
        'rsh/Modules/Official/interaction/commands/src/index.ts',
        'rsh/Modules/Official/interaction/commands/src/invariant.ts',
        'rsh/Engine/session/session-projection/src/index.ts',
        ...windowsUnsupportedCoveragePackages.map(path => `${path}/src/**/*.ts`),
        ...windowsOnlyCoverageExclusions,
        ...windowsRunnerCoverageExclusions,
        ...pwshCoverageExclusions,
      ],
      // 100% or it doesn't merge (rsh/Docs/testing.md: excessive tests are welcome).
      // Per-file so a well-covered big file can't subsidize a bare one.
      // Every v8 ignore comment must carry a reason — see the quality-gates Agent Note
      // (.agents/notes/implemented/process/2026-06-11-quality-gates.md).
      thresholds: coveragePartitionMode
        ? undefined
        : {
            perFile: true,
            statements: 100,
            branches: 100,
            functions: 100,
            lines: 100,
          },
      reporter: coveragePartitionMode
        ? []
        : process.env.CI
          ? ['text', uncoveredLocationsReporter]
          : ['text', 'html', uncoveredLocationsReporter],
    },
  },
})
