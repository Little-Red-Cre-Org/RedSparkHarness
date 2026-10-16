/** Sanitized Desktop failure diagnostics shared with shell renderers. */

export type DesktopErrorType = 'AggregateError' | 'Error' | 'RangeError' | 'SyntaxError' | 'TypeError' | 'UnknownError' | 'ValidationError'

/** Serializable startup failure safe to send to a renderer. */
export interface DesktopErrorState {
  readonly phase: 'error'
  readonly errorType: DesktopErrorType
  readonly path?: string
  readonly rule?: string
  /** Local Desktop log destination; never contains the logged diagnostic itself. */
  readonly logPath?: string
}

const errorTypes = new Set<DesktopErrorType>([
  'AggregateError', 'Error', 'RangeError', 'SyntaxError', 'TypeError', 'ValidationError',
])

/** Project structured diagnostics without exposing error messages or causes.
 * @param error - Startup or runtime failure.
 * @returns Serializable error details without messages or causes.
 */
export function desktopErrorState(error: unknown): DesktopErrorState {
  const errors = errorChain(error)
  // Only producer-sanitized issues carry a rule; raw validator issues may name user dictionary keys.
  const issueOf = (candidate: Error): unknown => {
    const issues = (candidate as Error & { issues?: unknown }).issues
    const issue: unknown = Array.isArray(issues) ? (issues as unknown[])[0] : undefined
    return typeof issue === 'object' && issue !== null && 'rule' in issue && typeof issue.rule === 'string' ? issue : undefined
  }
  const source = errors.find(candidate => issueOf(candidate) !== undefined) ?? errors[0]
  const issue = source === undefined ? undefined : issueOf(source)
  const path: (string | number)[] | undefined = typeof issue === 'object' && issue !== null && 'path' in issue && Array.isArray(issue.path)
    ? (issue.path as unknown[]).filter((part: unknown): part is string | number => typeof part === 'string' || typeof part === 'number')
    : undefined
  const rule = typeof issue === 'object' && issue !== null && 'rule' in issue && typeof issue.rule === 'string'
    ? issue.rule
    : undefined
  return {
    phase: 'error',
    errorType: source === undefined ? 'Error' : errorTypes.has(source.name as DesktopErrorType) ? source.name as DesktopErrorType : 'Error',
    ...path === undefined ? {} : { path: path.join('.') },
    ...rule === undefined ? {} : { rule },
  }
}

function errorChain(error: unknown): Error[] {
  const pending = [error]
  const seen = new Set<Error>()
  const errors: Error[] = []
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const value = pending[cursor]
    if (!(value instanceof Error) || seen.has(value)) continue
    seen.add(value)
    errors.push(value)
    if ('cause' in value) pending.push(value.cause)
    if (value instanceof AggregateError) {
      for (const nested of value.errors as unknown[]) pending.push(nested)
    }
  }
  return errors
}
