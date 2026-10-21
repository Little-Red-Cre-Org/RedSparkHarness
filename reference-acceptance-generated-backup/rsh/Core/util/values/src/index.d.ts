/** Duplicate-install-safe value helpers. @module @deepseek-ai/dsh-util-values */
/** A value that round-trips through JSON without loss. */
export type JsonValue = null | boolean | number | string | JsonValue[] | {
    [key: string]: JsonValue;
};
/**
 * Attach a caller-owned value as a non-enumerable, immutable symbol property.
 * @param target - object that owns the value.
 * @param key - caller-owned symbol key.
 * @param value - value to retain on the target.
 * @returns nothing; the property cannot be replaced or removed.
 */
export declare function setSymbolValue(target: object, key: symbol, value: unknown): void;
/**
 * Read a value previously attached under a symbol key.
 * @param target - object carrying the value.
 * @param key - symbol used to attach the value.
 * @returns the attached value, or `undefined` when no value is present.
 */
export declare function getSymbolValue(target: object, key: symbol): unknown;
/**
 * Read a required value previously attached under a symbol key.
 * @param target - object carrying the value.
 * @param key - symbol used to attach the value.
 * @param message - error message used when the value is missing.
 * @returns the attached value.
 * @throws when the target has no value under the key.
 */
export declare function requireSymbolValue(target: object, key: symbol, message: string): unknown;
/**
 * Mark an unreachable closed-union branch.
 * @param value - impossible value; an unhandled typed variant fails at the call site.
 * @param context - optional switch-site label included in the failure message.
 * @returns never; a runtime value that escaped its type always throws.
 */
export declare function assertNever(value: never, context?: string): never;
/**
 * Validate and detach lossless JSON in one read per property.
 * @param value - candidate value to validate and detach.
 * @returns the detached snapshot, or `undefined` when the value is not losslessly JSON-serializable.
 */
export declare function snapshotJsonValue<T>(value: T): T | undefined;
/**
 * Test the same lossless JSON rules as {@link snapshotJsonValue} without detaching the value.
 * @param value - candidate value to test.
 * @returns whether the value survives a JSON round trip without loss.
 */
export declare function isJsonValue(value: unknown): boolean;
/**
 * Compare JSON-compatible values structurally.
 * @param a - one JSON-compatible value.
 * @param b - the other JSON-compatible value.
 * @returns whether both values contain the same JSON data.
 */
export declare function deepEqualJson(a: unknown, b: unknown): boolean;
/**
 * Deep-freeze an object graph in place while leaving live AbortSignal objects mutable.
 * @param value - value to freeze.
 * @returns the same value after every reachable enumerable child is frozen.
 */
export declare function deepFreeze<T>(value: T): T;
//# sourceMappingURL=index.d.ts.map