/** Framework-free ordered stages around bounded concurrent tool bodies. */

/** One invocation whose owner contains execution failures as tool outcomes. */
export interface OrderedDispatch {
  /** Resolve the current scope policy immediately before starting. @returns current execution classification. */
  classify(): 'parallel' | 'exclusive'
  /** Append the start and run guards serially, then assign flight. @returns completion of preparation. */
  start(): Promise<void>
  /** Finalize and persist the parked outcome serially. @returns completion of result commitment. */
  commit(): Promise<void>
  /** Reject an unstarted invocation after cancellation; no start record is written. */
  abandon(): void
  /** Body completion; the owner contains body failures and sets settled before resolving. */
  flight: Promise<void>
  /** A parked outcome exists and is ready for commitment. */
  settled: boolean
  /** Classification admitted at start; exclusive admission lasts through commitment. */
  mode?: 'parallel' | 'exclusive'
}

/** A run-local ordered lane; the caller owns cancellation and invocation results. */
export interface OrderedDispatchLane {
  /**
   * Queue one invocation and wake its ordered stages.
   * @param dispatch - owned stages whose failures are contained as invocation outcomes.
   * @returns lane completion, including other queued and admitted invocations.
   */
  enqueue(dispatch: OrderedDispatch): Promise<void>
  /** @returns completion after queued invocations and all admitted bodies and commits settle. */
  drain(): Promise<void>
}

/**
 * Keep starts and commits in submission order while parallel bodies overlap.
 * Exclusive invocations wait for all bodies and hold admission through commit.
 * @param signal - run cancellation; queued invocations are abandoned and admitted ones are drained.
 * @param maxParallel - positive, validated body concurrency limit owned by the caller's configuration.
 * @returns the run-local queue; stage failures reject its completion and must be contained by stage owners.
 */
export function createOrderedDispatchLane(signal: AbortSignal, maxParallel: number): OrderedDispatchLane {
  const pending: OrderedDispatch[] = []
  const commits: OrderedDispatch[] = []
  const flights = new Set<Promise<void>>()
  let exclusiveActive = false
  let driving = false
  let driverRun: Promise<void> = Promise.resolve()
  let wake: (() => void) | undefined
  const wakeup = (): void => {
    const release = wake
    wake = undefined
    release?.()
  }
  const drive = (): Promise<void> => {
    if (driving) return driverRun
    driving = true
    driverRun = (async () => {
      try {
        for (;;) {
          const changed = new Promise<void>((resolve) => { wake = resolve })
          const commitHead = commits[0]
          if (commitHead !== undefined && commitHead.settled) {
            commits.shift()
            await commitHead.commit()
            if (commitHead.mode === 'exclusive') exclusiveActive = false
            continue
          }
          const head = pending[0]
          if (head !== undefined) {
            if (signal.aborted) {
              pending.shift()
              head.abandon()
              continue
            }
            const mode = head.classify()
            const capacity = !exclusiveActive
              && (mode === 'exclusive' ? flights.size === 0 : flights.size < maxParallel)
            if (capacity) {
              if (mode === 'exclusive') exclusiveActive = true
              head.mode = mode
              pending.shift()
              commits.push(head)
              await head.start()
              const flight: Promise<void> = head.flight.finally(() => {
                flights.delete(flight)
                wakeup()
              })
              flights.add(flight)
              continue
            }
          }
          if (pending.length === 0 && commits.length === 0 && flights.size === 0) return
          await changed
        }
      } finally {
        driving = false
        wake = undefined
      }
    })()
    return driverRun
  }
  return {
    enqueue(dispatch) { pending.push(dispatch); wakeup(); return drive() },
    drain() { wakeup(); return drive() },
  }
}
