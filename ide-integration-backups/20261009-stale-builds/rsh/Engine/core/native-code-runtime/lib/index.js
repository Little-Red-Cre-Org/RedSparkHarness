import { stripTypeScriptTypes } from "node:module";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
//#region lib/types/vocabulary.js
/** Portable source names that every native code backend reserves. */
/** Binding globals every native backend refuses for portable program source. */
const RESERVED_BINDING_GLOBALS = new Set([
	"console",
	"__dsh_main__",
	"__builtins__",
	"__name__",
	"__debug__"
]);
/** Error-member names every native backend refuses. */
const RESERVED_ERROR_MEMBERS = new Set([
	"name",
	"message",
	"stack",
	"args",
	"with_traceback",
	"add_note"
]);
/** Portable dunder-form error member names are rejected by every backend. */
const DUNDER_MEMBER = /^__.+__$/;
/** ECMAScript and Python reserved identifiers rejected by every native backend. */
const PORTABLE_RESERVED_WORDS = new Set([
	"await",
	"break",
	"case",
	"catch",
	"class",
	"const",
	"continue",
	"debugger",
	"default",
	"delete",
	"do",
	"else",
	"enum",
	"export",
	"extends",
	"false",
	"finally",
	"for",
	"function",
	"if",
	"import",
	"in",
	"instanceof",
	"new",
	"null",
	"return",
	"super",
	"switch",
	"this",
	"throw",
	"true",
	"try",
	"typeof",
	"var",
	"void",
	"while",
	"with",
	"yield",
	"let",
	"static",
	"implements",
	"interface",
	"package",
	"private",
	"protected",
	"public",
	"arguments",
	"eval",
	"False",
	"None",
	"True",
	"and",
	"as",
	"assert",
	"async",
	"def",
	"del",
	"elif",
	"except",
	"from",
	"global",
	"is",
	"lambda",
	"nonlocal",
	"not",
	"or",
	"pass",
	"raise",
	"match",
	"type",
	"_"
]);
//#endregion
//#region lib/types/output-json.js
/** JSON string-prefix accounting for the outer-output ledger. @module @deepseek-ai/dsh-native-code-runtime/output-json */
const intrinsicReflectApply$1 = Reflect.apply;
const intrinsicArrayIsArray$1 = Array.isArray;
const IntrinsicBuffer = Buffer;
const intrinsicBufferByteLength = Reflect.get(Buffer, "byteLength");
const intrinsicObjectCreate$1 = Object.create;
const intrinsicObjectDefineProperty$1 = Object.defineProperty;
const intrinsicObjectKeys$1 = Object.keys;
const intrinsicString = String;
const intrinsicStringCharCodeAt = Reflect.get(String.prototype, "charCodeAt");
const intrinsicStringCodePointAt = Reflect.get(String.prototype, "codePointAt");
const intrinsicStringSlice = Reflect.get(String.prototype, "slice");
/** Build a data descriptor that cannot inherit model-defined accessor fields. */
function dataDescriptor$1(value) {
	const descriptor = intrinsicObjectCreate$1(null);
	descriptor.value = value;
	return descriptor;
}
/** Define an ordinary enumerable data slot without a prototype-bearing descriptor. */
function defineEnumerableDataProperty$1(target, key, value) {
	const descriptor = dataDescriptor$1(value);
	descriptor.enumerable = true;
	descriptor.configurable = true;
	descriptor.writable = true;
	intrinsicObjectDefineProperty$1(target, key, descriptor);
}
/** UTF-8 byte length through the module-captured Node intrinsic. */
function byteLength(text) {
	return intrinsicReflectApply$1(intrinsicBufferByteLength, IntrinsicBuffer, [text, "utf8"]);
}
/** Append without consulting a model-mutated `Array.prototype`. */
function append$1(target, value) {
	defineEnumerableDataProperty$1(target, target.length, value);
}
/** Pop without consulting a model-mutated `Array.prototype`. */
function takeLast$1(target) {
	if (target.length === 0) return void 0;
	const index = target.length - 1;
	const value = target[index];
	intrinsicObjectDefineProperty$1(target, "length", dataDescriptor$1(index));
	return value;
}
/** One code-point-aligned character from a string. */
function characterAt(text, index) {
	return intrinsicReflectApply$1(intrinsicStringSlice, text, [index, index + (intrinsicReflectApply$1(intrinsicStringCodePointAt, text, [index]) > 65535 ? 2 : 1)]);
}
/** Serialized bytes contributed by one complete Unicode code point inside JSON quotes. */
function serializedCharacterBytes(character) {
	if (character.length === 2) return 4;
	if (character === "\"" || character === "\\") return 2;
	const code = intrinsicReflectApply$1(intrinsicStringCharCodeAt, character, [0]);
	if (code >= 55296 && code <= 57343) return 6;
	if (code < 32) return code === 8 || code === 9 || code === 10 || code === 12 || code === 13 ? 2 : 6;
	return byteLength(character);
}
/**
* Measure one JSON string without materializing its complete escaped form.
* @param text - the candidate string.
* @param maxBytes - largest serialized size the caller can admit.
* @returns Exact serialized bytes, or `undefined` as soon as the cap is crossed.
*/
function jsonStringBytesUpTo(text, maxBytes) {
	if (maxBytes < 2) return void 0;
	let bytes = 2;
	for (let index = 0; index < text.length;) {
		const character = characterAt(text, index);
		bytes += serializedCharacterBytes(character);
		if (bytes > maxBytes) return void 0;
		index += character.length;
	}
	return bytes;
}
/**
* Measure one lossless JSON value without allocating its serialized form.
* @param value - already validated lossless JSON.
* @param maxBytes - largest serialized size the caller can admit.
* @returns Exact serialized bytes, or `undefined` as soon as the cap is crossed.
*/
function jsonValueBytesUpTo(value, maxBytes) {
	let bytes = 0;
	const add = (cost) => {
		bytes += cost;
		return bytes <= maxBytes;
	};
	const tasks = [{
		kind: "value",
		value
	}];
	for (let task = takeLast$1(tasks); task !== void 0; task = takeLast$1(tasks)) {
		if (task.kind === "value") {
			const current = task.value;
			if (current === null) {
				if (!add(4)) return void 0;
			} else if (typeof current === "string") {
				const stringBytes = jsonStringBytesUpTo(current, maxBytes - bytes);
				if (stringBytes === void 0) return void 0;
				bytes += stringBytes;
			} else if (typeof current === "number") {
				if (!add(byteLength(intrinsicString(current)))) return void 0;
			} else if (typeof current === "boolean") {
				if (!add(current ? 4 : 5)) return void 0;
			} else if (intrinsicArrayIsArray$1(current)) {
				if (!add(2)) return void 0;
				if (current.length > 0) append$1(tasks, {
					kind: "array",
					value: current,
					index: 0
				});
			} else {
				if (!add(2)) return void 0;
				const keys = intrinsicObjectKeys$1(current);
				if (keys.length > 0) append$1(tasks, {
					kind: "object",
					value: current,
					keys,
					index: 0
				});
			}
			continue;
		}
		if (task.index > 0 && !add(1)) return void 0;
		if (task.kind === "array") {
			const item = task.value[task.index];
			if (item === void 0) return void 0;
			if (task.index + 1 < task.value.length) append$1(tasks, {
				...task,
				index: task.index + 1
			});
			append$1(tasks, {
				kind: "value",
				value: item
			});
			continue;
		}
		const key = task.keys[task.index];
		/* v8 ignore next -- an object frame is created and advanced only for an existing Object.keys entry. */
		if (key === void 0) return void 0;
		const keyBytes = jsonStringBytesUpTo(key, maxBytes - bytes);
		if (keyBytes === void 0) return void 0;
		if (!add(keyBytes + 1)) return void 0;
		const item = task.value[key];
		if (item === void 0) return void 0;
		if (task.index + 1 < task.keys.length) append$1(tasks, {
			...task,
			index: task.index + 1
		});
		append$1(tasks, {
			kind: "value",
			value: item
		});
	}
	return bytes;
}
/**
* Return the longest code-point-aligned prefix whose JSON string encoding,
* including its surrounding quotes, fits `maxBytes`.
*
* @param text - the candidate string.
* @param maxBytes - serialized JSON-string bytes available.
* @returns the fitting prefix, or an empty string when even useful content cannot fit.
*/
function truncateJsonStringBytes(text, maxBytes) {
	if (maxBytes < 2) return "";
	let bytes = 2;
	let end = 0;
	for (let index = 0; index < text.length;) {
		const character = characterAt(text, index);
		const cost = serializedCharacterBytes(character);
		if (bytes + cost > maxBytes) break;
		bytes += cost;
		end += character.length;
		index += character.length;
	}
	return end === text.length ? text : intrinsicReflectApply$1(intrinsicStringSlice, text, [0, end]);
}
//#endregion
//#region lib/types/worker-json.js
/**
* Lossless-JSON snapshots for the dependency-free source worker closure.
* @module @deepseek-ai/dsh-native-code-runtime/worker-json
*/
const intrinsicFunctionToString = Reflect.get(Function.prototype, "toString");
const intrinsicReflectApply = Reflect.get(Reflect, "apply");
const IntrinsicError = Error;
const IntrinsicSet = Set;
const intrinsicArrayIsArray = Array.isArray;
const intrinsicArrayPrototype = Array.prototype;
const intrinsicNumberIsFinite = Number.isFinite;
const intrinsicNumberIsSafeInteger = Number.isSafeInteger;
const intrinsicObjectCreate = Object.create;
const intrinsicObjectDefineProperty = Object.defineProperty;
const intrinsicObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const intrinsicObjectGetPrototypeOf = Object.getPrototypeOf;
const intrinsicObjectHasOwn = Object.hasOwn;
const intrinsicObjectIs = Object.is;
const intrinsicObjectKeys = Object.keys;
const intrinsicObjectPrototype = Object.prototype;
const intrinsicObjectPropertyIsEnumerable = Reflect.get(intrinsicObjectPrototype, "propertyIsEnumerable");
const intrinsicReflectOwnKeys = Reflect.ownKeys;
const intrinsicSetAdd = Reflect.get(Set.prototype, "add");
const intrinsicSetDelete = Reflect.get(Set.prototype, "delete");
const intrinsicSetHas = Reflect.get(Set.prototype, "has");
/** Build a data descriptor that cannot inherit model-defined accessor fields. */
function dataDescriptor(value) {
	const descriptor = intrinsicObjectCreate(null);
	descriptor.value = value;
	return descriptor;
}
/** Define an ordinary enumerable data slot without a prototype-bearing descriptor. */
function defineEnumerableDataProperty(target, key, value) {
	const descriptor = dataDescriptor(value);
	descriptor.enumerable = true;
	descriptor.configurable = true;
	descriptor.writable = true;
	intrinsicObjectDefineProperty(target, key, descriptor);
}
/** Append without consulting a model-mutated `Array.prototype`. */
function append(target, value) {
	defineEnumerableDataProperty(target, target.length, value);
}
/** Pop without consulting a model-mutated `Array.prototype`. */
function takeLast(target) {
	if (target.length === 0) return void 0;
	const index = target.length - 1;
	const value = target[index];
	intrinsicObjectDefineProperty(target, "length", dataDescriptor(index));
	return value;
}
/** Whether one captured-intrinsic Set contains a value. */
function setHas(target, value) {
	return intrinsicReflectApply(intrinsicSetHas, target, [value]);
}
/** Add to one captured-intrinsic Set. */
function setAdd(target, value) {
	intrinsicReflectApply(intrinsicSetAdd, target, [value]);
}
/** Delete from one captured-intrinsic Set. */
function setDelete(target, value) {
	intrinsicReflectApply(intrinsicSetDelete, target, [value]);
}
/** Whether a realm-owned intrinsic prototype is backed by its native constructor. */
function hasIntrinsicConstructor(prototype, name) {
	const constructor = intrinsicObjectGetOwnPropertyDescriptor(prototype, "constructor")?.value;
	if (typeof constructor !== "function") return false;
	try {
		return constructor.name === name && constructor.prototype === prototype && intrinsicReflectApply(intrinsicFunctionToString, constructor, []) === `function ${name}() { [native code] }`;
	} catch {
		return false;
	}
}
/** Whether a candidate is a foreign realm's intrinsic `Object.prototype`. */
function isForeignIntrinsicObjectPrototype(value) {
	return intrinsicObjectGetPrototypeOf(value) === null && hasIntrinsicConstructor(value, "Object");
}
/** Whether an array uses one realm's intrinsic `Array.prototype`, not a subclass or forged prototype. */
function hasPlainArrayPrototype(value) {
	const prototype = intrinsicObjectGetPrototypeOf(value);
	if (prototype === intrinsicArrayPrototype) return true;
	if (!intrinsicArrayIsArray(prototype) || !hasIntrinsicConstructor(prototype, "Array")) return false;
	const objectPrototype = intrinsicObjectGetPrototypeOf(prototype);
	return typeof objectPrototype === "object" && objectPrototype !== null && isForeignIntrinsicObjectPrototype(objectPrototype);
}
/** Whether an object is a plain or null-prototype record from any JavaScript realm. */
function hasPlainObjectPrototype(value) {
	const prototype = intrinsicObjectGetPrototypeOf(value);
	return prototype === null || prototype === intrinsicObjectPrototype || typeof prototype === "object" && isForeignIntrinsicObjectPrototype(prototype);
}
/** Return every JSON-visible object key, or reject own data JSON would discard. */
function enumerableStringKeys(value) {
	const keys = intrinsicReflectOwnKeys(value);
	for (let index = 0; index < keys.length; index++) {
		const key = keys[index];
		if (typeof key !== "string" || !intrinsicReflectApply(intrinsicObjectPropertyIsEnumerable, value, [key])) return void 0;
	}
	return keys;
}
function snapshotCodeJsonValueUnchecked(value) {
	const active = new IntrinsicSet();
	let root;
	const assign = (destination, item) => {
		if (destination.kind === "root") root = item;
		else if (destination.kind === "array") defineEnumerableDataProperty(destination.target, destination.index, item);
		else defineEnumerableDataProperty(destination.target, destination.key, item);
	};
	const tasks = [{
		kind: "visit",
		value,
		destination: { kind: "root" }
	}];
	for (let task = takeLast(tasks); task !== void 0; task = takeLast(tasks)) {
		if (task.kind === "leave") {
			setDelete(active, task.source);
			continue;
		}
		if (task.kind === "array-item") {
			if (!intrinsicObjectHasOwn(task.source, task.index)) return void 0;
			append(tasks, {
				kind: "visit",
				value: task.source[task.index],
				destination: {
					kind: "array",
					target: task.target,
					index: task.index
				}
			});
			continue;
		}
		if (task.kind === "object-property") {
			append(tasks, {
				kind: "visit",
				value: task.source[task.key],
				destination: {
					kind: "object",
					target: task.target,
					key: task.key
				}
			});
			continue;
		}
		const candidate = task.value;
		if (candidate === null) {
			assign(task.destination, null);
			continue;
		}
		if (typeof candidate === "boolean" || typeof candidate === "string") {
			assign(task.destination, candidate);
			continue;
		}
		if (typeof candidate === "number") {
			if (!intrinsicNumberIsFinite(candidate) || intrinsicObjectIs(candidate, -0)) return void 0;
			assign(task.destination, candidate);
			continue;
		}
		if (typeof candidate !== "object") return void 0;
		if (setHas(active, candidate)) return void 0;
		if (intrinsicArrayIsArray(candidate)) {
			if (!hasPlainArrayPrototype(candidate)) return void 0;
			const length = candidate.length;
			if (intrinsicReflectOwnKeys(candidate).length !== length + 1) return void 0;
			const target = [];
			assign(task.destination, target);
			setAdd(active, candidate);
			append(tasks, {
				kind: "leave",
				source: candidate
			});
			for (let index = length - 1; index >= 0; index--) append(tasks, {
				kind: "array-item",
				source: candidate,
				index,
				target
			});
			continue;
		}
		if (!hasPlainObjectPrototype(candidate)) return void 0;
		const keys = enumerableStringKeys(candidate);
		if (keys === void 0) return void 0;
		const target = {};
		assign(task.destination, target);
		setAdd(active, candidate);
		append(tasks, {
			kind: "leave",
			source: candidate
		});
		for (let index = keys.length - 1; index >= 0; index--) {
			const key = keys[index];
			/* v8 ignore next -- the loop is bounded by the captured key count. */
			if (key === void 0) return void 0;
			append(tasks, {
				kind: "object-property",
				source: candidate,
				key,
				target
			});
		}
	}
	return root;
}
/**
* Validate and detach one worker-boundary value without loading another
* workspace package at runtime. This mirrors the session-owned canonical
* JSON boundary while remaining safe to import from the unbuilt worker.
* Its iterative traversal adds no JavaScript call-stack depth limit. Reflection
* or accessor failures return `undefined` with other invalid values.
*
* @param value - the candidate completion value.
* @returns a detached lossless-JSON snapshot, or `undefined` when invalid.
*/
function snapshotCodeJsonValue(value) {
	try {
		return snapshotCodeJsonValueUnchecked(value);
	} catch {
		return;
	}
}
/**
* Flatten one validated JSON value for the worker-thread message port.
* @param value - the lossless JSON value to transport.
* @returns a pre-order token stream whose own nesting is bounded.
*/
function encodeWorkerJson(value) {
	const wire = [];
	const pending = [value];
	for (let current = takeLast(pending); current !== void 0; current = takeLast(pending)) {
		if (current === null || typeof current === "boolean" || typeof current === "number" || typeof current === "string") {
			append(wire, current);
			continue;
		}
		if (intrinsicArrayIsArray(current)) {
			append(wire, {
				kind: "array",
				length: current.length
			});
			for (let index = current.length - 1; index >= 0; index--) {
				const item = current[index];
				if (item === void 0) throw new IntrinsicError("cannot encode a sparse JSON array");
				append(pending, item);
			}
			continue;
		}
		const keys = intrinsicObjectKeys(current);
		append(wire, {
			kind: "object",
			keys
		});
		for (let index = keys.length - 1; index >= 0; index--) {
			const key = keys[index];
			/* v8 ignore next -- the loop is bounded by the captured key count. */
			if (key === void 0) throw new IntrinsicError("cannot encode a missing JSON object key");
			const item = current[key];
			if (item === void 0) throw new IntrinsicError("cannot encode an undefined JSON object property");
			append(pending, item);
		}
	}
	return wire;
}
/** Whether an array contains exactly its dense indexed slots and `length`. */
function isDenseArray(value) {
	if (!hasPlainArrayPrototype(value) || intrinsicReflectOwnKeys(value).length !== value.length + 1) return false;
	for (let index = 0; index < value.length; index++) if (!intrinsicObjectHasOwn(value, index)) return false;
	return true;
}
/** Whether one exact string-key list contains a key, without consulting its prototype. */
function keysContain(keys, expected) {
	for (let index = 0; index < keys.length; index++) if (keys[index] === expected) return true;
	return false;
}
/** Return one exact container marker, or reject any extra/missing fields. */
function containerToken(value) {
	if (intrinsicArrayIsArray(value) || !hasPlainObjectPrototype(value)) return void 0;
	const keys = enumerableStringKeys(value);
	if (keys === void 0) return void 0;
	const token = value;
	if (token.kind === "array") {
		if (keys.length !== 2 || !keysContain(keys, "kind") || !keysContain(keys, "length")) return void 0;
		const length = token.length;
		return typeof length === "number" && intrinsicNumberIsSafeInteger(length) && length >= 0 ? {
			kind: "array",
			length
		} : void 0;
	}
	if (token.kind === "object") {
		if (keys.length !== 2 || !keysContain(keys, "kind") || !keysContain(keys, "keys")) return void 0;
		const objectKeys = token.keys;
		if (!intrinsicArrayIsArray(objectKeys) || !isDenseArray(objectKeys)) return void 0;
		const unique = new IntrinsicSet();
		const normalizedKeys = [];
		const objectKeyValues = objectKeys;
		for (let index = 0; index < objectKeyValues.length; index++) {
			const key = objectKeyValues[index];
			if (typeof key !== "string" || setHas(unique, key)) return void 0;
			setAdd(unique, key);
			append(normalizedKeys, key);
		}
		return {
			kind: "object",
			keys: normalizedKeys
		};
	}
}
/**
* Rebuild one lossless JSON value from the flat worker-thread wire format.
* Malformed or incomplete traffic returns `undefined`; traversal is iterative
* and therefore independent of the transported value's application depth.
* @param input - untrusted message-port payload.
* @returns the detached JSON value, or `undefined` when the wire is invalid.
*/
function decodeWorkerJson(input) {
	try {
		if (!intrinsicArrayIsArray(input) || !isDenseArray(input) || input.length === 0) return void 0;
		const wire = input;
		const frames = [];
		let root;
		let rootAssigned = false;
		const attach = (value) => {
			const parent = frames[frames.length - 1];
			if (!parent) {
				if (rootAssigned) return false;
				root = value;
				rootAssigned = true;
				return true;
			}
			/* v8 ignore next -- completed frames are popped before another token can attach. */
			if (parent.index >= (parent.kind === "array" ? parent.length : parent.keys.length)) return false;
			if (parent.kind === "array") append(parent.target, value);
			else {
				const key = parent.keys[parent.index];
				/* v8 ignore next -- object frames are built from validated keys and their exact length. */
				if (key === void 0) return false;
				defineEnumerableDataProperty(parent.target, key, value);
			}
			parent.index += 1;
			return true;
		};
		for (let tokenIndex = 0; tokenIndex < wire.length; tokenIndex++) {
			const token = wire[tokenIndex];
			let value;
			let frame;
			if (token === null || typeof token === "boolean" || typeof token === "string") value = token;
			else if (typeof token === "number") {
				if (!intrinsicNumberIsFinite(token) || intrinsicObjectIs(token, -0)) return void 0;
				value = token;
			} else {
				if (typeof token !== "object") return void 0;
				const marker = containerToken(token);
				if (!marker) return void 0;
				const remainingTokens = wire.length - tokenIndex - 1;
				if (marker.kind === "array") {
					if (marker.length > remainingTokens) return void 0;
					const target = [];
					value = target;
					if (marker.length > 0) frame = {
						kind: "array",
						target,
						length: marker.length,
						index: 0
					};
				} else {
					if (marker.keys.length > remainingTokens) return void 0;
					const target = {};
					value = target;
					if (marker.keys.length > 0) frame = {
						kind: "object",
						target,
						keys: marker.keys,
						index: 0
					};
				}
			}
			if (!attach(value)) return void 0;
			if (frame) append(frames, frame);
			while (frames.length > 0) {
				const current = frames[frames.length - 1];
				/* v8 ignore next -- the loop condition guarantees a final frame. */
				if (current === void 0) break;
				if (current.index < (current.kind === "array" ? current.length : current.keys.length)) break;
				takeLast(frames);
			}
		}
		return frames.length === 0 ? root : void 0;
	} catch {
		return;
	}
}
//#endregion
//#region lib/types/worker-thread.js
/**
* Worker-thread code runtime: a fresh worker runs each host-type-stripped TypeScript program
* and bridges bindings over its message port. This is containment, not a security boundary:
* model code has bash-equivalent trust despite an empty environment, a heap cap, measured
* event-loop busy-time and wall-time budgets, and termination that also stops synchronous loops.
* @module @deepseek-ai/dsh-native-code-runtime
*/
/**
* How often the host samples the worker's event-loop utilization for the
* `computeMs` budget. An internal cadence, not config: the only effect of
* the interval is budget-expiry granularity (a run can overshoot by up to
* one interval), and nothing a deployment could tune here improves that
* without burning host CPU.
*/
const ELU_POLL_INTERVAL_MS = 25;
/** Smallest cap that can represent the counted payloads: an empty logs array plus an empty JSON failure message. */
const MIN_OUTPUT_BYTES = 4;
const MAX_TIMER_DELAY_MS = 2147483647;
/**
* Resolve a profile configuration before any worker is admitted.
* @param input - optional native installation configuration.
* @returns every execution limit with validated defaults applied.
*/
function resolveNativeWorkerThreadConfig(input) {
	let fields;
	if (input === void 0) fields = {};
	else if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("native-code-runtime: configuration must be an object");
	else fields = input;
	const allowed = new Set([
		"computeMs",
		"maxWallMs",
		"maxOutputBytes",
		"maxOldGenerationSizeMb"
	]);
	for (const key of Object.keys(fields)) if (!allowed.has(key)) throw new Error(`native-code-runtime: unknown configuration field ${key}`);
	const config = {
		computeMs: fields.computeMs === void 0 ? 6e4 : numberValue(fields.computeMs, "computeMs"),
		maxWallMs: fields.maxWallMs === void 0 ? 6e5 : numberValue(fields.maxWallMs, "maxWallMs"),
		maxOutputBytes: fields.maxOutputBytes === void 0 ? 67108864 : numberValue(fields.maxOutputBytes, "maxOutputBytes"),
		maxOldGenerationSizeMb: fields.maxOldGenerationSizeMb === void 0 ? 512 : numberValue(fields.maxOldGenerationSizeMb, "maxOldGenerationSizeMb")
	};
	if (!Number.isSafeInteger(config.maxOutputBytes) || config.maxOutputBytes < MIN_OUTPUT_BYTES) throw new Error(`native-code-runtime: maxOutputBytes must be a safe integer of at least ${MIN_OUTPUT_BYTES}`);
	if (config.maxWallMs > MAX_TIMER_DELAY_MS) throw new Error(`native-code-runtime: maxWallMs must be at most ${MAX_TIMER_DELAY_MS}`);
	return config;
}
function numberValue(value, name) {
	if (!(typeof value === "number" && Number.isFinite(value) && value > 0)) throw new Error(`native-code-runtime: ${name} must be a positive finite number`);
	return value;
}
/**
* The seam's language-portable identifier subset (see
* `CodeBindingNamespace.global`): no `$`, which is JS-only spelling — the same
* namespace list must be usable against every backend regardless of language.
*/
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
/**
* The shell a program is wrapped in for the type-strip, matching the
* grammatical context it will execute in (an async function body, where
* top-level `return` and `await` are legal — a bare module parse would
* reject the `return`). Strip mode is position-preserving (removed syntax
* becomes whitespace, nothing shifts), so the wrapper survives the strip
* byte-identical and the body slices back out with the model's own
* line/column positions intact.
*/
const STRIP_WRAP = {
	prefix: "async function __dsh_program__() {\n",
	suffix: "\n}"
};
/**
* The worker entry path. Source runs unbuilt (`src/worker.ts`, loadable
* directly on this repo's Node range via native type stripping — the file
* is erasable-only with type-only relative imports); the built package
* ships it as a sibling CommonJS bundle (`lib/worker.cjs`, its own tsdown
* entry) because pkg's VFS Worker hook compiles string-path entries as
* CommonJS.
* The URL *pathname*'s extension says which world this module is in —
* pathname, because dev-time module runners (vitest) may suffix
* `import.meta.url` with a query string; relative resolution drops it. Worker
* receives a filesystem string so pkg's VFS Worker hook can resolve it.
*/
/* v8 ignore next -- the './worker.cjs' arm is the built-lib world, unreachable unbuilt by construction; the built-lib e2e pins it. */
const WORKER_PATH = fileURLToPath(new URL(new URL(import.meta.url).pathname.endsWith(".ts") ? "./worker.ts" : "./worker.cjs", import.meta.url));
/** Render an unknown thrown value as a message, `Error` or not. */
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
/** Resolve after a worker pipe emits all queued data, or closes/errors during termination. */
function waitForPipeDrain(stream) {
	if (stream.readableEnded || stream.destroyed) return Promise.resolve();
	return new Promise((resolve) => {
		const done = () => {
			stream.off("end", done);
			stream.off("close", done);
			stream.off("error", done);
			resolve();
		};
		stream.once("end", done);
		stream.once("close", done);
		stream.once("error", done);
		/* v8 ignore next -- this race cannot be scheduled deterministically between the adjacent state check and listener registration. */
		if (stream.readableEnded || stream.destroyed) done();
	});
}
/**
* Runtime shape gate for inbound port traffic. The peer runs MODEL CODE and
* can post anything — `null`, primitives, objects with poisoned fields — so
* the compile-time `WorkerToHost` type means nothing here: everything is
* re-validated and REBUILT field by field (a forged extra field never rides
* along; a non-number call id can never be echoed into a reply). Junk returns
* `undefined` and is dropped — a throw in the host's `message` listener would
* crash the host process.
*/
function parseWorkerMessage(raw) {
	if (typeof raw !== "object" || raw === null) return void 0;
	const m = raw;
	switch (m.type) {
		case "call":
			if (typeof m.id !== "number" || typeof m.global !== "string" || typeof m.name !== "string") return void 0;
			return {
				type: "call",
				id: m.id,
				global: m.global,
				name: m.name,
				args: m.args
			};
		case "log":
			if (typeof m.text !== "string") return void 0;
			return {
				type: "log",
				text: m.text
			};
		case "output-limit": return { type: "output-limit" };
		case "done": {
			if (m.error === void 0) return {
				type: "done",
				...m.value !== void 0 ? { value: m.value } : {}
			};
			const error = m.error;
			if (typeof error !== "object" || error === null) return void 0;
			const { kind, message } = error;
			if (kind !== "exception" && kind !== "invalid-output" && kind !== "output-limit" || typeof message !== "string") return void 0;
			return {
				type: "done",
				error: {
					kind,
					message
				}
			};
		}
		default: return;
	}
}
/** One run's combined outer-output ledger; binding values never enter it. */
var OutputLedger = class {
	maxBytes;
	bytes = 2;
	entries = 0;
	constructor(maxBytes) {
		this.maxBytes = maxBytes;
	}
	/** Admit one exact log entry, or report that the hard cap was crossed. */
	admit(text, sink) {
		const separatorBytes = this.entries > 0 ? 1 : 0;
		const stringBytes = jsonStringBytesUpTo(text, this.maxBytes - this.bytes - separatorBytes);
		if (stringBytes === void 0) return false;
		this.bytes += stringBytes + separatorBytes;
		this.entries += 1;
		sink.push(text);
		return true;
	}
	/** Finalize a successful absent-or-JSON completion against the combined cap. */
	success(logs, value) {
		if (value !== void 0 && jsonValueBytesUpTo(value, this.maxBytes - this.bytes) === void 0) return this.limit(logs);
		return {
			logs,
			...value !== void 0 ? { value } : {}
		};
	}
	/** Finalize a failure diagnostic, with output-limit taking precedence when combined bytes exceed the cap. */
	failure(logs, error) {
		if (jsonStringBytesUpTo(error.message, this.maxBytes - this.bytes) === void 0) return this.limit(logs);
		return {
			logs,
			error
		};
	}
	/** Build the explicit output-limit failure while retaining a fitting prefix of the final log. */
	limit(logs) {
		const fullMessage = `outer output exceeded ${this.maxBytes} bytes`;
		const messageBytes = fullMessage.length + 2;
		const retained = [];
		let retainedBytes = 2;
		const logBudget = this.maxBytes - messageBytes;
		for (const text of logs) {
			const separatorBytes = retained.length > 0 ? 1 : 0;
			const availableBytes = logBudget - retainedBytes - separatorBytes;
			const stringBytes = jsonStringBytesUpTo(text, availableBytes);
			if (stringBytes !== void 0) {
				retained.push(text);
				retainedBytes += stringBytes + separatorBytes;
				continue;
			}
			const prefix = truncateJsonStringBytes(text, availableBytes);
			if (prefix.length > 0) {
				const prefixBytes = jsonStringBytesUpTo(prefix, availableBytes);
				/* v8 ignore next -- truncateJsonStringBytes guarantees its returned prefix fits the same budget. */
				if (prefixBytes === void 0) throw new Error("output ledger produced an oversized log prefix");
				retained.push(prefix);
				retainedBytes += prefixBytes + separatorBytes;
			}
			break;
		}
		return {
			logs: retained,
			error: {
				kind: "output-limit",
				message: truncateJsonStringBytes(fullMessage, this.maxBytes - retainedBytes)
			}
		};
	}
};
/**
* Native worker-thread runtime. Every cap is selected by the profile before
* construction; program failures remain resolved result fields.
*/
var NativeWorkerThreadCodeRuntime = class {
	language = "typescript";
	isolation = "worker-thread";
	config;
	live = /* @__PURE__ */ new Set();
	disposed = false;
	/** @param config - fully resolved execution limits. */
	constructor(config) {
		this.config = config;
	}
	/**
	* Dispose to quiescence: mark the service unusable, fail every in-flight
	* run as aborted, and AWAIT each worker's exit so no worker outlives the
	* fiber.
	*/
	async dispose() {
		this.disposed = true;
		const runs = [...this.live];
		for (const run of runs) run.settle({
			kind: "abort",
			message: "runtime disposed"
		});
		await Promise.all(runs.map((run) => run.finished));
	}
	/**
	* Execute one program in a fresh worker. Program outcomes — including a
	* type-strip syntax error, which never spawns a worker — resolve with
	* `result.error`; the method rejects only for caller misuse (a disposed
	* runtime, an invalid binding namespace).
	* @param request - the program, its bindings, and the abort signal.
	* @returns the run's outcome per the seam contract.
	*/
	async run(request) {
		if (this.disposed) throw new Error("native-code-runtime: run() after disposal");
		const bindings = this.validateBindings(request);
		if (request.signal?.aborted) return this.failureBeforeWorker({
			kind: "abort",
			message: String(request.signal.reason)
		});
		let code;
		try {
			const stripped = stripTypeScriptTypes(STRIP_WRAP.prefix + request.program + STRIP_WRAP.suffix);
			code = stripped.slice(STRIP_WRAP.prefix.length, stripped.length - STRIP_WRAP.suffix.length);
		} catch (error) {
			return this.failureBeforeWorker({
				kind: "exception",
				message: messageOf(error)
			});
		}
		return await this.execute(request, code, bindings);
	}
	/** Apply the outer-output ledger to failures that occur before a worker owns one. */
	failureBeforeWorker(error) {
		return new OutputLedger(this.config.maxOutputBytes).failure([], error);
	}
	/** Reject malformed binding globals or typed-error declarations before creating a worker. */
	validateBindings(request) {
		const bindings = /* @__PURE__ */ new Map();
		for (const namespace of request.bindings) {
			if (!IDENTIFIER.test(namespace.global) || PORTABLE_RESERVED_WORDS.has(namespace.global)) throw new Error(`native-code-runtime: binding global ${JSON.stringify(namespace.global)} is not a usable identifier`);
			if (RESERVED_BINDING_GLOBALS.has(namespace.global)) throw new Error(`native-code-runtime: reserved binding global ${JSON.stringify(namespace.global)}`);
			if (bindings.has(namespace.global)) throw new Error(`native-code-runtime: duplicate binding global ${JSON.stringify(namespace.global)}`);
			bindings.set(namespace.global, namespace);
		}
		const errorClassNames = /* @__PURE__ */ new Set();
		for (const namespace of request.bindings) {
			const descriptor = namespace.errorClass;
			if (!descriptor) continue;
			if (!IDENTIFIER.test(descriptor.name) || PORTABLE_RESERVED_WORDS.has(descriptor.name)) throw new Error(`native-code-runtime: binding error class ${JSON.stringify(descriptor.name)} is not a usable identifier`);
			if (RESERVED_BINDING_GLOBALS.has(descriptor.name)) throw new Error(`native-code-runtime: reserved binding global ${JSON.stringify(descriptor.name)}`);
			if (bindings.has(descriptor.name) || errorClassNames.has(descriptor.name)) throw new Error(`native-code-runtime: duplicate injected global ${JSON.stringify(descriptor.name)}`);
			const member = descriptor.memberNameProperty;
			if (member.length === 0 || RESERVED_ERROR_MEMBERS.has(member) || DUNDER_MEMBER.test(member)) throw new Error(`native-code-runtime: binding error member property ${JSON.stringify(descriptor.memberNameProperty)} is not usable`);
			errorClassNames.add(descriptor.name);
		}
		return bindings;
	}
	/** Spawn the worker for one validated, type-stripped run and drive it to settlement. */
	execute(request, code, bindings) {
		const worker = new Worker(WORKER_PATH, {
			workerData: {
				code,
				namespaces: [...bindings].map(([global, namespace]) => ({
					global,
					names: Object.keys(namespace.functions),
					...namespace.errorClass ? { errorClass: namespace.errorClass } : {}
				})),
				maxOutputBytes: this.config.maxOutputBytes
			},
			env: {},
			execArgv: [],
			resourceLimits: { maxOldGenerationSizeMb: this.config.maxOldGenerationSizeMb },
			stdout: true,
			stderr: true
		});
		return new Promise((resolve) => {
			let settled = false;
			const answered = /* @__PURE__ */ new Set();
			const logs = [];
			const strayLogs = [];
			const output = new OutputLedger(this.config.maxOutputBytes);
			let terminalOverride;
			const captureStray = (chunk) => {
				/* v8 ignore next -- a second post-overflow chunk races immediate worker termination; the first overflow path is covered. */
				if (terminalOverride !== void 0) return;
				const text = chunk.toString("utf8");
				if (!output.admit(text, strayLogs)) {
					const limited = output.limit([
						...logs,
						...strayLogs,
						text
					]);
					terminalOverride = limited;
					finish(limited);
				}
			};
			worker.stdout.on("data", captureStray);
			worker.stderr.on("data", captureStray);
			let finishResolve;
			const finished = new Promise((done) => {
				finishResolve = done;
			});
			const finish = (finalize) => {
				if (settled) return;
				settled = true;
				clearInterval(eluTimer);
				clearTimeout(wallTimer);
				request.signal?.removeEventListener("abort", onAbort);
				this.live.delete(live);
				new Promise((resume) => {
					setImmediate(resume);
				}).then(async () => {
					const stdoutDrained = waitForPipeDrain(worker.stdout);
					const stderrDrained = waitForPipeDrain(worker.stderr);
					await Promise.all([
						worker.terminate(),
						stdoutDrained,
						stderrDrained
					]);
					const result = terminalOverride ?? (typeof finalize === "function" ? finalize() : finalize);
					finishResolve();
					resolve(result);
				});
			};
			const onDone = (message) => {
				if (message.type !== "done") return;
				if (message.error) {
					const error = message.error;
					finish(() => output.failure([...logs, ...strayLogs], error));
					return;
				}
				if (message.value === void 0) {
					finish(() => output.success([...logs, ...strayLogs]));
					return;
				}
				const value = decodeWorkerJson(message.value);
				if (value === void 0) finish(() => output.failure([...logs, ...strayLogs], {
					kind: "invalid-output",
					message: "program completion must be lossless JSON"
				}));
				else finish(() => output.success([...logs, ...strayLogs], value));
			};
			const onCall = (message) => {
				if (message.type !== "call" || settled) return;
				if (answered.has(message.id)) return;
				answered.add(message.id);
				const reply = (payload) => {
					if (settled) return;
					worker.postMessage(payload);
				};
				const record = bindings.get(message.global)?.functions;
				const fn = record && Object.hasOwn(record, message.name) ? record[message.name] : void 0;
				if (typeof fn !== "function") {
					reply({
						type: "reply",
						id: message.id,
						ok: false,
						message: `unknown binding ${JSON.stringify(`${message.global}.${message.name}`)}`
					});
					return;
				}
				const args = decodeWorkerJson(message.args);
				if (args === void 0) {
					reply({
						type: "reply",
						id: message.id,
						ok: false,
						message: "binding arguments must be lossless JSON"
					});
					return;
				}
				(async () => {
					try {
						const value = snapshotCodeJsonValue(await fn(args));
						if (value === void 0) reply({
							type: "reply",
							id: message.id,
							ok: false,
							message: "binding resolution must be lossless JSON"
						});
						else reply({
							type: "reply",
							id: message.id,
							ok: true,
							value: encodeWorkerJson(value)
						});
					} catch (error) {
						reply({
							type: "reply",
							id: message.id,
							ok: false,
							message: messageOf(error)
						});
					}
				})();
			};
			worker.on("message", (raw) => {
				const message = parseWorkerMessage(raw);
				if (!message) return;
				if (message.type === "log" && !settled && !output.admit(message.text, logs)) {
					finish(output.limit([
						...logs,
						...strayLogs,
						message.text
					]));
					return;
				}
				if (message.type === "output-limit" && !settled) {
					finish(output.limit([...logs, ...strayLogs]));
					return;
				}
				onCall(message);
				onDone(message);
			});
			worker.on("error", (error) => {
				finish(() => output.failure([...logs, ...strayLogs], {
					kind: "worker-exit",
					message: `worker error: ${error.message}`
				}));
			});
			worker.on("exit", (exitCode) => {
				finish(() => output.failure([...logs, ...strayLogs], {
					kind: "worker-exit",
					message: `worker exited with code ${exitCode} before completing`
				}));
			});
			const eluTimer = setInterval(() => {
				if (worker.performance.eventLoopUtilization().active > this.config.computeMs) finish(() => output.failure([...logs, ...strayLogs], {
					kind: "timeout",
					message: `compute budget exhausted (${this.config.computeMs}ms busy)`
				}));
			}, ELU_POLL_INTERVAL_MS);
			const wallTimer = setTimeout(() => {
				finish(() => output.failure([...logs, ...strayLogs], {
					kind: "timeout",
					message: `wall-clock ceiling reached (${this.config.maxWallMs}ms)`
				}));
			}, this.config.maxWallMs);
			const onAbort = () => {
				finish(() => output.failure([...logs, ...strayLogs], {
					kind: "abort",
					message: String(request.signal?.reason)
				}));
			};
			request.signal?.addEventListener("abort", onAbort, { once: true });
			const live = {
				worker,
				finished,
				settle: (failure) => {
					finish(() => output.failure([...logs, ...strayLogs], failure));
				}
			};
			this.live.add(live);
		});
	}
};
//#endregion
//#region lib/types/native.js
/** Native worker-thread code-runtime Provider with explicit validated budgets. */
const plugin = {
	apiVersion: 1,
	name: "@deepseek-ai/dsh-native-code-runtime",
	targets: ["host"],
	requires: [],
	provides: ["codeRuntime"],
	resolve(input) {
		const config = resolveNativeWorkerThreadConfig(input);
		return (context) => {
			const runtime = new NativeWorkerThreadCodeRuntime(config);
			context.own(() => runtime.dispose());
			context.provide("codeRuntime", runtime);
		};
	}
};
//#endregion
export { DUNDER_MEMBER, NativeWorkerThreadCodeRuntime, PORTABLE_RESERVED_WORDS, RESERVED_BINDING_GLOBALS, RESERVED_ERROR_MEMBERS, plugin, resolveNativeWorkerThreadConfig };
