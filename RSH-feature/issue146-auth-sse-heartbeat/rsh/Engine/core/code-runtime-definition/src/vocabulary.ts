/** Shared source-name exclusions for every code backend. */

/**
 * Binding globals every backend refuses because at least one backend owns the
 * program namespace slot. A binding set valid on one backend must remain valid
 * on every backend, so each backend applies the same exclusions.
 */
export const RESERVED_BINDING_GLOBALS: ReadonlySet<string> = new Set([
  'console', '__dsh_main__', '__builtins__', '__name__', '__debug__',
])

/**
 * Error-member names every backend refuses. JavaScript reserves `name`,
 * `message`, and `stack`; Python reserves `args`, `with_traceback`, and
 * `add_note`. Dunder-form members are excluded separately by `DUNDER_MEMBER`.
 */
export const RESERVED_ERROR_MEMBERS: ReadonlySet<string> = new Set([
  'name', 'message', 'stack', 'args', 'with_traceback', 'add_note',
])

/** Python object-protocol member form rejected by every backend. */
export const DUNDER_MEMBER = /^__.+__$/

/**
 * Reserved words in the portable ECMAScript and Python identifier set.
 * Every backend applies the union so a name accepted by one language is not
 * rejected when the same request runs on another.
 */
export const PORTABLE_RESERVED_WORDS: ReadonlySet<string> = new Set([
  // ECMAScript reserved words and reserved-in-strict-mode names.
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in',
  'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof',
  'var', 'void', 'while', 'with', 'yield', 'let', 'static', 'implements', 'interface', 'package',
  'private', 'protected', 'public', 'arguments', 'eval',
  // Python keywords and soft keywords (`type` and `_` are reserved here too).
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'def', 'del', 'elif', 'except', 'from',
  'global', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'match', 'type', '_',
])
