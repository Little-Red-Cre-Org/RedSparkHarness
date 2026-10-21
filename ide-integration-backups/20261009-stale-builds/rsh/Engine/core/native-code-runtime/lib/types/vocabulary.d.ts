/** Portable source names that every native code backend reserves. */
/** Binding globals every native backend refuses for portable program source. */
export declare const RESERVED_BINDING_GLOBALS: ReadonlySet<string>;
/** Error-member names every native backend refuses. */
export declare const RESERVED_ERROR_MEMBERS: ReadonlySet<string>;
/** Portable dunder-form error member names are rejected by every backend. */
export declare const DUNDER_MEMBER: RegExp;
/** ECMAScript and Python reserved identifiers rejected by every native backend. */
export declare const PORTABLE_RESERVED_WORDS: ReadonlySet<string>;
//# sourceMappingURL=vocabulary.d.ts.map