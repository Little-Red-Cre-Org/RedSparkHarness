/** Agent-scoped serialization for Schedule reads and durable mutations. */

const tails = new WeakMap<object, Promise<void>>()

/**
 * Run one complete Schedule transaction after its exact owner's prior transaction.
 * @param owner - Exact Schedule owner and serialization key.
 * @param operation - Complete preflight, fold, mutation, and postflight operation.
 * @returns The operation result after exclusive execution.
 */
export async function runScheduleTransaction<T>(owner: object, operation: () => Promise<T>): Promise<T> {
  const prior = tails.get(owner) ?? Promise.resolve()
  const run = prior.then(operation)
  const tail = run.then(() => undefined, () => undefined)
  tails.set(owner, tail)
  try {
    return await run
  } finally {
    if (tails.get(owner) === tail) tails.delete(owner)
  }
}
