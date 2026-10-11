/** Structured rejection from one native Host RPC endpoint. */
export class NativeSessionRpcError extends Error {
  /** @param code - stable native RPC failure code.
   * @param message - Host refusal message.
   * @param details - safe, endpoint-specific failure facts.
   */
  constructor(readonly code: string, message: string, readonly details: object) {
    super(message)
    this.name = 'NativeSessionRpcError'
  }
}
