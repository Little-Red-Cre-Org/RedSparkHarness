/** Portable source names that every native code backend reserves. */

/** Binding globals every native backend refuses for portable program source. */
export const RESERVED_BINDING_GLOBALS: ReadonlySet<string> = new Set([
  'console', '__dsh_main__', '__builtins__', '__name__', '__debug__',
])

/** Error-member names every native backend refuses. */
export const RESERVED_ERROR_MEMBERS: ReadonlySet<string> = new Set([
  'name', 'message', 'stack', 'args', 'with_traceback', 'add_note',
])

/** Portable dunder-form error member names are rejected by every backend. */
export const DUNDER_MEMBER = /^__.+__$/

/** ECMAScript and Python reserved identifiers rejected by every native backend. */
export const PORTABLE_RESERVED_WORDS: ReadonlySet<string> = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in',
  'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof',
  'var', 'void', 'while', 'with', 'yield', 'let', 'static', 'implements', 'interface', 'package',
  'private', 'protected', 'public', 'arguments', 'eval',
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'def', 'del', 'elif', 'except', 'from',
  'global', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'match', 'type', '_',
])
