/** Public SDK facade that supplies the Program-owned standard dsh launcher. */

import {
  DeepSeekHarness as SdkDeepSeekHarness,
  HarnessSession,
  createNativeHarnessClient,
} from '@deepseek-ai/dsh-sdk-runtime'
import type {
  DeepSeekHarnessOptions,
  NativeDeepSeekHarnessOptions,
  RunOptions,
  RunResult,
  SdkPromptContentBlock,
  RuntimeProcessOptions,
} from '@deepseek-ai/dsh-sdk-runtime'
import type { ChildConnectionDefinition } from '@deepseek-ai/dsh-subprocess/native'
import { resolveDshLaunch } from './launch.ts'
import type { HarnessClient } from './client.ts'
import { HarnessClient as ProgramHarnessClient } from './client.ts'

/** High-level public SDK facade using the Program-owned standard dsh launcher. */
export class DeepSeekHarness extends SdkDeepSeekHarness {
  constructor(options: DeepSeekHarnessOptions = {}, clientFactory?: () => HarnessClient) {
    super(options, clientFactory ?? (() => new ProgramHarnessClient(options)))
  }

  override get client(): HarnessClient {
    return super.client as HarnessClient
  }
}

export { HarnessSession }

export function createProcessDeepSeekHarness(
  runtime: RuntimeProcessOptions,
  options: DeepSeekHarnessOptions = {},
): DeepSeekHarness {
  const launch: DeepSeekHarnessOptions = {
    ...runtime.cwd === undefined ? {} : { processCwd: runtime.cwd },
    ...options,
  }
  return new DeepSeekHarness(launch, () => new ProgramHarnessClient(launch, runtime))
}

/**
 * Create a high-level client for the fixed native-sdk profile over a Host-owned connection.
 * @param options - provider, model, workspace, and turn-limit settings for the child.
 * @param childConnection - Host-owned managed stdio connection capability.
 * @returns a Harness that runs through the fixed native-sdk profile.
 */
export function createNativeDeepSeekHarness(
  options: NativeDeepSeekHarnessOptions,
  childConnection: ChildConnectionDefinition,
): DeepSeekHarness {
  const launch: DeepSeekHarnessOptions = {
    profile: 'native-sdk',
    ...options.cwd === undefined ? {} : { cwd: options.cwd },
    ...options.provider === undefined ? {} : { provider: options.provider },
    ...options.model === undefined ? {} : { model: options.model },
    ...options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort },
    ...options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens },
    ...options.maxSteps === undefined ? {} : { maxSteps: options.maxSteps },
    ...options.allowedTools === undefined ? {} : { allowedTools: options.allowedTools },
    ...options.workspaceWriteRoot === undefined ? {} : { workspaceWriteRoot: options.workspaceWriteRoot },
    ...options.dshHome === undefined ? {} : { dshHome: options.dshHome },
    ...options.processCwd === undefined ? {} : { processCwd: options.processCwd },
    ...options.env === undefined ? {} : { env: options.env },
    ...options.initializeTimeoutMs === undefined ? {} : { initializeTimeoutMs: options.initializeTimeoutMs },
    ...options.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: options.requestTimeoutMs },
    ...options.shutdownTimeoutMs === undefined ? {} : { shutdownTimeoutMs: options.shutdownTimeoutMs },
    ...options.disposeEofGraceMs === undefined ? {} : { disposeEofGraceMs: options.disposeEofGraceMs },
    ...options.disposeGraceMs === undefined ? {} : { disposeGraceMs: options.disposeGraceMs },
    ...options.onApprovalRequest === undefined ? {} : { onApprovalRequest: options.onApprovalRequest },
  }
  const runtime = resolveDshLaunch(launch)
  return new DeepSeekHarness(launch, () => createNativeHarnessClient(launch, childConnection, runtime))
}

export type { RunOptions, RunResult, SdkPromptContentBlock }
