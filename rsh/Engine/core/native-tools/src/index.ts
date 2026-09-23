/** Reversible native tool contributions consumed by a selected application. */
import type { ContentBlock, ToolCallId, ToolSchema } from '@deepseek-ai/dsh-llm'
import { type NativeAgent, type NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import type { Session } from '@deepseek-ai/dsh-session'

/** One model-requested tool invocation with its Session and cancellation. */
export interface NativeToolExecution {
  /** Exact live Agent that owns this invocation's scope and initiator attribution. */
  readonly agent: NativeAgent
  readonly callId: ToolCallId
  readonly name: string
  readonly arguments: unknown
  readonly session: Session
  readonly signal: AbortSignal
  /** Ask the consuming application's selected policy before a protected tool executes. */
  readonly authorize?: (approval: NativeToolApproval) => Promise<void>
}

/** Optional pre-execution approval requested by one tool contribution. */
export interface NativeToolApproval {
  /** Human-readable explanation for the answerer and durable audit. */
  readonly reason?: string
}

/** Model-visible outcome to append once to the authoritative Session. */
export interface NativeToolResult {
  readonly content: readonly ContentBlock[]
  readonly isError: boolean
  readonly error?: { readonly name: string; readonly code: string }
}

/** Tool schema and execution supplied by one installation. */
export interface NativeToolContribution {
  readonly schema: ToolSchema
  /** Require the consuming application to authorize this exact invocation before execute(). */
  readonly approval?: NativeToolApproval
  execute(call: NativeToolExecution): Promise<NativeToolResult>
}

/** A registry whose disposer removes only the contribution it installed. */
export class NativeToolRegistry {
  private readonly tools = new Map<string, NativeToolContribution>()

  /** @param agents - live native Agent authority selected by this tool scope. */
  constructor(private readonly agents: NativeAgentRegistry) {}

  /**
   * Register one name; duplicate authorities fail at installation.
   * @param tool - schema and executor supplied by one installation.
   * @returns a disposer for this exact contribution.
   */
  register(tool: NativeToolContribution): () => void {
    const name = tool.schema.name
    if (this.tools.has(name)) throw new Error(`native-tools: duplicate tool ${name}`)
    this.tools.set(name, tool)
    return () => { if (this.tools.get(name) === tool) this.tools.delete(name) }
  }

  /**
   * Return detached schemas in registration order.
   * @returns schemas currently visible to the consuming application.
   */
  schemas(): ToolSchema[] {
    return [...this.tools.values()].map(tool => tool.schema)
  }

  /**
   * Execute exactly one registered tool; the application owns result logging.
   * @param call - model-requested operation, Session, and cancellation signal.
   * @returns the contribution result for the application to record.
   */
  async execute(call: NativeToolExecution): Promise<NativeToolResult> {
    if (this.agents.get(call.agent.id) !== call.agent) throw new Error(`native-tools: Agent "${call.agent.id}" is not registered`)
    const tool = this.tools.get(call.name)
    if (tool === undefined) throw new Error(`native-tools: unknown tool ${call.name}`)
    if (tool.approval !== undefined) {
      if (call.authorize === undefined) throw new Error(`native-tools: tool ${call.name} requires an approval authority`)
      await call.authorize(tool.approval)
    }
    return tool.execute(call)
  }

  /** Release every contribution when the Provider leaves its scope. */
  clear(): void { this.tools.clear() }
}

export { plugin } from './native.ts'
