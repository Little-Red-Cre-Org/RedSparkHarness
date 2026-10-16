/** Build the Native Trajectory projection directly from durable Session events. */

import type {
  AssistantMessageNode, ConversationLocation, ConversationNode, RunningToolCall, ToolResultNode,
  SystemPromptNode, RequestView,
} from '@deepseek-ai/dsh-client-ui-conversation/native-types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { TrajectorySnapshot } from './client/trajectory-contract.ts'
import { contextForm, contextProvenance, displayFailure, toAssistantBlocks } from './client/trajectory-event-projection.ts'

type AssistantRequest = Extract<RequestView, { purpose: 'assistant' }>

interface StepBoundary {
  start?: SessionEvent<'step/start'>
  end?: SessionEvent<'step/end'>
}

interface TurnBoundary {
  start?: SessionEvent<'turn/start'>
  end?: SessionEvent<'turn/end'>
  steps: Map<number, StepBoundary>
}

interface EventCoordinate {
  turn: number
  step?: number
}

const EMPTY_LOCATION_SOURCE = {
  getSnapshot: () => undefined,
  subscribe: (_listener: () => void) => () => {},
}

const EMPTY_LOCATION_DATA = {
  get: (_key: string) => undefined,
  source: (_key: string) => EMPTY_LOCATION_SOURCE,
}

function stepKey(turn: number, step: number): string {
  return `${turn}\u0000${step}`
}

function requestFor(
  requests: Map<string, AssistantRequest>, turn: number, step: number, seq: number, time: number,
): AssistantRequest {
  const key = stepKey(turn, step)
  const existing = requests.get(key)
  if (existing !== undefined) return existing
  const request: AssistantRequest = {
    purpose: 'assistant', startSeq: seq, startedAt: time, completedAt: null, status: 'running', turn, step,
  }
  requests.set(key, request)
  return request
}

/** Project the loaded durable append-origin records for the Native Trajectory views.
 * @param events - selected Session events already held by the Native controller.
 * @returns the snapshot consumed by the Trajectory layout and table.
 */
export function buildTrajectorySnapshot(events: readonly SessionEvent[]): TrajectorySnapshot {
  const eventNodes: ConversationNode[] = []
  const systemPrompts: SystemPromptNode[] = []
  const calls = new Map<string, RunningToolCall>()
  const turns = new Map<number, TurnBoundary>()
  const coordinates = new Map<number, EventCoordinate>()
  const pendingUserMessages: number[] = []
  const stepStartTimes = new Map<string, number>()
  const requests = new Map<string, AssistantRequest>()
  let activeTurn: number | undefined

  const turnBoundary = (turn: number): TurnBoundary => {
    let boundary = turns.get(turn)
    if (boundary === undefined) {
      boundary = { steps: new Map() }
      turns.set(turn, boundary)
    }
    return boundary
  }

  const stepBoundary = (turn: number, step: number): StepBoundary => {
    const boundary = turnBoundary(turn)
    let found = boundary.steps.get(step)
    if (found === undefined) {
      found = {}
      boundary.steps.set(step, found)
    }
    return found
  }

  const setCoordinate = (seq: number, coordinate: EventCoordinate): void => {
    activeTurn = coordinate.turn
    if (coordinate.step === undefined) turnBoundary(coordinate.turn)
    else stepBoundary(coordinate.turn, coordinate.step)
    for (const userSeq of pendingUserMessages) coordinates.set(userSeq, { turn: coordinate.turn })
    pendingUserMessages.length = 0
    coordinates.set(seq, coordinate)
  }

  for (const event of events) {
    switch (event.type) {
      case 'turn/start':
        turnBoundary(event.data.turn).start = event
        setCoordinate(event.seq, { turn: event.data.turn })
        break
      case 'turn/end':
        turnBoundary(event.data.turn).end = event
        setCoordinate(event.seq, { turn: event.data.turn })
        activeTurn = undefined
        break
      case 'step/start':
        stepBoundary(event.data.turn, event.data.step).start = event
        stepStartTimes.set(stepKey(event.data.turn, event.data.step), event.time)
        setCoordinate(event.seq, { turn: event.data.turn, step: event.data.step })
        break
      case 'step/end':
        stepBoundary(event.data.turn, event.data.step).end = event
        setCoordinate(event.seq, { turn: event.data.turn, step: event.data.step })
        break
      case 'assistant/message':
      case 'assistant/attempt':
      case 'system/message':
      case 'tool/call':
      case 'tool/result':
        setCoordinate(event.seq, { turn: event.data.turn, step: event.data.step })
        break
      case 'user/message':
        if (activeTurn !== undefined) coordinates.set(event.seq, { turn: activeTurn })
        else pendingUserMessages.push(event.seq)
        break
      default:
        break
    }
  }

  let firstVisibleTurn = Number.POSITIVE_INFINITY
  for (const { turn } of coordinates.values()) {
    firstVisibleTurn = Math.min(firstVisibleTurn, turn)
  }

  for (const event of events) {
    switch (event.type) {
      case 'step/start': {
        requestFor(requests, event.data.turn, event.data.step, event.seq, event.time)
        break
      }
      case 'assistant/attempt': {
        const request = requestFor(requests, event.data.turn, event.data.step, event.seq, event.time)
        requests.set(stepKey(event.data.turn, event.data.step), {
          ...request, completedAt: event.time, status: 'error',
        })
        break
      }
      case 'assistant/message': {
        if (event.surfaceOp !== 'append') break
        const request = requestFor(requests, event.data.turn, event.data.step, event.seq, event.time)
        requests.set(stepKey(event.data.turn, event.data.step), {
          ...request,
          completedAt: event.time,
          status: event.data.interrupted === true ? 'error' : 'complete',
          resultSeq: event.seq,
          usage: event.data.usage,
          provenance: {
            provider: event.data.message.source.provider,
            model: event.data.message.source.model,
          },
        })
        const assistant: AssistantMessageNode = {
          kind: 'assistant',
          seq: event.seq,
          messageId: event.data.message.id,
          time: event.time,
          turn: event.data.turn,
          step: event.data.step,
          blocks: toAssistantBlocks(event.data.message.content),
          usage: event.data.usage,
          provenance: {
            provider: event.data.message.source.provider,
            model: event.data.message.source.model,
          },
          timing: {
            stepStartTime: stepStartTimes.get(stepKey(event.data.turn, event.data.step)) ?? null,
            firstTokenTime: null,
            completedTime: event.time,
          },
          ...(event.data.interrupted === true ? { interrupted: true } : {}),
        }
        eventNodes.push(assistant)
        break
      }
      case 'turn/end': {
        const boundary = turnBoundary(event.data.turn)
        const candidates = [...requests.values()].filter(request => request.turn === event.data.turn)
        const last = candidates.at(-1)
        if (event.data.reason.kind === 'error') {
          const failure = displayFailure(event.data.reason.error)
          const request = last ?? {
            purpose: 'assistant' as const,
            startSeq: boundary.start?.seq ?? event.seq,
            startedAt: boundary.start?.time ?? event.time,
            completedAt: event.time,
            status: 'error' as const,
            turn: event.data.turn,
            step: 0,
          }
          requests.set(stepKey(request.turn, request.step), {
            ...request,
            completedAt: event.time,
            status: 'error',
            error: failure.message,
            ...(failure.code === undefined ? {} : { errorCode: failure.code }),
          })
        } else if (last?.status === 'running') {
          requests.set(stepKey(last.turn, last.step), {
            ...last, completedAt: event.time,
            status: event.data.reason.kind === 'completed' ? 'complete' : 'error',
          })
        }
        break
      }
      case 'tool/call': {
        calls.set(String(event.data.callId), {
          callId: String(event.data.callId),
          name: event.data.name,
          argsRaw: event.data.arguments,
          turn: event.data.turn,
          step: event.data.step,
          time: event.time,
          subCalls: [],
        })
        break
      }
      case 'user/message': {
        if (event.surfaceOp !== 'append') break
        eventNodes.push(event.data.source.kind === 'user'
          ? {
            kind: 'user', seq: event.seq, time: event.time,
            content: event.data.content, source: event.data.source,
          }
          : {
            kind: 'context', seq: event.seq, time: event.time,
            content: event.data.content, source: event.data.source,
            provenance: contextProvenance(event.data.source),
            form: contextForm(event.data.source),
          })
        break
      }
      case 'system/message': {
        if (event.surfaceOp !== 'append') break
        systemPrompts.push({
          seq: event.seq,
          time: event.time,
          turn: event.data.turn,
          step: event.data.step,
          text: event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n\n'),
          update: systemPrompts.length > 0 || event.data.turn !== firstVisibleTurn,
        })
        break
      }
      case 'tool/result': {
        if (event.surfaceOp !== 'append') break
        const callId = String(event.data.message.source.callId)
        const call = calls.get(callId)
        const result = event.data.message.content[0]
        const node: ToolResultNode = {
          kind: 'tool-result',
          seq: event.seq,
          time: event.time,
          callId,
          call: call === undefined ? null : { name: call.name, argsRaw: call.argsRaw },
          callTime: call?.time ?? null,
          content: result.content,
          isError: result.isError === true,
          ...(event.data.error === undefined ? {} : { error: event.data.error }),
          ...(event.data.meta === undefined ? {} : { meta: event.data.meta }),
          subCalls: call?.subCalls ?? [],
        }
        eventNodes.push(node)
        calls.delete(callId)
        break
      }
      default:
        break
    }
  }

  const turnLocations = new Map<number, Extract<ConversationLocation, { kind: 'turn' }>['turn']>()
  const stepLocations = new Map<string, Extract<ConversationLocation, { kind: 'step' }>>()
  for (const [turn, boundary] of turns) {
    const steps = [...boundary.steps].map(([step, stepBoundaryValue]) => ({
      turn,
      step,
      start: stepBoundaryValue.start,
      end: stepBoundaryValue.end,
      status: stepBoundaryValue.start === undefined
        ? 'unknown' as const
        : stepBoundaryValue.end === undefined ? 'open' as const : 'closed' as const,
      data: EMPTY_LOCATION_DATA,
    }))
    const turnLocation = {
      turn,
      start: boundary.start,
      end: boundary.end,
      status: boundary.start === undefined
        ? 'unknown' as const
        : boundary.end === undefined ? 'open' as const : 'closed' as const,
      steps,
      data: EMPTY_LOCATION_DATA,
    }
    turnLocations.set(turn, turnLocation)
    for (const stepLocation of steps) {
      stepLocations.set(stepKey(turn, stepLocation.step), {
        kind: 'step', turn: turnLocation, step: stepLocation,
      })
    }
  }

  const eventLocations = new Map<number, ConversationLocation>()
  for (const [seq, coordinate] of coordinates) {
    const stepLocation = coordinate.step === undefined
      ? undefined
      : stepLocations.get(stepKey(coordinate.turn, coordinate.step))
    const turnLocation = turnLocations.get(coordinate.turn)
    eventLocations.set(seq, stepLocation ?? (turnLocation === undefined
      ? { kind: 'unresolved' }
      : { kind: 'turn', turn: turnLocation }))
  }

  return {
    systemPrompts,
    eventNodes,
    eventLocations,
    requests: [...requests.values()].sort((left, right) => left.startSeq - right.startSeq),
    callSchemas: new Map(),
    partial: null,
    runningCalls: [...calls.values()],
  }
}
