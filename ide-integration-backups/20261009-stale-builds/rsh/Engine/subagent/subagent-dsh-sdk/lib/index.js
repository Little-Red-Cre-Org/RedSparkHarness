import { createRequire } from "node:module";
import fs2, { accessSync, chmodSync, closeSync, constants, existsSync, lstatSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, readlinkSync, rmdirSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { delimiter, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { Buffer as Buffer$1 } from "node:buffer";
import { randomBytes, randomUUID } from "node:crypto";
import { access, stat } from "node:fs/promises";
import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";
import { constants as constants$1, devNull, homedir, tmpdir } from "node:os";
import { setTimeout as setTimeout$1 } from "node:timers/promises";
import util, { getSystemErrorMessage, getSystemErrorName, inspect } from "node:util";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import { StringDecoder } from "node:string_decoder";
//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
var __require = /* @__PURE__ */ createRequire(import.meta.url);
//#endregion
//#region ../../../Core/vendor/cosmokit/src/misc.ts
/** Return true when a value is `null` or `undefined`. */
function isNullable(value) {
	return value === null || value === void 0;
}
/** Return true for non-array object values. */
function isPlainObject$1(data) {
	return data && typeof data === "object" && !Array.isArray(data);
}
/** Filter object entries and return a new object. */
function filterKeys(object, filter) {
	return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
/** Map object values while preserving the original key set. */
function mapValues(object, transform) {
	return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
/** Pick selected keys from an object, optionally including `undefined` values. */
function pick$1(source, keys, forced) {
	if (!keys) return { ...source };
	const result = {};
	for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
	return result;
}
/** Define a non-enumerable writable property and return the object. */
function defineProperty(object, key, value) {
	return Object.defineProperty(object, key, {
		writable: true,
		value,
		enumerable: false
	});
}
//#endregion
//#region ../../../Core/vendor/cosmokit/src/types.ts
/** Test values using `instanceof` with a `toStringTag` fallback. */
function is(type, value) {
	if (arguments.length === 1) return (value) => is(type, value);
	return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
	return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
	return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
let Binary;
(function(_Binary) {
	_Binary.is = isArrayBufferLike;
	_Binary.isSource = isArrayBufferSource;
	function fromSource(source) {
		if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
		else return source;
	}
	_Binary.fromSource = fromSource;
	function toBase64(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
		let binary = "";
		const bytes = new Uint8Array(source);
		for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
		return btoa(binary);
	}
	_Binary.toBase64 = toBase64;
	function fromBase64(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
		return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
	}
	_Binary.fromBase64 = fromBase64;
	function toHex(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
		return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
	}
	_Binary.toHex = toHex;
	function fromHex(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
		const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
		const buffer = [];
		for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
		return Uint8Array.from(buffer).buffer;
	}
	_Binary.fromHex = fromHex;
})(Binary || (Binary = {}));
Binary.fromBase64;
Binary.toBase64;
Binary.fromHex;
Binary.toHex;
/** Deep-clone common JavaScript values while preserving prototypes and cycles. */
function clone$1(source, refs = /* @__PURE__ */ new Map()) {
	if (!source || typeof source !== "object") return source;
	if (is("Date", source)) return new Date(source.valueOf());
	if (is("RegExp", source)) return new RegExp(source.source, source.flags);
	if (isArrayBufferLike(source)) return source.slice(0);
	if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
	const cached = refs.get(source);
	if (cached) return cached;
	if (Array.isArray(source)) {
		const result = [];
		refs.set(source, result);
		source.forEach((value, index) => {
			result[index] = Reflect.apply(clone$1, null, [value, refs]);
		});
		return result;
	}
	const result = Object.create(Object.getPrototypeOf(source));
	refs.set(source, result);
	for (const key of Reflect.ownKeys(source)) {
		const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
		if ("value" in descriptor) descriptor.value = Reflect.apply(clone$1, null, [descriptor.value, refs]);
		Reflect.defineProperty(result, key, descriptor);
	}
	return result;
}
/** Deeply compare arrays, dates, regexps, buffers, and plain object fields. */
function deepEqual(a, b, strict) {
	if (a === b) return true;
	if (!strict && isNullable(a) && isNullable(b)) return true;
	if (typeof a !== typeof b) return false;
	if (typeof a !== "object") return false;
	if (!a || !b) return false;
	function check(test, then) {
		return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : void 0;
	}
	return check(Array.isArray, (a, b) => a.length === b.length && a.every((item, index) => deepEqual(item, b[index]))) ?? check(is("Date"), (a, b) => a.valueOf() === b.valueOf()) ?? check(is("RegExp"), (a, b) => a.source === b.source && a.flags === b.flags) ?? check(isArrayBufferLike, (a, b) => {
		if (a.byteLength !== b.byteLength) return false;
		const viewA = new Uint8Array(a);
		const viewB = new Uint8Array(b);
		for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
		return true;
	}) ?? Object.keys({
		...a,
		...b
	}).every((key) => deepEqual(a[key], b[key], strict));
}
//#endregion
//#region ../../../Core/vendor/cosmokit/src/string.ts
function tokenize(source, delimiters, delimiter) {
	const output = [];
	let state = 0;
	for (let i = 0; i < source.length; i++) {
		const code = source.charCodeAt(i);
		if (code >= 65 && code <= 90) {
			if (state === 1) {
				const next = source.charCodeAt(i + 1);
				if (next >= 97 && next <= 122) output.push(delimiter);
				output.push(code + 32);
			} else {
				if (state !== 0) output.push(delimiter);
				output.push(code + 32);
			}
			state = 1;
		} else if (code >= 97 && code <= 122) {
			output.push(code);
			state = 2;
		} else if (delimiters.includes(code)) {
			if (state !== 0) output.push(delimiter);
			state = 0;
		} else output.push(code);
	}
	return String.fromCharCode(...output);
}
/** Convert text to dash-delimited parameter case. */
function paramCase(source) {
	return tokenize(source, [45, 95], 45);
}
/** Runtime alias for `paramCase`. */
const hyphenate = paramCase;
//#endregion
//#region ../../../Core/vendor/cosmokit/src/time.ts
let Time;
(function(_Time) {
	_Time.millisecond = 1;
	const second = _Time.second = 1e3;
	const minute = _Time.minute = second * 60;
	const hour = _Time.hour = minute * 60;
	const day = _Time.day = hour * 24;
	const week = _Time.week = day * 7;
	let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
	function setTimezoneOffset(offset) {
		timezoneOffset = offset;
	}
	_Time.setTimezoneOffset = setTimezoneOffset;
	function getTimezoneOffset() {
		return timezoneOffset;
	}
	_Time.getTimezoneOffset = getTimezoneOffset;
	function getDateNumber(date = /* @__PURE__ */ new Date(), offset) {
		if (typeof date === "number") date = new Date(date);
		if (offset === void 0) offset = timezoneOffset;
		return Math.floor((date.valueOf() / minute - offset) / 1440);
	}
	_Time.getDateNumber = getDateNumber;
	function fromDateNumber(value, offset) {
		const date = new Date(value * day);
		if (offset === void 0) offset = timezoneOffset;
		return new Date(+date + offset * minute);
	}
	_Time.fromDateNumber = fromDateNumber;
	const numeric = /\d+(?:\.\d+)?/.source;
	const timeRegExp = new RegExp(`^${[
		"w(?:eek(?:s)?)?",
		"d(?:ay(?:s)?)?",
		"h(?:our(?:s)?)?",
		"m(?:in(?:ute)?(?:s)?)?",
		"s(?:ec(?:ond)?(?:s)?)?"
	].map((unit) => `(${numeric}${unit})?`).join("")}$`);
	function parseTime(source) {
		const capture = timeRegExp.exec(source);
		if (!capture) return 0;
		return (parseFloat(capture[1]) * week || 0) + (parseFloat(capture[2]) * day || 0) + (parseFloat(capture[3]) * hour || 0) + (parseFloat(capture[4]) * minute || 0) + (parseFloat(capture[5]) * second || 0);
	}
	_Time.parseTime = parseTime;
	function parseDate(date) {
		const parsed = parseTime(date);
		if (parsed) date = Date.now() + parsed;
		else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date}`;
		else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date}`;
		return date ? new Date(date) : /* @__PURE__ */ new Date();
	}
	_Time.parseDate = parseDate;
	function format(ms) {
		const abs = Math.abs(ms);
		if (abs >= day - hour / 2) return Math.round(ms / day) + "d";
		else if (abs >= hour - minute / 2) return Math.round(ms / hour) + "h";
		else if (abs >= minute - second / 2) return Math.round(ms / minute) + "m";
		else if (abs >= second) return Math.round(ms / second) + "s";
		return ms + "ms";
	}
	_Time.format = format;
	function toDigits(source, length = 2) {
		return source.toString().padStart(length, "0");
	}
	_Time.toDigits = toDigits;
	function template(template, time = /* @__PURE__ */ new Date()) {
		return template.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
	}
	_Time.template = template;
})(Time || (Time = {}));
//#endregion
//#region ../../../Core/vendor/schemastery/src/index.ts
const kSchema = Symbol.for("schemastery");
const kValidationError$1 = Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError$1 = class extends TypeError {
	options;
	name = "ValidationError";
	constructor(message, options) {
		let prefix = "$";
		for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
		else if (typeof segment === "number") prefix += "[" + segment + "]";
		else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
		if (prefix.startsWith(".")) prefix = prefix.slice(1);
		super((prefix === "$" ? "" : `${prefix} `) + message);
		this.options = options;
	}
	static is(error) {
		return !!error?.[kValidationError$1];
	}
};
Object.defineProperty(ValidationError$1.prototype, kValidationError$1, { value: true });
const Schema = function(options) {
	const schema = function(data, options = {}) {
		return Schema.resolve(data, schema, options)[0];
	};
	if (options.refs) {
		const refs = mapValues(options.refs, (options) => new Schema(options));
		const getRef = (uid) => refs[uid];
		for (const key in refs) {
			const options = refs[key];
			options.sKey = getRef(options.sKey);
			options.inner = getRef(options.inner);
			options.list = options.list && options.list.map(getRef);
			options.dict = options.dict && mapValues(options.dict, getRef);
		}
		return refs[options.uid];
	}
	Object.assign(schema, options);
	if (typeof schema.callback === "string") try {
		schema.callback = new Function("return " + schema.callback)();
	} catch {}
	Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
	Object.setPrototypeOf(schema, Schema.prototype);
	schema.meta ||= {};
	schema.toString = schema.toString.bind(schema);
	return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
	return {
		version: 1,
		vendor: "schemastery",
		validate: (value) => {
			try {
				return { value: Schema.resolve(value, this, {})[0] };
			} catch (error) {
				if (ValidationError$1.is(error)) return { issues: [{
					message: error.message,
					path: error.options.path
				}] };
				throw error;
			}
		}
	};
} });
Schema.ValidationError = ValidationError$1;
Schema.prototype.toJSON = function toJSON() {
	if (globalThis.__schemastery_refs__) {
		globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
		return this.uid;
	}
	globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
	globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
	const result = {
		uid: this.uid,
		refs: globalThis.__schemastery_refs__
	};
	globalThis.__schemastery_refs__ = void 0;
	return result;
};
Schema.prototype.set = function set(key, value) {
	this.dict[key] = value;
	return this;
};
Schema.prototype.push = function push(value) {
	this.list.push(value);
	return this;
};
function mergeDesc(original, messages) {
	const result = typeof original === "string" ? { "": original } : { ...original };
	for (const locale in messages) {
		const value = messages[locale];
		if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
		else if (typeof value === "string") result[locale] = value;
	}
	return result;
}
function getInner(value) {
	return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
	return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
	const schema = Schema(this);
	const desc = mergeDesc(schema.meta.description, messages);
	if (Object.keys(desc).length) schema.meta.description = desc;
	if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
		return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
	});
	if (schema.list) schema.list = schema.list.map((inner, index) => {
		return inner.i18n(mapValues(messages, (data = {}) => {
			if (Array.isArray(getInner(data))) return getInner(data)[index];
			if (Array.isArray(data)) return data[index];
			return extractKeys(data);
		}));
	});
	if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
		if (getInner(data)) return getInner(data);
		return extractKeys(data);
	}));
	if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
	return schema;
};
Schema.prototype.extra = function extra(key, value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
};
for (const key of [
	"required",
	"disabled",
	"collapse",
	"hidden",
	"loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
Schema.prototype.deprecated = function deprecated() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "deprecated",
		type: "danger"
	});
	return schema;
};
Schema.prototype.experimental = function experimental() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "experimental",
		type: "warning"
	});
	return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
	const schema = Schema(this);
	const pattern = pick$1(regexp, ["source", "flags"]);
	schema.meta = {
		...schema.meta,
		pattern
	};
	return schema;
};
Schema.prototype.simplify = function simplify(value) {
	if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
	if (isNullable(value)) return value;
	if (this.type === "object" || this.type === "dict") {
		const result = {};
		for (const key in value) {
			const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
			if (this.type === "dict" || !isNullable(item)) result[key] = item;
		}
		if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
		return result;
	} else if (this.type === "array" || this.type === "tuple") {
		const result = [];
		value.forEach((value, index) => {
			const schema = this.type === "array" ? this.inner : this.list[index];
			const item = schema ? schema.simplify(value) : value;
			result.push(item);
		});
		return result;
	} else if (this.type === "intersect") {
		const result = {};
		for (const item of this.list) Object.assign(result, item.simplify(value));
		return result;
	} else if (this.type === "union") for (const schema of this.list) try {
		Schema.resolve(value, schema, {});
		return schema.simplify(value);
	} catch {}
	return value;
};
Schema.prototype.toString = function toString(inline) {
	return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		role,
		extra
	};
	return schema;
};
for (const key of [
	"default",
	"link",
	"comment",
	"description",
	"max",
	"min",
	"step"
]) Object.assign(Schema.prototype, { [key](value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
const resolvers = {};
Schema.extend = function extend(type, resolve) {
	resolvers[type] = resolve;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
	if (!schema) return [data];
	if (options.ignore?.(data, schema)) return [data];
	if (isNullable(data) && schema.type !== "lazy") {
		if (schema.meta.required) throw new ValidationError$1(`missing required value`, options);
		let current = schema;
		let fallback = schema.meta.default;
		while (current?.type === "intersect" && isNullable(fallback)) {
			current = current.list[0];
			fallback = current?.meta.default;
		}
		if (isNullable(fallback)) return [data];
		data = clone$1(fallback);
	}
	const callback = resolvers[schema.type];
	if (!callback) throw new ValidationError$1(`unsupported type "${schema.type}"`, options);
	try {
		return callback(data, schema, options, strict);
	} catch (error) {
		if (!schema.meta.loose) throw error;
		return [schema.meta.default];
	}
};
Schema.from = function from(source) {
	if (isNullable(source)) return Schema.any();
	else if ([
		"string",
		"number",
		"boolean"
	].includes(typeof source)) return Schema.const(source).required();
	else if (source[kSchema]) return source;
	else if (typeof source === "function") switch (source) {
		case String: return Schema.string().required();
		case Number: return Schema.number().required();
		case Boolean: return Schema.boolean().required();
		case Function: return Schema.function().required();
		default: return Schema.is(source).required();
	}
	else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
	const toJSON = () => {
		if (!schema.inner[kSchema]) {
			schema.inner = schema.builder();
			schema.inner.meta = {
				...schema.meta,
				...schema.inner.meta
			};
		}
		return schema.inner.toJSON();
	};
	const schema = new Schema({
		type: "lazy",
		builder,
		inner: { toJSON }
	});
	return schema;
};
Schema.natural = function natural() {
	return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
	return Schema.number().step(.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
	return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
		const date = new Date(value);
		if (isNaN(+date)) throw new ValidationError$1(`invalid date "${value}"`, options);
		return date;
	}, true)]);
};
Schema.regExp = function regExp(flag = "") {
	return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
		try {
			return new RegExp(value, flag);
		} catch (e) {
			throw new ValidationError$1(e.message, options);
		}
	}, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
	return Schema.union([
		Schema.is(ArrayBuffer),
		Schema.is(SharedArrayBuffer),
		Schema.transform(Schema.any(), (value, options) => {
			if (Binary.isSource(value)) return Binary.fromSource(value);
			throw new ValidationError$1(`expected ArrayBufferSource but got ${value}`, options);
		}, true),
		...encoding ? [Schema.transform(Schema.string(), (value, options) => {
			try {
				return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
			} catch (e) {
				throw new ValidationError$1(e.message, options);
			}
		}, true)] : []
	]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
	if (!schema.inner[kSchema]) {
		schema.inner = schema.builder();
		schema.inner.meta = {
			...schema.meta,
			...schema.inner.meta
		};
	}
	return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
	return [data];
});
Schema.extend("never", (data, _, options) => {
	throw new ValidationError$1(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
	if (deepEqual(data, value)) return [value];
	throw new ValidationError$1(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
	const { max = Infinity, min = -Infinity } = meta;
	if (data > max) throw new ValidationError$1(`expected ${description} <= ${max} but got ${data}`, options);
	if (data < min && !skipMin) throw new ValidationError$1(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
	if (typeof data !== "string") throw new ValidationError$1(`expected string but got ${data}`, options);
	if (meta.pattern) {
		const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
		if (!regexp.test(data)) throw new ValidationError$1(`expect string to match regexp ${regexp}`, options);
	}
	checkWithinRange(data.length, meta, "string length", options);
	return [data];
});
function decimalShift(data, digits) {
	const str = data.toString();
	if (str.includes("e")) return data * Math.pow(10, digits);
	const index = str.indexOf(".");
	if (index === -1) return data * Math.pow(10, digits);
	const frac = str.slice(index + 1);
	const integer = str.slice(0, index);
	if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
	return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
	step = Math.abs(step);
	if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
	const index = step.toString().indexOf(".");
	const digits = step.toString().slice(index + 1).length;
	return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
	if (typeof data !== "number") throw new ValidationError$1(`expected number but got ${data}`, options);
	checkWithinRange(data, meta, "number", options);
	const { step } = meta;
	if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError$1(`expected number multiple of ${step} but got ${data}`, options);
	return [data];
});
Schema.extend("boolean", (data, _, options) => {
	if (typeof data === "boolean") return [data];
	throw new ValidationError$1(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
	let value = 0, keys = [];
	if (typeof data === "number") {
		value = data;
		for (const key in bits) if (data & bits[key]) keys.push(key);
	} else if (Array.isArray(data)) {
		keys = data;
		for (const key of keys) {
			if (typeof key !== "string") throw new ValidationError$1(`expected string but got ${key}`, options);
			if (key in bits) value |= bits[key];
		}
	} else throw new ValidationError$1(`expected number or array but got ${data}`, options);
	if (value === meta.default) return [value];
	return [value, keys];
});
Schema.extend("function", (data, _, options) => {
	if (typeof data === "function") return [data];
	throw new ValidationError$1(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
	if (typeof constructor === "function") {
		if (data instanceof constructor) return [data];
		throw new ValidationError$1(`expected ${constructor.name} but got ${data}`, options);
	} else {
		if (isNullable(data)) throw new ValidationError$1(`expected ${constructor} but got ${data}`, options);
		let prototype = Object.getPrototypeOf(data);
		while (prototype) {
			if (prototype.constructor?.name === constructor) return [data];
			prototype = Object.getPrototypeOf(prototype);
		}
		throw new ValidationError$1(`expected ${constructor} but got ${data}`, options);
	}
});
function property(data, key, schema, options) {
	try {
		const [value, adapted] = Schema.resolve(data[key], schema, {
			...options,
			path: [...options.path || [], key]
		});
		if (adapted !== void 0) data[key] = adapted;
		return value;
	} catch (e) {
		if (!options?.autofix) throw e;
		delete data[key];
		return schema.meta.default;
	}
}
Schema.extend("array", (data, { inner, meta }, options) => {
	if (!Array.isArray(data)) throw new ValidationError$1(`expected array but got ${data}`, options);
	checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
	return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
	if (!isPlainObject$1(data)) throw new ValidationError$1(`expected object but got ${data}`, options);
	const result = {};
	for (const key in data) {
		let rKey;
		try {
			rKey = Schema.resolve(key, sKey, options)[0];
		} catch (error) {
			if (strict) continue;
			throw error;
		}
		result[rKey] = property(data, key, inner, options);
		data[rKey] = data[key];
		if (key !== rKey) delete data[key];
	}
	return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
	if (!Array.isArray(data)) throw new ValidationError$1(`expected array but got ${data}`, options);
	const result = list.map((inner, index) => property(data, index, inner, options));
	if (strict) return [result];
	result.push(...data.slice(list.length));
	return [result];
});
function merge$1(result, data) {
	for (const key in data) {
		if (key in result) continue;
		result[key] = data[key];
	}
}
Schema.extend("object", (data, { dict }, options, strict) => {
	if (!isPlainObject$1(data)) throw new ValidationError$1(`expected object but got ${data}`, options);
	const result = {};
	for (const key in dict) {
		const value = property(data, key, dict[key], options);
		if (!isNullable(value) || key in data) result[key] = value;
	}
	if (!strict) merge$1(result, data);
	return [result];
});
Schema.extend("union", (data, { list, toString }, options, strict) => {
	const messages = [];
	for (const inner of list) try {
		return Schema.resolve(data, inner, options, strict);
	} catch (error) {
		messages.push(error);
	}
	throw new ValidationError$1(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString }, options, strict) => {
	if (!list.length) return [data];
	let result;
	for (const inner of list) {
		const value = Schema.resolve(data, inner, options, true)[0];
		if (isNullable(value)) continue;
		if (isNullable(result)) result = value;
		else if (typeof result !== typeof value) throw new ValidationError$1(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
		else if (typeof value === "object") merge$1(result ??= {}, value);
		else if (result !== value) throw new ValidationError$1(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
	}
	if (!strict && isPlainObject$1(data)) merge$1(result, data);
	return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
	const [result, adapted = data] = Schema.resolve(data, inner, options, true);
	if (preserve) return [callback(result)];
	else return [callback(result), callback(adapted)];
});
const formatters = {};
function defineMethod(name, keys, format) {
	formatters[name] = format;
	Object.assign(Schema, { [name](...args) {
		const schema = new Schema({ type: name });
		keys.forEach((key, index) => {
			switch (key) {
				case "sKey":
					schema.sKey = args[index] ?? Schema.string();
					break;
				case "inner":
					schema.inner = Schema.from(args[index]);
					break;
				case "list":
					schema.list = args[index].map(Schema.from);
					break;
				case "dict":
					schema.dict = mapValues(args[index], Schema.from);
					break;
				case "bits":
					schema.bits = {};
					for (const key in args[index]) {
						if (typeof args[index][key] !== "number") continue;
						schema.bits[key] = args[index][key];
					}
					break;
				case "callback": {
					const callback = schema.callback = args[index];
					callback["toJSON"] ||= () => callback.toString();
					break;
				}
				case "constructor": {
					const constructor = schema.constructor = args[index];
					if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
					break;
				}
				default: schema[key] = args[index];
			}
		});
		if (name === "object" || name === "dict") schema.meta.default = {};
		else if (name === "array" || name === "tuple") schema.meta.default = [];
		else if (name === "bitset") schema.meta.default = 0;
		return schema;
	} });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
	if (typeof constructor === "function") return constructor.name;
	else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
	if (Object.keys(dict).length === 0) return "{}";
	return `{ ${Object.entries(dict).map(([key, inner]) => {
		return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
	}).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
	const result = list.map(({ toString: format }) => format()).join(" | ");
	return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
	return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
	"inner",
	"callback",
	"preserve"
], ({ inner }, isInner) => inner.toString(isInner));
//#endregion
//#region ../../../Core/vendor/cordis/src/utils.ts
/** Ordered collection of disposable values with O(1) deletion by value. */
var DisposableList = class {
	sn = 0;
	map = /* @__PURE__ */ new Map();
	weak = /* @__PURE__ */ new WeakMap();
	get length() {
		return this.map.size;
	}
	push(value) {
		const sn = ++this.sn;
		this.map.set(sn, value);
		this.weak.set(value, sn);
		return () => this.map.delete(sn);
	}
	delete(value) {
		const sn = this.weak.get(value);
		if (!sn) return false;
		return this.map.delete(sn);
	}
	clear() {
		const values = [...this.map.values()];
		this.map.clear();
		return values.reverse();
	}
	[Symbol.iterator]() {
		return this.map.values();
	}
	[Symbol.for("nodejs.util.inspect.custom")]() {
		return [...this];
	}
};
/** Shared symbols used to avoid public property-name collisions. */
const symbols = {
	shadow: Symbol.for("cordis.shadow"),
	receiver: Symbol.for("cordis.receiver"),
	original: Symbol.for("cordis.original"),
	metadata: Symbol.for("cordis.metadata"),
	initHooks: Symbol.for("cordis.initHooks"),
	checkProto: Symbol.for("cordis.checkProto"),
	effect: Symbol.for("cordis.effect"),
	filter: Symbol.for("cordis.filter"),
	isolate: Symbol.for("cordis.isolate"),
	intercept: Symbol.for("cordis.intercept"),
	init: Symbol.for("cordis.init"),
	check: Symbol.for("cordis.check"),
	config: Symbol.for("cordis.config"),
	invoke: Symbol.for("cordis.invoke"),
	extend: Symbol.for("cordis.extend"),
	tracker: Symbol.for("cordis.tracker"),
	resolveConfig: Symbol.for("cordis.resolveConfig")
};
const GeneratorFunction = function* () {}.constructor;
const AsyncGeneratorFunction = async function* () {}.constructor;
/** Return true when a plugin callback should be constructed with `new`. */
function isConstructor(func) {
	if (!func.prototype) return false;
	if (func instanceof GeneratorFunction) return false;
	if (AsyncGeneratorFunction !== Function && func instanceof AsyncGeneratorFunction) return false;
	return true;
}
/** Merge two prototype chains while preserving descriptors from `proto1`. */
function joinPrototype(proto1, proto2) {
	if (proto1 === Object.prototype) return proto2;
	const result = Object.create(joinPrototype(Object.getPrototypeOf(proto1), proto2));
	for (const key of Reflect.ownKeys(proto1)) Object.defineProperty(result, key, Object.getOwnPropertyDescriptor(proto1, key));
	return result;
}
/** Return true for non-null objects and functions. */
function isObject$1(value) {
	return value && (typeof value === "object" || typeof value === "function");
}
/** Find a property descriptor by walking an object's prototype chain. */
function getPropertyDescriptor(target, prop) {
	let proto = target;
	while (proto) {
		const desc = Reflect.getOwnPropertyDescriptor(proto, prop);
		if (desc) return desc;
		proto = Object.getPrototypeOf(proto);
	}
}
/** Wrap services/functions so method calls see the caller's active context. */
function getTraceable(ctx, value) {
	if (!isObject$1(value)) return value;
	if (Object.hasOwn(value, symbols.shadow)) return Object.getPrototypeOf(value);
	const tracker = value[symbols.tracker];
	if (!tracker) return value;
	return createTraceable(ctx, value, tracker);
}
/** Return a proxy that overlays readonly or writable properties onto a target. */
function withProps(target, props) {
	if (!props) return target;
	return new Proxy(target, {
		get: (target, prop, receiver) => {
			if (prop in props && prop !== "constructor") return Reflect.get(props, prop, receiver);
			return Reflect.get(target, prop, receiver);
		},
		set: (target, prop, value, receiver) => {
			if (prop in props && prop !== "constructor") return Reflect.set(props, prop, value, receiver);
			return Reflect.set(target, prop, value, receiver);
		}
	});
}
function withProp(target, prop, value) {
	return withProps(target, Object.defineProperty(Object.create(null), prop, {
		value,
		writable: false
	}));
}
function createShadow(ctx, target, property, receiver) {
	if (!property) return receiver;
	const origin = Reflect.getOwnPropertyDescriptor(target, property)?.value;
	if (!origin) return receiver;
	return withProp(receiver, property, ctx.extend({ [symbols.shadow]: origin }));
}
function createShadowMethod(ctx, value, outer, shadow) {
	return new Proxy(value, { apply: (target, thisArg, args) => {
		if (thisArg === outer) thisArg = shadow;
		return getTraceable(ctx, Reflect.apply(target, thisArg, args));
	} });
}
function createTraceable(ctx, value, tracker) {
	if (ctx[symbols.shadow] && !tracker.noShadow) ctx = Object.getPrototypeOf(ctx);
	const proxy = new Proxy(value, {
		get: (target, prop, receiver) => {
			if (prop === symbols.original) return target;
			if (prop === tracker.property) return ctx;
			if (typeof prop === "symbol") return Reflect.get(target, prop, receiver);
			if (tracker.associate && ctx.reflect.props[`${tracker.associate}.${prop}`]) return Reflect.get(ctx, `${tracker.associate}.${prop}`, withProp(ctx, symbols.receiver, receiver));
			let shadow, innerValue;
			const desc = getPropertyDescriptor(target, prop);
			if (desc && "value" in desc) innerValue = desc.value;
			else {
				shadow = createShadow(ctx, target, tracker.property, receiver);
				innerValue = Reflect.get(target, prop, shadow);
			}
			const innerTracker = innerValue?.[symbols.tracker];
			if (innerTracker) return createTraceable(ctx, innerValue, innerTracker);
			else if (!tracker.noShadow && typeof innerValue === "function") {
				shadow ??= createShadow(ctx, target, tracker.property, receiver);
				return createShadowMethod(ctx, innerValue, receiver, shadow);
			} else return innerValue;
		},
		set: (target, prop, value, receiver) => {
			if (prop === symbols.original) return false;
			if (prop === tracker.property) return false;
			if (typeof prop === "symbol") return Reflect.set(target, prop, value, receiver);
			if (tracker.associate && ctx.reflect.props[`${tracker.associate}.${prop}`]) return Reflect.set(ctx, `${tracker.associate}.${prop}`, value, withProp(ctx, symbols.receiver, receiver));
			const shadow = createShadow(ctx, target, tracker.property, receiver);
			return Reflect.set(target, prop, value, shadow);
		},
		apply: (target, thisArg, args) => {
			return applyTraceable(proxy, target, thisArg, args);
		}
	});
	return proxy;
}
function applyTraceable(proxy, value, thisArg, args) {
	if (!value[symbols.invoke]) return Reflect.apply(value, thisArg, args);
	return value[symbols.invoke].apply(proxy, args);
}
/** Create a callable service object that dispatches through `symbols.invoke`. */
function createCallable(name, proto, tracker) {
	const self = function(...args) {
		return applyTraceable(createTraceable(self["ctx"], self, tracker), self, this, args);
	};
	defineProperty(self, "name", name);
	return Object.setPrototypeOf(self, proto);
}
function handleError(info, reason, getOuterStack) {
	const innerLines = info.error.stack.split("\n");
	if (typeof reason?.stack !== "string") {
		const outerError = new Error(reason);
		const lines = outerError.stack.split("\n");
		lines.splice(1, Infinity, ...getOuterStack());
		outerError.stack = lines.join("\n");
		throw outerError;
	}
	const lines = reason.stack.split("\n");
	let index = lines.indexOf(innerLines[2]);
	if (index === -1) throw reason;
	index -= info.offset;
	while (index > 0) {
		if (!lines[index - 1].endsWith(" (<anonymous>)")) break;
		index -= 1;
	}
	lines.splice(index, Infinity, ...getOuterStack());
	reason.stack = lines.join("\n");
	throw reason;
}
/** Run a callback and splice outer call-site frames into thrown async errors. */
function composeError(callback, getOuterStack = buildOuterStack()) {
	const info = {
		offset: 1,
		error: /* @__PURE__ */ new Error()
	};
	try {
		const result = callback(info);
		if (isObject$1(result) && "then" in result) return result.then(void 0, (reason) => handleError(info, reason, getOuterStack));
		else return result;
	} catch (reason) {
		handleError(info, reason, getOuterStack);
	}
}
/** Capture a lazy stack-frame supplier for later error composition. */
function buildOuterStack(offset = 0) {
	const outerError = /* @__PURE__ */ new Error();
	return () => outerError.stack.split("\n").slice(3 + offset);
}
//#endregion
//#region ../../../Core/vendor/cordis/src/events.ts
/**
* Return whether an event result should stop a bail-style dispatch.
*
* @param value — a listener's return value.
* @returns `true` unless `value` is `null`, `false`, or `undefined`.
*/
function isBailed(value) {
	return value !== null && value !== false && value !== void 0;
}
/**
* Event bus installed as `ctx.events` and mixed into every context.
*
* The service supports concurrent, synchronous, serial, bail, and waterfall
* dispatch and automatically disposes listeners with their owning fiber.
*/
var EventsService = class {
	ctx;
	_hooks = {};
	constructor(ctx) {
		this.ctx = ctx;
		defineProperty(this, symbols.tracker, {
			property: "ctx",
			noShadow: true
		});
		this.on("internal/listener", function(name, listener, options) {
			if (name === "internal/update" && !options.global) return (this.fiber._hooks["internal/update"] ??= new DisposableList())[options.prepend ? "unshift" : "push"](listener);
		});
		this.on("internal/update", function(config, noSave, next) {
			const cbs = [...this._hooks["internal/update"] || []];
			const _next = () => {
				return (cbs.shift() ?? next).call(this, config, noSave, _next);
			};
			return _next();
		}, {
			global: true,
			prepend: true
		});
	}
	/**
	* Resolve listeners for one dispatch and apply context filtering.
	*
	* @param type — the dispatch mode, reported on `internal/dispatch`.
	* @param args — the raw dispatch arguments; consumed up to the event name.
	* @returns the matching listener callbacks, bound to the dispatch `this`.
	*/
	dispatch(type, args) {
		const thisArg = typeof args[0] === "object" || typeof args[0] === "function" ? args.shift() : null;
		const name = args.shift();
		if (!name.startsWith("internal/")) this.emit("internal/dispatch", type, name, args, thisArg);
		const filter = thisArg?.[Context.filter];
		return (this._hooks[name] || []).filter((hook) => hook.global || !filter || filter.call(thisArg, hook.ctx)).map((hook) => hook.callback.bind(thisArg));
	}
	/**
	* Run listeners concurrently and wait for all of them.
	*
	* @param args — optional `this`, the event name, then listener arguments.
	* @returns a promise resolving once every listener has settled.
	*/
	async parallel(...args) {
		const errors = (await Promise.allSettled(this.dispatch("emit", args).map(async (cb) => cb(...args)))).filter((result) => result.status === "rejected");
		if (errors.length) throw new AggregateError(errors.map((error) => error.reason));
	}
	/**
	* Run listeners synchronously without waiting for returned promises.
	*
	* @param args — optional `this`, the event name, then listener arguments.
	*/
	emit(...args) {
		this.dispatch("emit", args).map((cb) => cb(...args));
	}
	/**
	* Run listeners in order, awaiting each, until one returns a bail value.
	*
	* @param args — optional `this`, the event name, then listener arguments.
	* @returns the first bail value (see {@link isBailed}), if any.
	*/
	async serial(...args) {
		for (const cb of this.dispatch("serial", args)) {
			const result = await cb(...args);
			if (isBailed(result)) return result;
		}
	}
	/**
	* Run listeners synchronously until one returns a bail value.
	*
	* @param args — optional `this`, the event name, then listener arguments.
	* @returns the first bail value (see {@link isBailed}), if any.
	*/
	bail(...args) {
		for (const cb of this.dispatch("bail", args)) {
			const result = cb(...args);
			if (isBailed(result)) return result;
		}
	}
	/**
	* Compose listeners around the final `next` callback.
	*
	* The last dispatch argument is treated as the innermost `next`. Listeners
	* run outermost-first; a listener that does not call `next()` vetoes the
	* rest of the chain, including the built-in behavior.
	*
	* @param args — optional `this`, the event name, listener arguments, then `next`.
	* @returns the outermost listener's return value.
	*/
	waterfall(...args) {
		const cbs = this.dispatch("waterfall", args);
		const inner = args.pop();
		const next = () => {
			return (cbs.shift() ?? inner)(...args);
		};
		args.push(next);
		return next();
	}
	/**
	* Store a listener record as an effect on the current fiber.
	*
	* @param label — effect label shown in fiber diagnostics.
	* @param hooks — the listener list for one event.
	* @param callback — the listener to store.
	* @param options — placement and filtering options.
	* @returns a disposer that unregisters the listener.
	*/
	register(label, hooks, callback, options) {
		const method = options.prepend ? "unshift" : "push";
		return this.ctx.fiber.effect(() => {
			hooks[method]({
				ctx: this.ctx,
				callback,
				...options
			});
			return () => this.unregister(hooks, callback);
		}, label);
	}
	/**
	* Remove a stored listener record.
	*
	* @param hooks — the listener list for one event.
	* @param callback — the listener to remove.
	* @returns `true` if the listener was found and removed.
	*/
	unregister(hooks, callback) {
		const index = hooks.findIndex((hook) => hook.callback === callback);
		if (index >= 0) {
			hooks.splice(index, 1);
			return true;
		}
	}
	/**
	* Register an event listener owned by the current fiber.
	*
	* The listener is removed automatically when the fiber unloads. Throws
	* `CordisError('INACTIVE_EFFECT')` if the fiber is already disposed.
	*
	* @param name — the event name to listen for.
	* @param listener — called with the dispatch arguments.
	* @param options — listener options; a boolean is shorthand for `prepend`.
	* @returns a disposer removing the listener; `true` if it was still registered.
	*/
	on(name, listener, options) {
		if (typeof options !== "object") options = { prepend: options };
		this.ctx.fiber.assertActive();
		listener = this.ctx.reflect.bind(listener);
		const result = this.bail(this.ctx, "internal/listener", name, listener, options);
		if (result) return result;
		const hooks = this._hooks[name] ||= [];
		const label = `ctx.on(${typeof name === "string" ? JSON.stringify(name) : name.toString()})`;
		return this.register(label, hooks, listener, options);
	}
	/**
	* Register an event listener that disposes itself after the first call.
	*
	* @param name — the event name to listen for.
	* @param listener — called at most once with the dispatch arguments.
	* @param options — listener options; a boolean is shorthand for `prepend`.
	* @returns a disposer removing the listener; `true` if it was still registered.
	*/
	once(name, listener, options) {
		const dispose = this.on(name, function(...args) {
			dispose();
			return listener.apply(this, args);
		}, options);
		return dispose;
	}
};
//#endregion
//#region ../../../Core/vendor/cordis/src/logger.ts
/** Built-in placeholder formatters used by `Logger.format()`. */
const defaultFormatters = {
	s: (value) => String(value),
	d: (value) => Math.trunc(Number(value)),
	i: (value) => Math.trunc(Number(value)),
	f: (value) => Number(value),
	o: (value) => JSON.stringify(value),
	O: (value) => JSON.stringify(value),
	c: () => "",
	C: (value, exporter, message) => {
		return Logger.color(exporter, Logger.code(message.name, exporter.colors), value);
	}
};
function isAggregateError(error) {
	return error instanceof Error && Array.isArray(error["errors"]);
}
/** Logger facade for one named subsystem. */
var Logger = class {
	service;
	static color(exporter, code, value, decoration = "") {
		if (!exporter.colors) return "" + value;
		return `\u001b[3${code < 8 ? code : "8;5;" + code}${exporter.colors >= 2 ? decoration : ""}m${value}\u001b[0m`;
	}
	static code(name, level) {
		let hash = 0;
		for (let i = 0; i < name.length; i++) {
			hash = (hash << 3) - hash + name.charCodeAt(i) + 13;
			hash |= 0;
		}
		const colors = !level ? [] : level >= 2 ? c256 : c16;
		return colors[Math.abs(hash) % colors.length];
	}
	static format(exporter, message) {
		const args = message.args.slice();
		if (args[0] instanceof Error) {
			args[0] = args[0].stack || args[0].message;
			args.unshift("%s");
		} else if (typeof args[0] !== "string") args.unshift("%o");
		let format = args.shift();
		format = format.replace(/%([a-zA-Z%])/g, (match, char) => {
			if (match === "%%") return "%";
			const formatter = exporter.formatters?.[char] ?? defaultFormatters[char];
			if (typeof formatter === "function") return formatter(args.shift(), exporter, message);
			return match;
		});
		const oFormatter = exporter.formatters?.o ?? defaultFormatters.o;
		for (let arg of args) {
			if (typeof arg === "object" && arg) arg = oFormatter(arg, exporter, message);
			format += " " + arg;
		}
		const { maxLength = 10240 } = exporter;
		return format.split(/\r?\n/g).map((line) => {
			return line.slice(0, maxLength) + (line.length > maxLength ? "..." : "");
		}).join("\n");
	}
	constructor(options, service) {
		this.service = service;
		Object.assign(this, options);
		this.error = this._method("error", 0);
		this.info = this._method("info", 1);
		this.warn = this._method("warn", 2);
		this.debug = this._method("debug", 3);
	}
	_method(type, level) {
		return (...args) => {
			if (args.length === 1 && args[0] instanceof Error) {
				if (args[0].cause) this[type](args[0].cause);
				else if (isAggregateError(args[0])) {
					args[0].errors.forEach((error) => this[type](error));
					return;
				}
			}
			const sn = ++this.service._snMessage;
			const ts = Date.now();
			for (const exporter of this.service.exporters.values()) {
				if ((exporter.levels?.[this.name] ?? exporter.levels?.default ?? this.level ?? 1) < level) continue;
				const message = {
					sn,
					ts,
					type,
					level,
					name: this.name,
					...this.meta,
					args
				};
				exporter.export(message);
			}
		};
	}
};
/** ANSI 16-color palette indexes used for logger name coloring. */
const c16 = [
	6,
	2,
	3,
	4,
	5,
	1
];
/** ANSI 256-color palette indexes used for logger name coloring. */
const c256 = [
	20,
	21,
	26,
	27,
	32,
	33,
	38,
	39,
	40,
	41,
	42,
	43,
	44,
	45,
	56,
	57,
	62,
	63,
	68,
	69,
	74,
	75,
	76,
	77,
	78,
	79,
	80,
	81,
	92,
	93,
	98,
	99,
	112,
	113,
	129,
	134,
	135,
	148,
	149,
	160,
	161,
	162,
	163,
	164,
	165,
	166,
	167,
	168,
	169,
	170,
	171,
	172,
	173,
	178,
	179,
	184,
	185,
	196,
	197,
	198,
	199,
	200,
	201,
	202,
	203,
	204,
	205,
	206,
	207,
	208,
	209,
	214,
	215,
	220,
	221
];
/**
* Built-in logging service.
*
* Call `ctx.logger()` to create a named logger, or call `ctx.logger.info()`
* directly to log with the current fiber-derived name.
*/
var LoggerService = class LoggerService {
	bufferSize = 1e3;
	buffer = [];
	ctx;
	_snMessage = 0;
	_snExporter = 0;
	exporters = /* @__PURE__ */ new Map();
	constructor(ctx) {
		const tracker = {
			property: "ctx",
			noShadow: true
		};
		const self = createCallable("logger", joinPrototype(Object.getPrototypeOf(this), Function.prototype), tracker);
		Object.assign(self, this);
		self.ctx = ctx;
		defineProperty(self, symbols.tracker, tracker);
		self.exporter({
			colors: 3,
			export: (message) => {
				self.buffer.push(message);
				if (self.buffer.length > self.bufferSize) self.buffer = self.buffer.slice(-self.bufferSize);
			}
		});
		return self;
	}
	/**
	* Register an exporter and dispose it with the current fiber.
	*
	* @param exporter — the sink that receives structured log messages.
	* @returns a disposer that removes the exporter.
	*/
	exporter(exporter) {
		return this.ctx.effect(() => {
			this.exporters.set(++this._snExporter, exporter);
			return () => this.exporters.delete(this._snExporter);
		}, "ctx.logger.exporter()");
	}
	_resolveConfig() {
		let intercept = this.ctx[symbols.intercept];
		const configs = [];
		while ("logger" in intercept) {
			if (Object.hasOwn(intercept, "logger")) configs.unshift(intercept["logger"]);
			intercept = Object.getPrototypeOf(intercept);
		}
		return Object.assign({}, ...configs);
	}
	[symbols.invoke](name) {
		const config = this._resolveConfig();
		const fiber = (this.ctx[symbols.shadow] ?? this.ctx).fiber;
		name ??= config.name;
		name ??= hyphenate(fiber.name);
		return new Logger({
			name,
			level: config.level,
			meta: { fiber: new WeakRef(fiber) }
		}, this);
	}
	static {
		for (const type of [
			"error",
			"info",
			"warn",
			"debug"
		]) LoggerService.prototype[type] = function(...args) {
			return this()[type](...args);
		};
	}
};
//#endregion
//#region ../../../Core/vendor/cordis/src/fiber.ts
const kValidationError = Symbol.for("ValidationError");
/** Error raised when plugin configuration fails standard-schema validation. */
var ValidationError = class extends TypeError {
	name = "ValidationError";
	/**
	* Build the aggregated message from schema issues.
	*
	* @param issues — the standard-schema issues, one message line each.
	*/
	constructor(issues) {
		super(`invalid config:\n` + issues.map((issue) => {
			if (issue.path) return `  - ${issue.message} (at ${issue.path.join(".")})`;
			else return `  - ${issue.message}`;
		}).join("\n"));
	}
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
/**
* Validate and normalize config for a plugin runtime before it starts.
*
* @param runtime — the plugin runtime whose `Config` schema to apply.
* @param config — the raw user config.
* @returns the validated config, or `config` unchanged if the runtime has no schema.
* @throws {ValidationError} when validation reports issues.
*/
function resolveConfig(runtime, config) {
	if (!runtime.Config) return config;
	const result = runtime.Config["~standard"].validate(config);
	if ("then" in result) throw new TypeError("Async config validation is not supported");
	if (result.issues) throw new ValidationError(result.issues);
	else return result.value;
}
const effectInertia = /* @__PURE__ */ new WeakMap();
function runDisposable(dispose) {
	const result = dispose();
	return effectInertia.get(dispose)?.() ?? result;
}
/** Notify plugin teardown without allowing one observer to break ownership cleanup. */
function emitPluginDisposed(context, fiber) {
	const args = ["internal/plugin", fiber];
	let callbacks;
	try {
		callbacks = context.events.dispatch("emit", args);
	} catch (error) {
		context.logger.error(error);
		return;
	}
	for (const callback of callbacks) try {
		const returned = callback(...args);
		Promise.resolve(returned).catch((error) => context.logger.error(error));
	} catch (error) {
		context.logger.error(error);
	}
}
/** Framework error with a stable machine-readable code. */
var CordisError = class CordisError extends Error {
	code;
	/**
	* @param code — the stable error code; also the default message.
	* @param message — optional human-readable override.
	*/
	constructor(code, message) {
		super(message ?? CordisError.Code[code]);
		this.code = code;
	}
};
(function(_CordisError) {
	_CordisError.Code = { INACTIVE_EFFECT: "cannot create effect on inactive context" };
})(CordisError || (CordisError = {}));
const INACTIVE = "__INACTIVE__";
/**
* Runtime instance of one plugin application.
*
* A fiber tracks dependency state, validated config, lifecycle effects, and
* cleanup for the plugin context returned by `ctx.plugin()`.
*/
var Fiber = class {
	parent;
	inject;
	runtime;
	/** Unique id within the registry; 0 for the root fiber, `null` once disposed. */
	uid;
	/** The context this fiber's plugin runs in (extends the parent context). */
	ctx;
	/** The validated plugin config (updated by `update()`). */
	config;
	/** The raw plugin config, re-resolved before each activation. */
	_config;
	/** Current lifecycle state; transitions emit `internal/status`. */
	state = 0;
	/** Dispose this fiber: unload the plugin, then settle once cleanup finished. */
	dispose;
	/** Snapshot of required service implementations while loaded; `undefined` otherwise. */
	store;
	/** The in-flight load/unload transition, if one is currently running. */
	inertia;
	_hooks = Object.create(null);
	_disposables = new DisposableList();
	context;
	_error;
	_runner;
	_store = Object.create(null);
	/**
	* Create a fiber. Plugin authors normally obtain fibers from `ctx.plugin()`
	* rather than constructing them directly.
	*
	* @param parent — the context the plugin was loaded from.
	* @param config — raw config, validated against the runtime's schema.
	* @param inject — resolved dependency map (service name → intercept config).
	* @param runtime — the shared plugin runtime, or `null` for the root fiber.
	* @param getOuterStack — captures the caller stack for effect diagnostics.
	*/
	constructor(parent, config, inject, runtime, getOuterStack) {
		this.parent = parent;
		this.inject = inject;
		this.runtime = runtime;
		this._config = config;
		const collect = (dispose) => {
			this._disposables.push(dispose);
		};
		if (runtime) {
			this.uid = parent.registry.counter;
			this.ctx = this.context = parent.extend({ fiber: this });
			const injectEntries = Object.entries(this.inject);
			if (injectEntries.length) {
				this.ctx[Context.intercept] = Object.create(parent[Context.intercept]);
				for (const [name, config] of injectEntries) {
					if (isNullable(config)) continue;
					this.ctx[Context.intercept][name] = config;
				}
			}
			this._runner = {
				epoch: INACTIVE,
				getOuterStack,
				execute: function() {
					if (isConstructor(runtime.callback)) {
						const instance = new runtime.callback(this.ctx, this.config);
						for (const hook of instance?.[symbols.initHooks] ?? []) hook();
						return instance?.[symbols.init]?.();
					} else return runtime.callback(this.ctx, this.config);
				},
				collect
			};
			this.dispose = parent.fiber.effect(() => {
				const remove = runtime.fibers.push(this);
				return async () => {
					this.uid = null;
					emitPluginDisposed(this.context, this);
					if (this.ctx.registry.has(runtime.callback)) {
						remove();
						if (!runtime.fibers.length) this.ctx.registry.delete(runtime.callback);
					}
					this._setEpoch(INACTIVE);
					if (!this.inertia) this._updateState(() => {
						this.inertia = this._unload();
						return 5;
					});
					while (this.inertia) await this.inertia;
				};
			}, "ctx.plugin()");
			try {
				this.context.emit("internal/plugin", this);
			} catch (error) {
				Promise.resolve(this.dispose()).catch((reason) => this.ctx.logger.error(reason));
				throw error;
			}
			if (this.uid !== null && parent.fiber.state !== 5) {
				for (const name of Object.keys(this.inject)) this._checkImpl(name);
				this._refresh();
			}
		} else {
			this.uid = 0;
			this.ctx = this.context = parent;
			this.state = 2;
			this.store = Object.create(null);
			this._runner = {
				epoch: "",
				getOuterStack,
				execute: () => {},
				collect
			};
			this.dispose = () => this.restart();
		}
	}
	/** The plugin's display name, inherited from the nearest named ancestor, else `'root'`. */
	get name() {
		let fiber = this;
		do {
			if (fiber.runtime?.name) return fiber.runtime.name;
			fiber = fiber.parent.fiber;
		} while (fiber !== fiber.parent.fiber);
		return "root";
	}
	/**
	* Throw if the fiber has already been disposed.
	*
	* @returns nothing when the fiber is still active.
	* @throws {CordisError} `INACTIVE_EFFECT` when the fiber's uid has been cleared.
	*/
	assertActive() {
		if (this.uid !== null) return;
		throw new CordisError("INACTIVE_EFFECT");
	}
	_execute(runner) {
		const oldEpoch = runner.epoch;
		return composeError((info) => {
			const safeCollect = (dispose) => {
				if (typeof dispose === "function") runner.collect(dispose);
				else if (!isNullable(dispose)) throw new TypeError("Invalid effect");
			};
			const effect = runner.execute.call(this);
			if (typeof effect === "function") return runner.collect(effect);
			else if (isNullable(effect)) {} else if (!isObject$1(effect)) throw new TypeError("Invalid effect");
			else if ("then" in effect) return effect.then(safeCollect);
			else if (Symbol.iterator in effect) {
				info.error = /* @__PURE__ */ new Error();
				const iter = effect[Symbol.iterator]();
				while (true) {
					const result = iter.next();
					safeCollect(result.value);
					if (result.done) return;
				}
			} else if (Symbol.asyncIterator in effect) {
				const iter = effect[Symbol.asyncIterator]();
				return (async () => {
					await Promise.resolve();
					info.error = /* @__PURE__ */ new Error();
					while (true) {
						if (runner.epoch !== oldEpoch) return;
						const result = await iter.next();
						safeCollect(result.value);
						if (result.done) return;
					}
				})();
			} else throw new TypeError("Invalid effect");
		}, runner.getOuterStack);
	}
	effect(execute, label = "anonymous") {
		this.assertActive();
		if (this.state === 5) throw new CordisError("INACTIVE_EFFECT");
		const disposables = [];
		let disposing = false;
		let disposalTask;
		const dispose = () => {
			if (disposing) return disposalTask;
			disposing = true;
			let task;
			for (const disposable of disposables.splice(0).reverse()) if (task) task = task.then(() => runDisposable(disposable));
			else {
				const result = runDisposable(disposable);
				if (isObject$1(result) && "then" in result) task = result;
			}
			return disposalTask = task;
		};
		const meta = {
			label,
			children: []
		};
		const runner = {
			execute,
			epoch: true,
			collect: (dispose) => {
				disposables.push(dispose);
				this._disposables.delete(dispose);
				if (dispose[symbols.effect]) meta.children.push(dispose[symbols.effect]);
			},
			getOuterStack: buildOuterStack()
		};
		let task;
		let executing = true;
		let resolveSetup;
		let rejectSetup;
		let setupBarrier;
		let setupFailed = false;
		let inFlight;
		let removeWrapper = () => false;
		const waitForSetup = () => {
			setupBarrier ??= new Promise((resolve, reject) => {
				resolveSetup = resolve;
				rejectSetup = reject;
			});
			return setupBarrier;
		};
		const disposeAfter = (setup) => {
			return Promise.resolve(setup).then(() => dispose(), async (reason) => {
				await dispose();
				throw reason;
			});
		};
		const finalizeDisposal = (callback) => {
			let result;
			try {
				result = callback();
			} catch (error) {
				removeWrapper();
				throw error;
			}
			if (isObject$1(result) && "then" in result) {
				const pending = Promise.resolve(result).finally(() => {
					removeWrapper();
					if (inFlight === pending) inFlight = void 0;
				});
				return inFlight = pending;
			}
			removeWrapper();
			return result;
		};
		const wrapper = defineProperty(() => {
			if (!runner.epoch) return setupFailed ? inFlight : void 0;
			runner.epoch = false;
			return finalizeDisposal(() => {
				if (executing) return disposeAfter(waitForSetup());
				return task ? disposeAfter(task) : dispose();
			});
		}, symbols.effect, meta);
		effectInertia.set(wrapper, () => inFlight);
		removeWrapper = this._disposables.push(wrapper);
		try {
			task = this._execute(runner);
		} catch (reason) {
			executing = false;
			setupFailed = true;
			runner.epoch = false;
			let cleanup;
			try {
				cleanup = finalizeDisposal(dispose);
			} finally {
				rejectSetup?.(reason);
			}
			if (isObject$1(cleanup) && "then" in cleanup) cleanup.catch((error) => this.ctx.logger.error(error));
			throw reason;
		}
		executing = false;
		if (setupBarrier) Promise.resolve(task).then(resolveSetup, rejectSetup);
		task?.catch(() => {
			if (!runner.epoch) return dispose();
			return finalizeDisposal(dispose);
		}).catch((error) => this.ctx.logger.error(error));
		const disposeAsync = () => {
			if (!runner.epoch) return;
			runner.epoch = false;
			return finalizeDisposal(dispose);
		};
		wrapper.then = async (onFulfilled, onRejected) => {
			return Promise.resolve(task).then(() => disposeAsync).then(onFulfilled, onRejected);
		};
		return wrapper;
	}
	/**
	* Return metadata for currently registered effects.
	*
	* @returns one {@link EffectMeta} tree per labeled live effect.
	*/
	getEffects() {
		return [...this._disposables].map((dispose) => dispose[symbols.effect]).filter(Boolean);
	}
	_getState() {
		if (this.uid === null) return 4;
		if (this._error) return 3;
		if (this._runner.epoch !== INACTIVE) return 2;
		return 0;
	}
	_updateState(callback) {
		const oldState = this.state;
		this.state = callback() ?? this._getState();
		if (oldState === this.state) return;
		this.context.emit("internal/status", this, oldState);
		if (oldState !== 2 && this.state !== 2) return;
		for (const key of Reflect.ownKeys(this.ctx.reflect.store)) {
			const impl = this.ctx.reflect.store[key];
			if (impl.fiber !== this) continue;
			this.ctx.reflect.notify([impl.name]);
		}
	}
	_checkImpl(name) {
		const impl = this.ctx.reflect._getImpl(name, true);
		if (!impl) return delete this._store[name];
		try {
			if (impl.check && !impl.check.call(getTraceable(this.ctx, impl.value))) return delete this._store[name];
		} catch (error) {
			impl.fiber.ctx.logger.error(error);
			return delete this._store[name];
		}
		this._store[name] = impl;
	}
	_refresh() {
		let epoch = false;
		epoch = "";
		for (const name of Object.keys(this.inject)) {
			const impl = this._store[name];
			if (!impl) {
				epoch = INACTIVE;
				break;
			}
			epoch += ":" + impl.fiber.uid;
		}
		this._setEpoch(epoch);
	}
	_setEpoch(epoch) {
		const oldEpoch = this._runner.epoch;
		if (epoch === oldEpoch) return;
		this._runner.epoch = epoch;
		if (this.inertia) return;
		this._updateState(() => {
			if (epoch !== INACTIVE && oldEpoch === INACTIVE) {
				this.inertia = this._reload();
				return 1;
			} else {
				this.inertia = this._unload();
				return 5;
			}
		});
	}
	_resolveConfig(config) {
		config = this.context.waterfall(this, "internal/config", config, () => config);
		return this.runtime ? resolveConfig(this.runtime, config) : config;
	}
	async _reload() {
		this.store = { ...this._store };
		const oldEpoch = this._runner.epoch;
		try {
			await Promise.resolve();
			if (this._runner.epoch === oldEpoch) {
				this.config = this._resolveConfig(this._config);
				await this._execute(this._runner);
				this._error = void 0;
			}
		} catch (reason) {
			this.ctx.logger.error(reason);
			this._error = reason;
			this._runner.epoch = INACTIVE;
		}
		this._updateState(() => {
			if (this._runner.epoch === oldEpoch) this.inertia = void 0;
			else {
				this.inertia = this._unload();
				return 5;
			}
		});
	}
	async _unload() {
		await Promise.all(this._disposables.clear().map(async (dispose) => {
			try {
				await composeError(async (info) => {
					await Promise.resolve();
					info.error = /* @__PURE__ */ new Error();
					await runDisposable(dispose);
				}, this._runner.getOuterStack);
			} catch (reason) {
				this.ctx.logger.error(reason);
			}
		}));
		this.store = void 0;
		this._updateState(() => {
			if (this._runner.epoch === INACTIVE) this.inertia = void 0;
			else {
				this.inertia = this._reload();
				return 1;
			}
		});
	}
	/**
	* Wait for current lifecycle work and rethrow startup errors.
	*
	* @returns this fiber, once it has settled into a stable state.
	* @throws the config-validation or plugin-startup error, if any.
	*/
	async await() {
		while (this.inertia) await this.inertia;
		if (this._error) throw this._error;
		return this;
	}
	/**
	* Dispose and immediately reload this plugin with its current config.
	*
	* @returns a promise resolving once the reload settled.
	* @throws {CordisError} `INACTIVE_EFFECT` when the fiber is already disposed.
	*/
	async restart() {
		this.assertActive();
		this._setEpoch(INACTIVE);
		this._refresh();
		await this.await();
	}
	/**
	* Validate and apply new config, then restart the plugin.
	*
	* Runs the `internal/update` waterfall first, so update hooks (and HMR)
	* can veto or replace the restart.
	*
	* @param config — the new raw config; validated before anything restarts.
	* @param noSave — hint for persistence hooks not to write the change back.
	* @returns the update waterfall result; the default restart returns a promise.
	* @throws when validation, an update listener, or the restarted plugin fails.
	*/
	update(config, noSave = false) {
		this.assertActive();
		this._config = config;
		if (this.state !== 2) {
			this._error = void 0;
			this._setEpoch(INACTIVE);
			this._refresh();
			return;
		}
		config = this._resolveConfig(config);
		return this.context.waterfall(this, "internal/update", config, noSave, () => {
			this.config = config;
			this._error = void 0;
			return this.restart();
		});
	}
};
//#endregion
//#region ../../../Core/vendor/cordis/src/reflect.ts
function enhanceError(error) {
	const lines = error.stack.split("\n");
	lines.splice(0, 2, `Error: ${error.message}`);
	error.stack = lines.join("\n");
	return error;
}
const RESERVED_WORDS = ["prototype", "then"];
function isSpecialProperty(prop) {
	return typeof prop === "symbol" || RESERVED_WORDS.includes(prop) || parseInt(prop).toString() === prop || prop.startsWith("_");
}
/**
* Reflection and service-resolution layer installed as `ctx.reflect`.
*
* This service powers the context proxy, service registration, accessors, and
* the mixins that expose core service methods directly on `ctx`.
*/
var ReflectService = class {
	ctx;
	/** Proxy traps implementing service resolution for every context object. */
	static handler = {
		get: (target, prop, ctx) => {
			if (isSpecialProperty(prop)) return Reflect.get(target, prop, ctx);
			if (Reflect.has(target, prop)) return getTraceable(ctx, Reflect.get(target, prop, ctx));
			const error = /* @__PURE__ */ new Error(`cannot get property "${prop}" without inject`);
			try {
				const def = target.reflect.props[prop];
				if (def?.type === "accessor") return def.get.call(ctx, ctx[symbols.receiver], error);
				if (!ctx.fiber.runtime) return ctx.reflect.get(prop, false);
				return ctx.events.waterfall("internal/get", ctx, prop, error, () => {
					const key = target[symbols.isolate][prop];
					let fiber = (ctx[symbols.shadow] ?? ctx).fiber;
					while (true) {
						const impl = fiber.store?.[prop];
						if (impl) return getTraceable(ctx, impl.value);
						if (prop in fiber.inject) {
							error.message = `cannot get required service "${prop}" in inactive context`;
							throw error;
						}
						if (!fiber.runtime) throw error;
						if (fiber.parent[symbols.isolate][prop] !== key) throw error;
						fiber = fiber.parent.fiber;
					}
				});
			} catch (e) {
				throw e === error ? enhanceError(e) : e;
			}
		},
		set: (target, prop, value, ctx) => {
			if (isSpecialProperty(prop)) return Reflect.set(target, prop, value, ctx);
			const error = /* @__PURE__ */ new Error(`cannot set property "${prop}" without provide`);
			const def = target.reflect.props[prop];
			if (!def) {
				if (!ctx.fiber.runtime) return Reflect.set(target, prop, value, ctx);
				throw enhanceError(error);
			}
			try {
				if (def.type === "accessor") {
					if (!def.set) return false;
					return def.set.call(ctx, value, ctx[symbols.receiver], error);
				}
				return ctx.events.waterfall("internal/set", ctx, prop, value, error, () => {
					return ctx.reflect.set(prop, value, error);
				});
			} catch (e) {
				throw e === error ? enhanceError(e) : e;
			}
		},
		has: (target, prop) => {
			if (isSpecialProperty(prop)) return Reflect.has(target, prop);
			if (Reflect.has(target, prop)) return true;
			return !!target.reflect.props[prop];
		}
	};
	/** Service implementations, keyed by isolation label. */
	store = Object.create(null);
	/** Declared context properties (services and accessors), by name. */
	props = Object.create(null);
	constructor(ctx) {
		this.ctx = ctx;
		defineProperty(this, symbols.tracker, {
			property: "ctx",
			noShadow: true
		});
		this.mixin("reflect", [
			"get",
			"set",
			"provide",
			"accessor",
			"mixin"
		]);
		this.mixin("fiber", ["runtime", "effect"]);
		this.mixin("registry", ["inject", "plugin"]);
		this.mixin("events", [
			"on",
			"once",
			"parallel",
			"emit",
			"serial",
			"bail",
			"waterfall"
		]);
	}
	/**
	* Read a service from the store without the inject requirement.
	*
	* @param name — the service name.
	* @param strict — when `true`, only return implementations whose providing
	* fiber is currently active.
	* @returns the service value, or `undefined` when not (yet) provided.
	*/
	get(name, strict = true) {
		return getTraceable(this.ctx, this._getImpl(name, strict)?.value);
	}
	_getImpl(name, strict = true) {
		const key = this.ctx[symbols.isolate][name];
		const impl = key && this.store[key];
		if (!impl) return;
		if (strict && impl.fiber.state !== 2) return;
		return impl;
	}
	/**
	* Overwrite a provided service's value.
	*
	* @param name — the service name.
	* @param value — the new service value.
	* @param error — carrier for the caller stack in diagnostics.
	* @returns `true` on success.
	* @throws when `name` was never provided, or was provided by another fiber.
	*/
	set(name, value, error) {
		const key = this.ctx[symbols.isolate][name];
		const impl = this.store[key];
		if (!impl) throw new Error(`cannot set property "${name}" without provide`);
		if (impl.fiber !== this.ctx.fiber) throw new Error(`cannot set property "${name}" in multiple fibers`);
		impl.value = value;
		return true;
	}
	/**
	* Register a service implementation owned by the current fiber.
	*
	* See the `ctx.provide()` overload above for the full contract.
	*
	* @param name — the service name.
	* @param value — the service value.
	* @param check — optional availability predicate for dependents.
	* @returns a disposer that unregisters the service.
	*/
	provide(name, value, check) {
		return this.ctx.fiber.effect(() => {
			if (!this.props[name]) this.props[name] ??= { type: "service" };
			else if (this.props[name].type !== "service") throw new Error(`property "${name}" is already declared as ${this.props[name].type}`);
			this.props[name] = { type: "service" };
			this.ctx.root[symbols.isolate][name] ??= Symbol(name);
			const key = this.ctx[symbols.isolate][name];
			const impl = {
				name,
				value,
				fiber: this.ctx.fiber,
				check
			};
			if (this.store[key]) throw new Error(`service "${name}" has been registered at <${this.store[key].fiber.name}>`);
			this.store[key] = impl;
			this.ctx.fiber.store[name] = impl;
			if (this.ctx.fiber.state === 2) this.notify([name]);
			return async () => {
				delete this.store[key];
				const fibers = this.notify([name]);
				await Promise.allSettled(fibers.map((fiber) => fiber.await()));
				delete this.ctx.fiber.store[name];
			};
		}, `ctx.provide(${JSON.stringify(name)})`);
	}
	/**
	* Re-evaluate every fiber that requires one of the given services.
	*
	* @param names — the service names that changed.
	* @param filter — restricts notification to matching isolation scopes.
	* @returns the fibers whose dependency state was refreshed.
	*/
	notify(names, filter = (ctx, name) => ctx[symbols.isolate][name] === this.ctx[symbols.isolate][name]) {
		const fibers = [];
		for (const runtime of this.ctx.registry.values()) for (const fiber of runtime.fibers) {
			let hasUpdate = false;
			for (const name of names) {
				if (!(name in fiber.inject)) continue;
				if (!filter(fiber.ctx, name)) continue;
				hasUpdate = true;
				fiber._checkImpl(name);
			}
			if (!hasUpdate) continue;
			fiber._refresh();
			fibers.push(fiber);
		}
		for (const name of names) {
			const self = Object.create(this.ctx);
			self[symbols.filter] = (target) => filter(target, name);
			this.ctx.events.emit(self, "internal/service", name, this._getImpl(name, false)?.value);
		}
		return fibers;
	}
	/**
	* Define a computed context property backed by get/set hooks.
	*
	* @param name — the context property name.
	* @param options — the `get` hook and optional `set` hook.
	* @returns a disposer that removes the accessor.
	*/
	accessor(name, options) {
		return this.ctx.fiber.effect(() => {
			if (name in this.props) throw new Error(`property "${name}" is already declared as ${this.props[name].type}`);
			this.props[name] = {
				type: "accessor",
				...options
			};
			return () => delete this.props[name];
		}, `ctx.accessor(${JSON.stringify(name)})`);
	}
	/**
	* Expose selected members of a service directly on `ctx`.
	*
	* See the `ctx.mixin()` overload above for the full contract.
	*
	* @param source — a context property name or a source object.
	* @param mixins — keys to forward, or a source-key → ctx-key map.
	* @returns a disposer that removes all created accessors.
	*/
	mixin(source, mixins) {
		const self = this;
		return this.ctx.fiber.effect(function* () {
			const entries = Array.isArray(mixins) ? mixins.map((key) => [key, key]) : Object.entries(mixins);
			const getTarget = (ctx, error) => {
				return ctx[source];
			};
			for (const [key, value] of entries) yield self.accessor(value, {
				get(receiver, error) {
					const service = getTarget(this, error);
					if (isNullable(service)) return service;
					const mixin = receiver ? withProps(receiver, service) : service;
					const value = Reflect.get(service, key, mixin);
					if (typeof value !== "function") return value;
					return value.bind(mixin ?? service);
				},
				set(value, receiver, error) {
					const service = getTarget(this, error);
					const mixin = receiver ? withProps(receiver, service) : service;
					return Reflect.set(service, key, value, mixin);
				}
			});
		}, `ctx.mixin(${JSON.stringify(source)})`);
	}
	/**
	* Attach this context's tracing wrapper to a value.
	*
	* @param value — the value to wrap.
	* @returns the traceable wrapper (or the value itself when not applicable).
	*/
	trace(value) {
		return getTraceable(this.ctx, value);
	}
	/**
	* Wrap a callback so calls trace `this` and arguments to this context.
	*
	* @param callback — the function to wrap.
	* @returns a proxy delegating to `callback` with traced values.
	*/
	bind(callback) {
		return new Proxy(callback, {
			apply: (target, thisArg, args) => {
				return Reflect.apply(target, this.trace(thisArg), args.map((arg) => this.trace(arg)));
			},
			construct: (target, args, newTarget) => {
				return Reflect.construct(target, args.map((arg) => this.trace(arg)), newTarget);
			}
		});
	}
};
//#endregion
//#region ../../../Core/vendor/cordis/src/registry.ts
function isApplicable(object) {
	return object && typeof object === "object" && typeof object.apply === "function";
}
/**
* Decorator for declaring service dependencies on classes or class methods.
*
* On classes it contributes to the plugin's static `inject` map. On methods it
* delays the method call until the declared services are available.
*/
/**
* @param name — the required service name.
* @param config — optional intercept config applied for that service.
* @returns the class or method decorator.
*/
function Inject(name, config) {
	return function(value, decorator) {
		if (decorator.kind === "class") {
			if (!Object.hasOwn(value, "inject")) {
				defineProperty(value, "inject", Object.create(Object.getPrototypeOf(value).inject ?? null));
				defineProperty(value.inject, symbols.checkProto, true);
			}
			value.inject[name] = config;
		} else if (decorator.kind === "method") {
			const inject = (value[symbols.metadata] ??= {}).inject ??= Object.create(null);
			inject[name] = config;
			decorator.addInitializer(function() {
				const property = this[symbols.tracker]?.property;
				(this[symbols.initHooks] ??= []).push(() => {
					this.ctx.inject(inject, (ctx) => {
						return value.call(property ? withProps(this, { [property]: ctx }) : this);
					});
				});
			});
		} else throw new Error("@Inject() can only be used on class or class methods");
	};
}
(function(_Inject) {
	function resolve(inject, result = Object.create(null)) {
		if (!inject) return result;
		if (Array.isArray(inject)) for (const name of inject) result[name] = null;
		else if (Reflect.has(inject, symbols.checkProto)) {
			Object.assign(result, resolve(Object.getPrototypeOf(inject)));
			for (const name of Object.keys(inject)) result[name] = inject[name] ?? null;
		} else for (const name of Object.keys(inject)) result[name] = inject[name] ?? null;
		return result;
	}
	_Inject.resolve = resolve;
})(Inject || (Inject = {}));
/**
* Plugin registry installed as `ctx.registry` and mixed into every context.
*
* It normalizes plugin shapes, tracks plugin runtimes, starts fibers, and
* exposes map-like inspection over active plugin callbacks.
*/
var RegistryService = class {
	ctx;
	_counter = 0;
	_internal = /* @__PURE__ */ new Map();
	constructor(ctx) {
		this.ctx = ctx;
		defineProperty(this, symbols.tracker, {
			property: "ctx",
			noShadow: true
		});
	}
	/** Allocate the next fiber uid (increments on every read). */
	get counter() {
		return ++this._counter;
	}
	/** Number of registered plugin runtimes. */
	get size() {
		return this._internal.size;
	}
	/**
	* Resolve a supported plugin shape to its executable callback.
	*
	* @param plugin — a function, class, or `{ apply }` object plugin.
	* @returns the callback identifying the plugin, or `undefined` if invalid.
	*/
	resolve(plugin) {
		try {
			if (typeof plugin === "function") return plugin;
			if (isApplicable(plugin)) return plugin.apply;
		} catch {}
	}
	/**
	* Look up the runtime record for a plugin.
	*
	* @param plugin — any supported plugin shape.
	* @returns the runtime, or `undefined` when the plugin is not registered.
	*/
	get(plugin) {
		const key = this.resolve(plugin);
		return key && this._internal.get(key);
	}
	/**
	* Check whether a plugin has a registered runtime.
	*
	* @param plugin — any supported plugin shape.
	* @returns `true` when at least one fiber of the plugin exists.
	*/
	has(plugin) {
		const key = this.resolve(plugin);
		return !!key && this._internal.has(key);
	}
	/**
	* Dispose every running fiber for a plugin and remove its runtime record.
	*
	* @param plugin — any supported plugin shape.
	* @returns the removed runtime, or `undefined` when none was registered.
	*/
	delete(plugin) {
		const key = this.resolve(plugin);
		const runtime = key && this._internal.get(key);
		if (!runtime) return;
		this._internal.delete(key);
		for (const fiber of runtime.fibers) fiber.dispose();
		return runtime;
	}
	/** Iterate the registered plugin callbacks. */
	keys() {
		return this._internal.keys();
	}
	/** Iterate the registered plugin runtimes. */
	values() {
		return this._internal.values();
	}
	/** Iterate `[callback, runtime]` pairs. */
	entries() {
		return this._internal.entries();
	}
	/**
	* Visit every registered runtime.
	*
	* @param callback — receives each runtime and its identifying callback.
	*/
	forEach(callback) {
		return this._internal.forEach(callback);
	}
	/**
	* Start a callback once the requested dependencies are available.
	*
	* @param inject — required services, as an array or a name → config map.
	* @param callback — plugin body called with `(ctx, config)`.
	* @returns the fiber; awaiting it settles once loading finished.
	*/
	inject(inject, callback) {
		return this.plugin({
			inject,
			apply: callback,
			name: callback.name
		});
	}
	/**
	* Start a plugin in the current context and return its fiber.
	*
	* Creates (or reuses) the plugin's runtime record, then starts a new fiber
	* under the current context. Throws if `plugin` is not a supported shape or
	* if the current fiber is already disposed.
	*
	* @param plugin — a function, class, or `{ apply }` object plugin.
	* @param config — the plugin config, validated against its `Config` schema.
	* @param getOuterStack — captures the caller stack for effect diagnostics.
	* @returns the fiber; awaiting it settles once loading finished.
	*/
	plugin(plugin, config, getOuterStack = buildOuterStack()) {
		const callback = this.resolve(plugin);
		if (!callback) throw new Error("invalid plugin, expect function or object with an \"apply\" method, received " + typeof plugin);
		this.ctx.fiber.assertActive();
		let runtime = this._internal.get(callback);
		if (!runtime) {
			let name = plugin.name;
			if (name === "apply") name = void 0;
			runtime = {
				name,
				callback,
				fibers: new DisposableList(),
				Config: plugin.Config
			};
			this._internal.set(callback, runtime);
		}
		const fiber = new Fiber(this.ctx, config, Inject.resolve(plugin.inject), runtime, getOuterStack);
		const wrapped = Object.create(fiber);
		wrapped.then = (onFulfilled, onRejected) => {
			return fiber.await().then(onFulfilled, onRejected);
		};
		return wrapped;
	}
};
//#endregion
//#region ../../../Core/vendor/cordis/src/context.ts
/**
* Root and child dependency containers for Cordis plugins.
*
* A context is a proxy: normal property reads go through the service resolver,
* while `extend()`, `isolate()`, and `intercept()` create scoped child
* contexts without mutating their parent.
*/
var Context = class Context {
	/** Symbol key under which a disposer exposes its {@link EffectMeta} diagnostics tree. */
	static effect = symbols.effect;
	/** Symbol key for a context's listener filter, consulted on every event dispatch. */
	static filter = symbols.filter;
	/** Symbol key of the isolation map (see the `Context[symbols.isolate]` property). */
	static isolate = symbols.isolate;
	/** Symbol key of the intercept map (see the `Context[symbols.intercept]` property). */
	static intercept = symbols.intercept;
	/**
	* Returns true for Cordis context proxies and context prototypes.
	*
	* Works across realms and across multiple copies of cordis, because the
	* brand is keyed by a global symbol rather than by `instanceof`.
	*
	* @param value — the value to test.
	* @returns `true` if `value` is a Cordis context, narrowing its type.
	*/
	static is(value) {
		return !!value?.[Context.is];
	}
	static {
		Context.is[Symbol.toPrimitive] = () => Symbol.for("cordis.is");
		Context.prototype[Context.is] = true;
	}
	/** Create the root context and install the built-in services. */
	constructor() {
		this[symbols.isolate] = Object.create(null);
		this[symbols.intercept] = Object.create(null);
		const self = new Proxy(this, ReflectService.handler);
		this.root = self;
		this.baseUrl = void 0;
		this.fiber = new Fiber(self, {}, Object.create(null), null, () => []);
		this.reflect = new ReflectService(self);
		this.registry = new RegistryService(self);
		this.events = new EventsService(self);
		this.logger = new LoggerService(self);
		this.fiber._disposables.clear();
		return self;
	}
	[Symbol.for("nodejs.util.inspect.custom")]() {
		return `Context <${this.fiber.name}>`;
	}
	/**
	* Create a child context with extra metadata on top of the current scope.
	*
	* The child prototypally inherits every property of this context; own
	* properties of `meta` shadow the inherited ones. The parent is not mutated.
	*
	* @param meta — own properties (including symbol keys) to define on the child.
	* @returns a child context inheriting from this one.
	*/
	extend(meta = {}) {
		const shadow = Reflect.getOwnPropertyDescriptor(this, symbols.shadow)?.value;
		const self = Object.create(getTraceable(this, this));
		for (const prop of Reflect.ownKeys(meta)) Object.defineProperty(self, prop, Reflect.getOwnPropertyDescriptor(meta, prop));
		if (!shadow) return self;
		return Object.assign(Object.create(self), { [symbols.shadow]: shadow });
	}
	/**
	* Create a child context with an independent service scope for `name`.
	*
	* Below the returned context, reads and writes of the service `name`
	* resolve against the new label instead of the parent's, so a different
	* implementation can be provided without affecting the parent scope.
	* Passing the same `label` to two `isolate()` calls joins their scopes.
	*
	* @param name — the service name to isolate.
	* @param label — scope label to join; defaults to a fresh unique symbol.
	* @returns a child context whose `name` service resolves in the new scope.
	*/
	isolate(name, label) {
		const shadow = Object.create(this[symbols.isolate]);
		shadow[name] = label ?? Symbol(name);
		return this.extend({ [symbols.isolate]: shadow });
	}
	intercept(name, config) {
		const intercept = Object.create(this[symbols.intercept]);
		intercept[name] = config;
		return this.extend({ [symbols.intercept]: intercept });
	}
};
//#endregion
//#region ../../../Core/vendor/cordis/src/service.ts
/**
* Base class for services that expose a named API on `ctx`.
*
* Subclasses call `super(ctx, name)` from their constructor. The service is
* registered immediately and is automatically removed with the owning fiber.
*/
var Service = class Service {
	ctx;
	/** Symbol key of an instance method run after construction (class plugins). */
	static init = symbols.init;
	/** Symbol key of the availability predicate passed to `ctx.provide()`. */
	static check = symbols.check;
	/** Symbol key of the phantom intercept-config type parameter. */
	static config = symbols.config;
	/** Symbol key of the call body making a service callable (e.g. `ctx.logger()`). */
	static invoke = symbols.invoke;
	/** Symbol key of the helper deriving an extended service instance. */
	static extend = symbols.extend;
	/** Symbol key of the tracker metadata used for context tracing. */
	static tracker = symbols.tracker;
	/** Symbol key of the intercept-config resolution helper below. */
	static resolveConfig = symbols.resolveConfig;
	/** The service name this instance is registered under. */
	name;
	/**
	* Register this instance as `name` in the current context.
	*
	* Calls `ctx.reflect.provide(name, this, this[Service.check])`, so the
	* service is unregistered automatically when the owning fiber unloads.
	* Services with a `[Service.invoke]` body return a callable instance.
	*
	* @param ctx — the context to register in (stored as `this.ctx`).
	* @param name — the service name; defaults to the static `provide` field.
	*/
	constructor(ctx, name) {
		this.ctx = ctx;
		name ??= this.constructor["provide"];
		let self = this;
		const tracker = {
			associate: name,
			property: "ctx"
		};
		if (self[symbols.invoke]) self = createCallable(name, joinPrototype(Object.getPrototypeOf(this), Function.prototype), tracker);
		self.ctx = ctx;
		self.name = name;
		defineProperty(self, symbols.tracker, tracker);
		self.ctx.reflect.provide(name, self, this[symbols.check]);
		return self;
	}
	[symbols.filter](ctx) {
		return ctx[symbols.isolate][this.name] === this.ctx[symbols.isolate][this.name];
	}
	[symbols.extend](props) {
		let self;
		if (this[Service.invoke]) self = createCallable(this.name, this, this[symbols.tracker]);
		else self = Object.create(this);
		return Object.assign(self, props);
	}
	/**
	* Merge intercept config from ancestors with optional base and head values.
	*
	* Entries added closer to the root apply first; `base` is prepended and
	* `head` appended. Uses `Config.merge` when the service declares one,
	* otherwise a shallow `Object.assign`.
	*
	* @param base — lowest-precedence config merged before all intercepts.
	* @param head — highest-precedence config merged after all intercepts.
	* @returns the merged config.
	*/
	[symbols.resolveConfig](base, head) {
		let intercept = this.ctx[Context.intercept];
		const configs = [];
		while (this.name in intercept) {
			if (Object.hasOwn(intercept, this.name)) configs.unshift(intercept[this.name]);
			intercept = Object.getPrototypeOf(intercept);
		}
		if (base) configs.unshift(base);
		if (head) configs.push(head);
		if (this["Config"]?.merge) return this["Config"].merge(...configs);
		else return Object.assign({}, ...configs);
	}
	static [Symbol.hasInstance](instance) {
		if (!instance) return false;
		let constructor = instance.constructor;
		while (constructor) {
			constructor = constructor.prototype?.constructor;
			if (constructor === this) return true;
			constructor &&= Object.getPrototypeOf(constructor);
		}
		return false;
	}
};
//#endregion
//#region ../../core/scope/src/store.ts
/**
* Insertion-ordered named entries with caller-owned duplicate diagnostics.
*
* Values are borrowed. Iterators are live within one nonempty table
* generation; draining the table detaches them from later insertions. Each
* successful insertion returns an idempotent undo for that exact entry.
*/
var NamedEntries = class {
	duplicateError;
	data = /* @__PURE__ */ new Map();
	constructor(duplicateError) {
		this.duplicateError = duplicateError;
	}
	/**
	* Insert one unique name.
	* @param name - name unique within this table.
	* @param value - borrowed value to retain.
	* @returns an idempotent undo that removes only this insertion.
	*/
	insert(name, value) {
		const data = this.data;
		if (data.has(name)) throw this.duplicateError(name);
		data.set(name, value);
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			data.delete(name);
			if (data.size === 0 && this.data === data) this.data = /* @__PURE__ */ new Map();
		};
	}
	/**
	* Read one named value.
	* @param name - name to resolve.
	* @returns the retained value, or `undefined` when absent.
	*/
	get(name) {
		return this.data.get(name);
	}
	/**
	* Test one name for membership.
	* @param name - name to test.
	* @returns whether the table contains that name.
	*/
	has(name) {
		return this.data.has(name);
	}
	/**
	* Iterate live names in insertion order.
	* @returns the native live key iterator.
	*/
	keys() {
		return this.data.keys();
	}
	/**
	* Iterate live entries in insertion order.
	* @returns the native live entry iterator.
	*/
	entries() {
		return this.data.entries();
	}
	/**
	* Iterate live values in insertion order.
	* @returns the native live value iterator.
	*/
	values() {
		return this.data.values();
	}
	/**
	* Test whether this table has no entries.
	* @returns whether the table is empty.
	*/
	isEmpty() {
		return this.data.size === 0;
	}
};
/**
* Insertion-ordered anonymous entries with independent registration identity.
*
* Equal values remain separate registrations. Values are borrowed, and
* iterators are live within one nonempty table generation; draining the table
* detaches them from later appends.
*/
var AnonymousEntries = class {
	data = /* @__PURE__ */ new Map();
	/**
	* Append one independently owned value.
	* @param value - borrowed value to retain.
	* @returns an idempotent undo for this exact append.
	*/
	append(value) {
		const data = this.data;
		const key = Symbol();
		data.set(key, value);
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			data.delete(key);
			if (data.size === 0 && this.data === data) this.data = /* @__PURE__ */ new Map();
		};
	}
	/**
	* Iterate live values in insertion order.
	* @returns the native live value iterator.
	*/
	values() {
		return this.data.values();
	}
	/**
	* Test whether this table has no entries.
	* @returns whether the table is empty.
	*/
	isEmpty() {
		return this.data.size === 0;
	}
};
/**
* Own the global and exact-scope layers for one registry.
*
* Reads never create scoped layers. Registrations derive both visibility and
* effect ownership from the supplied Cordis context, collect undo before
* notification, and reclaim only a completely empty aggregate layer.
*/
var ScopedLayers = class {
	createLayer;
	onChange;
	/** The eagerly constructed context-global layer. */
	global;
	scoped = /* @__PURE__ */ new Map();
	constructor(createLayer, onChange) {
		this.createLayer = createLayer;
		this.onChange = onChange;
		this.global = createLayer(void 0);
	}
	/**
	* Read an existing exact-scope overlay. Deliberately chain-blind: callers
	* addressing one scope's OWN contributions (its restrictions, its guards)
	* must not silently pick up an ancestor's — use {@link chainLayers} where
	* inheritance is the point.
	* @param scope - exact scope key; `undefined` denotes no overlay.
	* @returns the existing scoped layer, or `undefined` without creating one.
	*/
	peek(scope) {
		if (scope === void 0) return void 0;
		return this.scoped.get(scope);
	}
	/**
	* Existing overlays along the scope's parent chain ({@link scopeChainOf}),
	* farthest ancestor first and the exact scope last, so a caller layering
	* them in order gives the nearest scope the final word.
	* @param scope - viewing scope, or `undefined` for no overlays.
	* @returns the existing layers, nearest last; absent overlays are skipped.
	*/
	chainLayers(scope) {
		const layers = [];
		for (const key of scopeChainOf(scope).reverse()) {
			const layer = this.scoped.get(key);
			if (layer !== void 0) layers.push(layer);
		}
		return layers;
	}
	/**
	* Materialize global named entries followed by scope-chain shadows,
	* farthest ancestor first, so the nearest scope's entry wins a name.
	* @param scope - viewing scope, or `undefined` for the global view.
	* @param pick - select the named table from a layer.
	* @returns an insertion-ordered effective map.
	*/
	merge(scope, pick) {
		const merged = new Map(pick(this.global).entries());
		for (const layer of this.chainLayers(scope)) for (const [name, value] of pick(layer).entries()) merged.set(name, value);
		return merged;
	}
	/**
	* Attach one synchronous layer mutation to its registration context.
	* @param ctx - context that determines both scope visibility and effect ownership.
	* @param action - atomic mutation returning its synchronous undo.
	* @param options - Cordis effect label and optional change notification.
	* @returns the exact disposer returned by `ctx.effect()`.
	*/
	effect(ctx, action, options) {
		const scope = scopeOf(ctx);
		const notify = options.notify ?? true;
		return ctx.effect(function* () {
			let layer;
			let created = false;
			if (scope === void 0) layer = this.global;
			else {
				const existing = this.scoped.get(scope);
				if (existing === void 0) {
					layer = this.createLayer(scope);
					this.scoped.set(scope, layer);
					created = true;
				} else layer = existing;
			}
			let undo;
			try {
				undo = action(layer);
			} catch (error) {
				if (scope !== void 0 && created && layer.isEmpty()) this.scoped.delete(scope);
				throw error;
			}
			yield () => {
				undo();
				if (scope !== void 0 && layer.isEmpty()) this.scoped.delete(scope);
				if (notify) this.onChange();
			};
			if (notify) this.onChange();
		}.bind(this), options.label);
	}
};
//#endregion
//#region ../../core/scope/src/index.ts
/** Context tag written by {@link createScope}. */
const kScope = Symbol("dsh.scope");
/** The key associated with each carrier. Presence distinguishes an unkeyed carrier from a non-carrier. */
const carrierKeys = /* @__PURE__ */ new WeakMap();
/**
* The enclosing scope of each key. One relation powers both directions of
* scope nesting: registration views inherit DOWN the chain (a child scope
* sees its ancestors' layers — {@link ScopedLayers}), and event admission
* extends UP it (a listener tagged with an ancestor receives events dispatched
* to a descendant key — {@link scopeTarget}).
*/
const scopeParents = /* @__PURE__ */ new WeakMap();
/**
* The chain from a key to its root ancestor.
* @param key - the starting key, or `undefined` for the empty chain.
* @returns keys nearest-first: `[key, parent, grandparent, …]`.
*/
function scopeChainOf(key) {
	const chain = [];
	for (let cursor = key; cursor !== void 0; cursor = scopeParents.get(cursor)) chain.push(cursor);
	return chain;
}
/**
* Read the nearest scope tag inherited by a context.
* @param ctx - context to inspect.
* @returns its scope key, or `undefined` for an unscoped context.
*/
function scopeOf(ctx) {
	return ctx[kScope];
}
/**
* Build an opaque receiver that preserves the base filter, admits untagged
* listeners globally, and admits tagged listeners for a matching key or any
* of its ancestors ({@link bindScopeParent}): a listener owned by an enclosing
* scope receives every descendant scope's events, which is what lets one
* standing composition observe each of the agents composed under it. A tag
* BELOW the dispatch key stays excluded — events flow up the chain, never
* down.
* @param base - subject or service whose existing Cordis filter is preserved.
* @param key - routed scope identity, or `undefined` for an unscoped subject.
* @returns a carrier whose subject remains available only through event arguments.
*/
function scopeTarget(base, key) {
	const baseFilter = base[Context.filter];
	const carrier = { [Context.filter](ctx) {
		if (baseFilter !== void 0 && !baseFilter.call(base, ctx)) return false;
		const tag = scopeOf(ctx);
		if (tag === void 0) return true;
		for (let cursor = key; cursor !== void 0; cursor = scopeParents.get(cursor)) if (cursor === tag) return true;
		return false;
	} };
	carrierKeys.set(carrier, key);
	return carrier;
}
//#endregion
//#region ../../../Core/typert/protocol/src/remote-error.ts
/**
* One Remote call failure: a real Error carrying its stable code and typed
* details. Owners throw it at the failure point; the Host Gateway encodes it
* onto the wire unchanged; the Client face rebuilds an instance for the
* `RemoteResult` error branch, so `throw result.error` keeps throw semantics.
* Discrimination is always by `code`, never by instanceof.
*/
var RemoteError = class extends Error {
	code;
	details;
	/** Structural marker: cross-realm/bundle identification never uses instanceof. */
	isDSHRemoteError = true;
	/**
	* @param code - stable failure code declared in {@link RemoteErrorDetailsMap}.
	* @param message - human diagnostic carried across the wire.
	* @param details - structured payload typed by the code.
	* @param options - standard Error options (`cause` survives in-process only).
	*/
	constructor(code, message, details, options) {
		super(message, options);
		this.code = code;
		this.details = details;
		this.name = "RemoteError";
	}
};
//#endregion
//#region ../../../Core/typert/protocol/src/index.ts
/**
* Remote decorators and explicit Gateway bindings backed by versioned
* descriptors carried on decorated class prototypes. Strict reflection
* remains a Typert compiler responsibility.
* @module @deepseek-ai/dsh-typert-protocol
*/
const TYPERT_REMOTE_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/;
/**
* Test one generated Remote name against the Connection endpoint grammar.
* @param value - namespace, method, lookup, or Context segment.
* @returns whether the value can cross the shared RPC carrier unchanged.
*/
function isTypertRemoteSegment(value) {
	return value !== "." && value !== ".." && TYPERT_REMOTE_SEGMENT_PATTERN.test(value);
}
const REMOTE_METHOD_DESCRIPTOR = "@deepseek-ai/dsh-typert-protocol/remote-methods";
/**
* Bind one visible Service field to a Cordis key and Remote namespace.
* @param service - owning Service instance, normally `this`.
* @param serviceKey - exact Cordis service key.
* @param options - optional distinct wire namespace.
* @returns a frozen, inspectable binding with no compiler-injected metadata.
*/
function bindTypertRemote(service, serviceKey, options = {}) {
	validateName("service key", serviceKey);
	const namespace = options.namespace ?? serviceKey;
	validateName("namespace", namespace);
	return Object.freeze({
		service,
		serviceKey,
		namespace
	});
}
/** Cordis Service base that exposes its registered name through Typert Gateway. */
var TypertRemoteService = class extends Service {
	/** Visible binding consumed by the Gateway's source-mode discovery. */
	typertRemote;
	/**
	* Register the Service and bind the same key to Typert Gateway.
	* @param ctx - owning Cordis Context.
	* @param serviceKey - exact Cordis service key and default wire namespace.
	* @param options - optional distinct wire namespace.
	*/
	constructor(ctx, serviceKey, options = {}) {
		super(ctx, serviceKey);
		this.typertRemote = bindTypertRemote(this, this.name, options);
	}
};
function Remote(methodExportOrOptions, context) {
	if (typeof methodExportOrOptions === "string") {
		validateName("Remote export name", methodExportOrOptions);
		return remoteDecorator({ kind: "direct" }, void 0, methodExportOrOptions);
	}
	if (typeof methodExportOrOptions === "object") {
		if (remoteOptionMode(methodExportOrOptions) !== "stream" || Reflect.ownKeys(methodExportOrOptions).length !== 1) throw new TypeError("typert-protocol: Remote options must contain exactly mode: \"stream\"");
		return remoteDecorator({ kind: "direct" }, "stream");
	}
	if (context === void 0) throw new TypeError("typert-protocol: Remote decorator context is missing");
	addMarkerInitializer(context, { kind: "direct" });
}
function remoteOptionMode(options) {
	return Reflect.get(options, "mode");
}
function remoteDecorator(invocation, mode, exportName) {
	return function(_method, context) {
		addMarkerInitializer(context, invocation, mode, exportName);
	};
}
function readRemoteMethodDescriptor(prototype) {
	const property = Object.getOwnPropertyDescriptor(prototype, REMOTE_METHOD_DESCRIPTOR);
	if (property === void 0) return void 0;
	const descriptor = property.value;
	if (descriptor === null || typeof descriptor !== "object") throw new TypeError("typert-protocol: Remote method descriptor must be an object");
	const version = Reflect.get(descriptor, "version");
	if (version !== 1) throw new TypeError(`typert-protocol: unsupported Remote method descriptor version ${String(version)}`);
	const methods = Reflect.get(descriptor, "methods");
	if (!Array.isArray(methods)) throw new TypeError("typert-protocol: Remote method descriptor methods must be an array");
	return descriptor;
}
function addMarkerInitializer(context, invocation, mode, exportName) {
	if (context.private || context.static || typeof context.name !== "string") throw new TypeError("typert-protocol: Remote decorators require a public instance method with a string name");
	const method = context.name;
	context.addInitializer(function() {
		const prototype = Object.getPrototypeOf(this);
		if (prototype === null) throw new TypeError(`typert-protocol: cannot mark Remote method "${method}" on an object without a prototype`);
		mark(prototype, method, invocation, mode, exportName);
	});
}
function mark(prototype, method, invocation, mode, exportName) {
	const descriptor = readRemoteMethodDescriptor(prototype);
	const marker = Object.freeze({
		method,
		...exportName === void 0 || exportName === method ? {} : { exportName },
		...mode === void 0 ? {} : { mode },
		invocation: Object.freeze(invocation)
	});
	const current = descriptor?.methods.find((candidate) => candidate.method === method);
	if (current !== void 0) {
		if (current.exportName === marker.exportName && current.mode === marker.mode && sameInvocation(current.invocation, invocation)) return;
		throw new Error(`typert-protocol: Remote method "${method}" has conflicting invocation markers`);
	}
	Object.defineProperty(prototype, REMOTE_METHOD_DESCRIPTOR, {
		configurable: true,
		value: Object.freeze({
			version: 1,
			methods: Object.freeze([...descriptor?.methods ?? [], marker])
		})
	});
}
function sameInvocation(left, right) {
	if (left.kind === "direct") return right.kind === "direct";
	if (right.kind === "direct") return false;
	return left.context === right.context;
}
function validateName(subject, value) {
	if (!isTypertRemoteSegment(value)) throw new TypeError(`typert-protocol: ${subject} must contain only RPC endpoint segment characters`);
}
//#endregion
//#region ../../../Core/util/values/src/index.ts
/**
* Mark an unreachable closed-union branch.
* @param value - impossible value; an unhandled typed variant fails at the call site.
* @param context - optional switch-site label included in the failure message.
* @returns never; a runtime value that escaped its type always throws.
*/
function assertNever(value, context) {
	const rendered = JSON.stringify(value) ?? String(value);
	throw new Error(`unreachable variant${context ? ` in ${context}` : ""}: ${rendered}`);
}
/** Whether a realm-owned intrinsic prototype is backed by its native constructor. */
function hasIntrinsicConstructor$1(prototype, name) {
	const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
	if (typeof constructor !== "function") return false;
	try {
		return constructor.name === name && constructor.prototype === prototype && Function.prototype.toString.call(constructor) === `function ${name}() { [native code] }`;
	} catch {
		return false;
	}
}
/** Whether a candidate is one realm's intrinsic `Object.prototype`. */
function isIntrinsicObjectPrototype$1(value) {
	return Object.getPrototypeOf(value) === null && hasIntrinsicConstructor$1(value, "Object");
}
/** Whether an array uses one realm's intrinsic `Array.prototype`, not a subclass or forged prototype. */
function hasPlainArrayPrototype$1(value) {
	const prototype = Object.getPrototypeOf(value);
	if (!Array.isArray(prototype) || !hasIntrinsicConstructor$1(prototype, "Array")) return false;
	const objectPrototype = Object.getPrototypeOf(prototype);
	return typeof objectPrototype === "object" && objectPrototype !== null && isIntrinsicObjectPrototype$1(objectPrototype);
}
/** Whether an object is a plain or null-prototype record from any JavaScript realm. */
function hasPlainObjectPrototype(value) {
	const prototype = Object.getPrototypeOf(value);
	return prototype === null || typeof prototype === "object" && isIntrinsicObjectPrototype$1(prototype);
}
/** Return every JSON-visible object key, or reject own data JSON would discard. */
function enumerableStringKeys(value) {
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== "string" || !Object.prototype.propertyIsEnumerable.call(value, key))) return void 0;
	return keys;
}
/** Validate lossless JSON iteratively, optionally materializing a detached snapshot. */
function walkJsonValue(value, detach) {
	const ancestors = /* @__PURE__ */ new Set();
	let root;
	const assign = (destination, item) => {
		if (destination === void 0) return;
		if (destination.kind === "root") root = item;
		else if (destination.kind === "array") destination.target[destination.index] = item;
		else Object.defineProperty(destination.target, destination.key, {
			value: item,
			enumerable: true,
			configurable: true,
			writable: true
		});
	};
	const tasks = [{
		kind: "visit",
		value,
		...detach ? { destination: { kind: "root" } } : {}
	}];
	for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
		if (task.kind === "leave") {
			ancestors.delete(task.source);
			continue;
		}
		if (task.kind === "array-item") {
			if (!Object.prototype.hasOwnProperty.call(task.source, task.index)) return void 0;
			tasks.push({
				kind: "visit",
				value: task.source[task.index],
				...task.target === void 0 ? {} : { destination: {
					kind: "array",
					target: task.target,
					index: task.index
				} }
			});
			continue;
		}
		if (task.kind === "object-property") {
			tasks.push({
				kind: "visit",
				value: task.source[task.key],
				...task.target === void 0 ? {} : { destination: {
					kind: "object",
					target: task.target,
					key: task.key
				} }
			});
			continue;
		}
		const current = task.value;
		if (current === null) {
			assign(task.destination, null);
			continue;
		}
		if (typeof current === "boolean" || typeof current === "string") {
			assign(task.destination, current);
			continue;
		}
		if (typeof current === "number") {
			if (!Number.isFinite(current) || Object.is(current, -0)) return void 0;
			assign(task.destination, current);
			continue;
		}
		if (typeof current !== "object") return void 0;
		if (ancestors.has(current)) return void 0;
		if (Array.isArray(current)) {
			if (!hasPlainArrayPrototype$1(current)) return void 0;
			const length = current.length;
			if (Reflect.ownKeys(current).length !== length + 1) return void 0;
			const target = detach ? [] : void 0;
			if (target !== void 0) assign(task.destination, target);
			ancestors.add(current);
			tasks.push({
				kind: "leave",
				source: current
			});
			for (let index = length - 1; index >= 0; index--) tasks.push({
				kind: "array-item",
				source: current,
				index,
				...target === void 0 ? {} : { target }
			});
			continue;
		}
		if (!hasPlainObjectPrototype(current)) return void 0;
		const keys = enumerableStringKeys(current);
		if (keys === void 0) return void 0;
		const target = detach ? {} : void 0;
		if (target !== void 0) assign(task.destination, target);
		ancestors.add(current);
		tasks.push({
			kind: "leave",
			source: current
		});
		for (let index = keys.length - 1; index >= 0; index--) {
			const key = keys[index];
			/* v8 ignore next -- the loop is bounded by the captured key count. */
			if (key === void 0) return void 0;
			tasks.push({
				kind: "object-property",
				source: current,
				key,
				...target === void 0 ? {} : { target }
			});
		}
	}
	return detach ? root : true;
}
/**
* Validate and detach lossless JSON in one read per property.
* @param value - candidate value to validate and detach.
* @returns the detached snapshot, or `undefined` when the value is not losslessly JSON-serializable.
*/
function snapshotJsonValue(value) {
	return walkJsonValue(value, true);
}
/**
* Test the same lossless JSON rules as {@link snapshotJsonValue} without detaching the value.
* @param value - candidate value to test.
* @returns whether the value survives a JSON round trip without loss.
*/
function isJsonValue(value) {
	return walkJsonValue(value, false) === true;
}
/**
* Deep-freeze an object graph in place while leaving live AbortSignal objects mutable.
* @param value - value to freeze.
* @returns the same value after every reachable enumerable child is frozen.
*/
function deepFreeze(value) {
	const seen = /* @__PURE__ */ new WeakSet();
	const pending = [{
		kind: "visit",
		node: value
	}];
	while (pending.length > 0) {
		const task = pending.pop();
		/* v8 ignore next -- the loop condition guarantees one pending task. */
		if (task === void 0) continue;
		if (task.kind === "property") {
			pending.push({
				kind: "visit",
				node: task.source[task.key]
			});
			continue;
		}
		const node = task.node;
		if (node === null || typeof node !== "object") continue;
		if (node instanceof AbortSignal) continue;
		if (seen.has(node)) continue;
		seen.add(node);
		Object.freeze(node);
		const keys = Object.keys(node);
		for (let index = keys.length - 1; index >= 0; index--) {
			const key = keys[index];
			/* v8 ignore next -- the loop is bounded by the captured key count. */
			if (key === void 0) continue;
			pending.push({
				kind: "property",
				source: node,
				key
			});
		}
	}
	return value;
}
//#endregion
//#region ../../../Core/util/crypto/src/index.ts
/**
* Random v4 UUID, minted from `crypto.getRandomValues`.
* @returns the UUID string.
*/
function randomUUID$1() {
	const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
	const hex = Array.from(bytes, (byte, index) => {
		return (index === 6 ? byte & 15 | 64 : index === 8 ? byte & 63 | 128 : byte).toString(16).padStart(2, "0");
	}).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
//#endregion
//#region ../../../Core/util/brand/src/index.ts
/**
* Apply a compile-time string brand without changing the value.
* @param value - string admitted by the domain that owns the target brand.
* @returns the same string with the requested compile-time brand.
*/
function brandString(value) {
	return value;
}
/**
* Apply a compile-time number brand without changing the value.
* @param value - number admitted by the domain that owns the target brand.
* @returns the same number with the requested compile-time brand.
*/
function brandNumber(value) {
	return value;
}
/**
* Bound one `notice` summary to {@link CONTEXT_SUMMARY_MAX_CHARS}.
* @param summary - the producer's one-line account, of any length.
* @returns the account, ellipsized when it exceeds the bound.
*/
function boundContextSummary(summary) {
	return summary.length <= 120 ? summary : `${summary.slice(0, 119)}…`;
}
/**
* Detach and deep-freeze a message whose identity already exists.
* @param message - complete message, including its stable identity.
* @returns an immutable snapshot that preserves the identity.
*/
function freezeMessage(message) {
	return deepFreeze(structuredClone(message));
}
/**
* Create one identified message and freeze it before publication.
* @param input - complete role, content, and source for a new message.
* @returns an immutable message with a fresh stable identity.
*/
function createMessage(input) {
	return freezeMessage({
		...input,
		id: brandString(randomUUID$1())
	});
}
/**
* Create one identified user-role message and freeze it before publication.
* @param input - complete content and source for a new user message.
* @returns an immutable user message with a fresh stable identity.
*/
function createUserMessage(input) {
	return createMessage({
		...input,
		role: "user"
	});
}
//#endregion
//#region ../../../Core/util/timeout/src/index.ts
/** Largest delay Node schedules without clamping it to one millisecond. */
const MAX_TIMER_DELAY_MS = 2147483647;
//#endregion
//#region ../../../Core/util/errors/src/index.ts
/** Shared coded errors and diagnostic cause rendering, independent of runtime services. */
/**
* Base class for all harness errors. Carries a `code` (stable, programmatic —
* e.g. `NO_ADAPTER`, `INVALID_ARGS`, `INVARIANT`) distinct from the
* human-readable `message`, and supports `cause` chaining via the standard
* `ErrorOptions`. `name` defaults to the subclass constructor name.
*/
var HarnessError = class extends Error {
	/** Stable machine-routable failure class (e.g. `RATE_LIMIT`); route on this, never by parsing `message`. */
	code;
	constructor(message, code, options) {
		super(message, options);
		this.code = code;
		this.name = new.target.name;
	}
};
/**
* Render a thrown value with its full `cause` chain and AggregateError
* members, so transport wrappers like undici's `TypeError: fetch failed`
* surface the underlying failure instead of masking it. Plain structured
* failures render their own data-backed `message`. Diagnostic-surface
* rendering only (messages, notices, logs) — never parse the result; route on
* {@link HarnessError.code}.
* @param value - the caught value (`unknown` in catch clauses).
* @returns the outermost message first, each cause appended with `: ` (skipped
* when it repeats the wrapper message verbatim), and AggregateError members
* bracketed and `; `-joined.
*/
function errorChain(value) {
	const path = /* @__PURE__ */ new Set();
	const render = (current) => {
		if (path.has(current)) return "<circular cause>";
		path.add(current);
		try {
			if (!(current instanceof Error)) {
				if (typeof current === "object" && current !== null) {
					const descriptor = Object.getOwnPropertyDescriptor(current, "message");
					if (descriptor !== void 0 && "value" in descriptor && typeof descriptor.value === "string") return descriptor.value;
				}
				return String(current);
			}
			const message = current.message === "" ? current.name : current.message;
			const members = current instanceof AggregateError && current.errors.length > 0 ? ` [${current.errors.map(render).join("; ")}]` : "";
			const causeText = current.cause === void 0 || current.cause === null ? "" : render(current.cause);
			return `${message}${members}${causeText === "" || causeText === message ? "" : `: ${causeText}`}`;
		} catch {
			return "<unrenderable value>";
		} finally {
			path.delete(current);
		}
	};
	return render(value);
}
//#endregion
//#region ../../llm/llm/src/error.ts
/**
* Canonical provider-neutral code for a response that completed normally but
* carried no content blocks at all. Providers occasionally emit a degenerate
* completion (a terminal stop with zero output); adapters classify it as this
* failure instead of yielding an empty assistant message, because an empty
* message silently ends the turn with nothing for the user or the loop to act
* on. The attempt produced nothing durable, so retry policy treats it as safe
* to repeat.
*/
const EMPTY_RESPONSE_CODE = "EMPTY_RESPONSE";
new RegExp(String.raw`(?:^|[^a-z0-9])context[\s_-](?:length|window)[\s_-]` + String.raw`(?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]exceeded)(?:$|[^a-z0-9])`, "i");
new RegExp(String.raw`\b(?:request|prompt|input|messages?)\s+(?:is\s+|are\s+)?` + String.raw`too\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?` + String.raw`(?:model(?:'s)?\s+)?context(?:\s+window)?\b`, "i");
new RegExp(String.raw`\b(?:input|prompt|request|messages?)\b.{0,40}` + String.raw`\b(?:exceed(?:s|ed)?|overflows?|is\s+larger\s+than)\b.{0,40}` + String.raw`\b(?:the\s+)?(?:model(?:'s)?\s+)?context(?:\s+(?:length|window))?\b`, "i");
/**
* Typed error for LLM-related failures. Extends {@link HarnessError}, so the
* `code` string (e.g. `AUTH`, `RATE_LIMIT`, `NO_ADAPTER`) is shared taxonomy.
*/
var LlmError = class extends HarnessError {
	/** Serializable facts retained beside this live Error. */
	failure;
	/**
	* @param message - non-empty human-readable failure summary.
	* @param code - non-empty stable provider-neutral machine code.
	* @param options - optional cause and validated serializable provider facts.
	*/
	constructor(message, code, options) {
		if (typeof message !== "string" || message.length === 0) throw new Error("LlmError message must be a non-empty string");
		if (typeof code !== "string" || code.length === 0) throw new Error("LlmError code must be a non-empty string");
		if (options?.status !== void 0 && (!Number.isInteger(options.status) || options.status < 100 || options.status > 599)) throw new Error("LlmError status must be an integer from 100 through 599");
		if (options?.providerRetryAfterMs !== void 0 && (!Number.isFinite(options.providerRetryAfterMs) || options.providerRetryAfterMs <= 0)) throw new Error("LlmError providerRetryAfterMs must be a positive finite number");
		if (options?.requestId !== void 0 && (typeof options.requestId !== "string" || options.requestId.length === 0)) throw new Error("LlmError requestId must be a non-empty string");
		super(message, code, options);
		this.name = "LlmError";
		this.failure = Object.freeze({
			message,
			code,
			...options?.status === void 0 ? {} : { status: options.status },
			...options?.providerRetryAfterMs === void 0 ? {} : { providerRetryAfterMs: options.providerRetryAfterMs },
			...options?.requestId === void 0 ? {} : { requestId: options.requestId }
		});
	}
};
//#endregion
//#region ../../llm/llm/src/retry-policy.ts
/**
* Provider-owned request-retry policy configuration and resolution.
*
* Adapters expose one resolved policy per registered provider route; the
* optional dsh-llm-retry plugin executes it on the agent's failed-step extension point.
*
* @module @deepseek-ai/dsh-llm/retry-policy
*/
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 1e4;
const DEFAULT_JITTER_RATIO = .1;
const DEFAULT_RETRYABLE_CODES = Object.freeze([
	EMPTY_RESPONSE_CODE,
	"RATE_LIMIT",
	"SERVER",
	"TIMEOUT",
	"TRANSPORT"
]);
const backoffSchema = Schema.object({
	initialDelayMs: Schema.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_INITIAL_DELAY_MS),
	maxDelayMs: Schema.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_MAX_DELAY_MS),
	jitterRatio: Schema.number().min(0).max(1).default(DEFAULT_JITTER_RATIO)
});
const normalPolicySchema = Schema.object({
	mode: Schema.const("normal").required(),
	maxRetries: Schema.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_RETRIES),
	retryableCodes: Schema.array(Schema.string()).default([...DEFAULT_RETRYABLE_CODES]),
	backoff: backoffSchema
});
const alwaysPolicySchema = Schema.object({
	mode: Schema.const("always").required(),
	backoff: backoffSchema
});
Schema.union([normalPolicySchema, alwaysPolicySchema]);
const NORMAL_POLICY_KEYS = new Set([
	"mode",
	"maxRetries",
	"retryableCodes",
	"backoff"
]);
const ALWAYS_POLICY_KEYS = new Set([
	"mode",
	"maxRetries",
	"retryableCodes",
	"backoff"
]);
const BACKOFF_KEYS = new Set([
	"initialDelayMs",
	"maxDelayMs",
	"jitterRatio"
]);
function validateKeys(value, allowed, path) {
	for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${path}: unknown key "${key}"`);
}
function resolveBackoff(config, path) {
	if (config !== void 0) validateKeys(config, BACKOFF_KEYS, path);
	const initialDelayMs = config?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
	const maxDelayMs = config?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
	const jitterRatio = config?.jitterRatio ?? DEFAULT_JITTER_RATIO;
	if (!Number.isFinite(initialDelayMs) || initialDelayMs <= 0 || initialDelayMs > 2147483647) throw new Error(`${path}.initialDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
	if (!Number.isFinite(maxDelayMs) || maxDelayMs <= 0 || maxDelayMs > 2147483647) throw new Error(`${path}.maxDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
	if (initialDelayMs > maxDelayMs) throw new Error(`${path}.initialDelayMs must be less than or equal to maxDelayMs`);
	if (!Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) throw new Error(`${path}.jitterRatio must be between 0 and 1`);
	return Object.freeze({
		initialDelayMs,
		maxDelayMs,
		jitterRatio
	});
}
/**
* Validate, default, and detach one provider-owned retry policy.
* @param config - optional provider configuration; omission selects normal defaults.
* @param path - diagnostic path naming the provider config that owns the value.
* @returns an immutable policy safe to capture in provider registration state.
*/
function resolveRetryPolicy(config, path) {
	if (config === void 0) return Object.freeze({
		mode: "normal",
		maxRetries: DEFAULT_MAX_RETRIES,
		retryableCodes: DEFAULT_RETRYABLE_CODES,
		...resolveBackoff(void 0, `${path}.backoff`)
	});
	switch (config.mode) {
		case "normal": {
			validateKeys(config, NORMAL_POLICY_KEYS, path);
			const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
			const retryableCodes = config.retryableCodes ?? [...DEFAULT_RETRYABLE_CODES];
			if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) throw new Error(`${path}.maxRetries must be a non-negative safe integer`);
			if (retryableCodes.length === 0) throw new Error(`${path}.retryableCodes must not be empty`);
			if (retryableCodes.some((code) => typeof code !== "string" || code.length === 0)) throw new Error(`${path}.retryableCodes must contain only non-empty strings`);
			if (new Set(retryableCodes).size !== retryableCodes.length) throw new Error(`${path}.retryableCodes must not contain duplicates`);
			return Object.freeze({
				mode: "normal",
				maxRetries,
				retryableCodes: Object.freeze([...retryableCodes]),
				...resolveBackoff(config.backoff, `${path}.backoff`)
			});
		}
		case "always":
			validateKeys(config, ALWAYS_POLICY_KEYS, path);
			return Object.freeze({
				mode: "always",
				...resolveBackoff(config.backoff, `${path}.backoff`)
			});
		default: throw new Error(`${path}.mode must be "normal" or "always"`);
	}
}
//#endregion
//#region ../../llm/llm/src/call-config.ts
/**
* Field-wise equality over {@link LlmCallConfig} — the comparison a caller
* runs to decide whether a proposed configuration is a real change (worth a
* logged header snapshot) or the held one restated.
* @param a - one configuration.
* @param b - the other.
* @returns whether every field (including the `stop` list, element-wise) matches.
*/
function callConfigEquals(a, b) {
	if (a.provider !== b.provider || a.model !== b.model || a.reasoningEffort !== b.reasoningEffort || a.temperature !== b.temperature || a.maxTokens !== b.maxTokens) return false;
	if (a.stop === void 0 || b.stop === void 0) return a.stop === b.stop;
	return a.stop.length === b.stop.length && a.stop.every((s, i) => s === b.stop?.[i]);
}
//#endregion
//#region ../../llm/llm/src/adapter-failure.ts
/**
* Normalization for values thrown by a final LLM adapter boundary.
*
* @module @deepseek-ai/dsh-llm/adapter-failure
*/
/**
* Detach serializable provider facts from a value thrown by an adapter.
* @param value - arbitrary value thrown during adapter dispatch or iteration.
* @returns immutable provider-neutral facts suitable for a terminal finish chunk or recovery policy.
*/
function normalizeLlmFailure(value) {
	const error = value instanceof Error ? value : new HarnessError(thrownMessage(value), "UNKNOWN", { cause: value });
	const carried = ownFailureSnapshot(error);
	if (carried !== void 0 && carried.code === ownErrorCode(error)) return carried;
	return Object.freeze({
		message: errorMessage$2(error),
		code: harnessErrorCode(error)
	});
}
/** Render a non-Error throw without letting hostile coercion escape normalization. */
function thrownMessage(value) {
	try {
		const message = String(value);
		return message.length > 0 ? message : "LLM adapter failed";
	} catch (_hostileThrownValue) {
		return "LLM adapter failed";
	}
}
/** Read a foreign error's own data-backed `code` without invoking accessors. */
function ownErrorCode(error) {
	try {
		const descriptor = Object.getOwnPropertyDescriptor(error, "code");
		return descriptor !== void 0 && "value" in descriptor ? descriptor.value : void 0;
	} catch (_sdkPropertyTrap) {
		return;
	}
}
/** Snapshot an own data property without invoking an SDK-defined accessor. */
function ownFailureSnapshot(error) {
	try {
		const descriptor = Object.getOwnPropertyDescriptor(error, "failure");
		return descriptor !== void 0 && "value" in descriptor ? failureSnapshot(descriptor.value) : void 0;
	} catch (_sdkPropertyTrap) {
		return;
	}
}
/** Validate and detach an arbitrary serializable failure payload. */
function failureSnapshot(value) {
	if (typeof value !== "object" || value === null) return void 0;
	try {
		const candidate = value;
		const message = candidate.message;
		const code = candidate.code;
		const status = candidate.status;
		const providerRetryAfterMs = candidate.providerRetryAfterMs;
		const requestId = candidate.requestId;
		if (typeof message !== "string" || message.length === 0 || typeof code !== "string" || code.length === 0 || status !== void 0 && (!Number.isInteger(status) || status < 100 || status > 599) || providerRetryAfterMs !== void 0 && (!Number.isFinite(providerRetryAfterMs) || providerRetryAfterMs <= 0) || requestId !== void 0 && (typeof requestId !== "string" || requestId.length === 0)) return void 0;
		return Object.freeze({
			message,
			code,
			...status === void 0 ? {} : { status },
			...providerRetryAfterMs === void 0 ? {} : { providerRetryAfterMs },
			...requestId === void 0 ? {} : { requestId }
		});
	} catch (_sdkFailureGetter) {
		return;
	}
}
/** Read an SDK error message without letting an accessor replace the primary failure. */
function errorMessage$2(error) {
	try {
		const message = error.message;
		if (typeof message === "string" && message.length > 0) return message;
	} catch (_sdkMessageGetter) {}
	return "LLM adapter failed";
}
/** Trust only Harness-owned codes; third-party SDK codes are not our taxonomy. */
function harnessErrorCode(error) {
	return error instanceof HarnessError ? error.code : "UNKNOWN";
}
//#endregion
//#region ../../llm/llm/src/content.ts
function quoted(value) {
	return JSON.stringify(value);
}
/**
* Stable text shown to a model that cannot accept one durable image reference.
* @param ref - durable normalized attachment omitted from the request.
* @returns deterministic text-only placeholder.
*/
function textOnlyImageText(ref) {
	return `[image omitted because this model accepts text only; attachment sha256:${String(ref.attachmentId).slice(7, 15)}]`;
}
/**
* True when typed model content contains an image block, walking nested
* tool-result content. This is the one recursive image walk shared by every
* image policy (capability gating, text-only serialization, compaction
* survey), so a consumer cannot silently diverge on nesting depth.
* @param content - typed model content blocks.
* @returns whether any nested block is an image.
*/
function contentHasImage(content) {
	return content.some((block) => block.type === "image" || block.type === "tool-result" && contentHasImage(block.content));
}
/**
* True when typed model content contains a file block, walking nested
* tool-result content on the same recursion every file policy shares.
* Reads current content on every call without retaining scan results.
* @param content - typed model content blocks.
* @returns whether any nested block is a file.
*/
function contentHasFile(content) {
	for (const block of content) if (block.type === "file" || block.type === "tool-result" && contentHasFile(block.content)) return true;
	return false;
}
/**
* Stable model-facing handle for one durable file reference: the address of
* the verbatim stored copy and the instruction to read it on demand. This is
* the only representation a provider ever receives for a file.
* @param ref - durable verbatim file reference.
* @param readonlyPath - execution-world path of the stored copy, when resolvable.
* @returns deterministic handle text naming the file, its size, and its address.
*/
function fileHandleText(ref, readonlyPath) {
	const digest = String(ref.attachmentId).slice(7, 15);
	const identity = `File ${quoted(ref.name)} (${ref.bytes} bytes, sha256:${digest})`;
	if (readonlyPath === void 0) return `[${identity} was uploaded, but the current execution environment cannot access a readable path. Report that limitation if its contents are needed; do not claim to have read it.]`;
	return `[${identity}: verbatim read-only copy saved at ${quoted(readonlyPath)}. Read that path with your file tools when its contents are needed; copy it to a writable location before modifying it. When delegating file work, include this saved path in the delegation prompt; only subagents sharing this execution environment can read it.]`;
}
/** Replace every file occurrence, including nested tool results, with handle text. */
function replaceFilesWithHandles(blocks, resolvePath) {
	let next;
	for (const [index, block] of blocks.entries()) {
		if (block.type === "file") {
			next ??= blocks.slice(0, index);
			next.push({
				type: "text",
				text: fileHandleText(block.attachment, resolvePath(block.attachment))
			});
			continue;
		}
		if (block.type === "tool-result") {
			const content = replaceFilesWithHandles(block.content, resolvePath);
			if (content !== block.content) {
				next ??= blocks.slice(0, index);
				next.push({
					...block,
					content
				});
				continue;
			}
		}
		next?.push(block);
	}
	return next ?? blocks;
}
/**
* Project durable file history into deterministic handle text for every model
* route. Unlike images, no provider receives file blocks natively, so this
* projection is unconditional in request assembly.
* @param messages - complete request history.
* @param resolvePath - resolve one reference's current execution-world read path.
* @returns the original list without files, otherwise shallow message copies with handle text.
*/
function projectFilesToText(messages, resolvePath) {
	if (!messages.some((message) => contentHasFile(message.content))) return messages;
	return messages.map((message) => {
		const content = replaceFilesWithHandles(message.content, resolvePath);
		return content === message.content ? message : {
			...message,
			content
		};
	});
}
/** Replace every image occurrence, including nested tool results, for a text-only model. */
function replaceImagesForTextModel(blocks) {
	let next;
	for (const [index, block] of blocks.entries()) {
		if (block.type === "image") {
			next ??= blocks.slice(0, index);
			next.push({
				type: "text",
				text: textOnlyImageText(block.attachment)
			});
			continue;
		}
		if (block.type === "tool-result") {
			const content = replaceImagesForTextModel(block.content);
			if (content !== block.content) {
				next ??= blocks.slice(0, index);
				next.push({
					...block,
					content
				});
				continue;
			}
		}
		next?.push(block);
	}
	return next ?? blocks;
}
/**
* Project durable image history into deterministic text for an exact text-only model.
* @param messages - complete request history.
* @returns the original list without images, otherwise shallow message copies with stable placeholders.
*/
function projectImagesForTextModel(messages) {
	if (!messages.some((message) => contentHasImage(message.content))) return messages;
	return messages.map((message) => {
		const content = replaceImagesForTextModel(message.content);
		return content === message.content ? message : {
			...message,
			content
		};
	});
}
//#endregion
//#region ../../llm/llm/src/attribution.ts
/**
* Centralize the non-secret product identity every provider request sends as `User-Agent`, keeping
* adapters from drifting. See
* `.agents/notes/implemented/architecture/2026-06-21-mandatory-app-attribution-headers.md`.
*
* App-attribution vocabulary for provider requests.
* @module @deepseek-ai/dsh-llm/attribution
*/
const { version: version$2 } = createRequire(import.meta.url)("../package.json");
//#endregion
//#region ../../llm/llm/src/brand.ts
/**
* dsh-llm's owned branded ids: tool-call correlation and provider request
* diagnostics.
*
* The `Branded<B>` primitive and stateless constructor live in
* `@deepseek-ai/dsh-brand` so every owner of a cross-boundary id can brand it
* without depending on dsh-llm; see that package's README for the
* nominal-typing policy.
*
* @module @deepseek-ai/dsh-llm/brand
*/
/**
* Brand an adapter-owned reasoning-effort identifier.
* @param id - the opaque identifier exposed by one model capability.
* @returns the same string, branded; no validation is performed.
*/
function ReasoningEffortId(id) {
	return brandString(id);
}
//#endregion
//#region ../../llm/llm/src/assistant-stream.ts
/**
* Every streamed text-delta fragment joined in stream order; reasoning and Tool-call fragments are excluded.
* @param stream - compact records from one durable Assistant settlement.
* @returns the joined text, empty when the stream carries no text delta.
*/
function joinAssistantStreamText(stream) {
	const parts = [];
	for (const record of stream) if (record.type === "text-chunks") parts.push(record.texts.join(""));
	else if (record.type === "chunk" && record.chunk.type === "text-delta") parts.push(record.chunk.text);
	return parts.join("");
}
//#endregion
//#region ../../llm/llm/src/index.ts
/**
* LLM service: adapter registry with a waterfall-interceptable streaming call
* API. Exports the `LlmRuntime` default, the abstract `LlmAdapter` for
* provider backends, and `BlockAssembler` for chunk assembly.
*
* @module @deepseek-ai/dsh-llm
*/
var __runInitializers$1 = function(thisArg, initializers, value) {
	var useValue = arguments.length > 2;
	for (var i = 0; i < initializers.length; i++) value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
	return useValue ? value : void 0;
};
var __esDecorate$1 = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
	function accept(f) {
		if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
		return f;
	}
	var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
	var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
	var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
	var _, done = false;
	for (var i = decorators.length - 1; i >= 0; i--) {
		var context = {};
		for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
		for (var p in contextIn.access) context.access[p] = contextIn.access[p];
		context.addInitializer = function(f) {
			if (done) throw new TypeError("Cannot add initializers after decoration has completed");
			extraInitializers.push(accept(f || null));
		};
		var result = (0, decorators[i])(kind === "accessor" ? {
			get: descriptor.get,
			set: descriptor.set
		} : descriptor[key], context);
		if (kind === "accessor") {
			if (result === void 0) continue;
			if (result === null || typeof result !== "object") throw new TypeError("Object expected");
			if (_ = accept(result.get)) descriptor.get = _;
			if (_ = accept(result.set)) descriptor.set = _;
			if (_ = accept(result.init)) initializers.unshift(_);
		} else if (_ = accept(result)) if (kind === "field") initializers.unshift(_);
		else descriptor[key] = _;
	}
	if (target) Object.defineProperty(target, contextIn.name, descriptor);
	done = true;
};
(() => {
	let _classSuper = TypertRemoteService;
	let _instanceExtraInitializers = [];
	let _listProviders_decorators;
	let _listConfigurableProviders_decorators;
	let _remoteDiscoverModels_decorators;
	return class LlmRuntime extends _classSuper {
		static {
			const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
			_listProviders_decorators = [Remote];
			_listConfigurableProviders_decorators = [Remote];
			_remoteDiscoverModels_decorators = [Remote("discoverModels")];
			__esDecorate$1(this, null, _listProviders_decorators, {
				kind: "method",
				name: "listProviders",
				static: false,
				private: false,
				access: {
					has: (obj) => "listProviders" in obj,
					get: (obj) => obj.listProviders
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate$1(this, null, _listConfigurableProviders_decorators, {
				kind: "method",
				name: "listConfigurableProviders",
				static: false,
				private: false,
				access: {
					has: (obj) => "listConfigurableProviders" in obj,
					get: (obj) => obj.listConfigurableProviders
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate$1(this, null, _remoteDiscoverModels_decorators, {
				kind: "method",
				name: "remoteDiscoverModels",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteDiscoverModels" in obj,
					get: (obj) => obj.remoteDiscoverModels
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			if (_metadata) Object.defineProperty(this, Symbol.metadata, {
				enumerable: true,
				configurable: true,
				writable: true,
				value: _metadata
			});
		}
		adapters = (__runInitializers$1(this, _instanceExtraInitializers), /* @__PURE__ */ new Map());
		directory = /* @__PURE__ */ new Map();
		discoveries = /* @__PURE__ */ new Map();
		constructor(ctx) {
			super(ctx, "llm");
		}
		/** Notify topology observers without letting one broken listener veto the commit. */
		emitAdaptersUpdated() {
			let invariantFailure;
			for (const listener of this.ctx.events.dispatch("emit", ["llm/adapters-updated"])) try {
				const returned = listener();
				if (returned != null && typeof returned.then === "function") Promise.resolve(returned).then(void 0, (error) => {
					this.warnAdaptersListenerFailure(error);
				});
			} catch (error) {
				if (error?.code === "INVARIANT") {
					invariantFailure ??= error;
					continue;
				}
				this.warnAdaptersListenerFailure(error);
			}
			if (invariantFailure !== void 0) throw invariantFailure;
		}
		/** Contained-listener diagnostic shared by the sync and async failure paths. */
		warnAdaptersListenerFailure(error) {
			this.ctx.logger.warn("llm: an llm/adapters-updated listener failed");
			this.ctx.logger.warn(error);
		}
		/**
		* Register an adapter for the given provider routes. Throws `LlmError` with code
		* `DUPLICATE_ADAPTER` if any provider already has an adapter (all-or-nothing).
		* Disposed with the fiber.
		* @param providers - every provider route this adapter should serve.
		* @param adapter - the adapter that streams calls for those providers.
		* @returns the disposer, carrying {@link AdapterRegistrationHandle.replace}.
		*/
		registerAdapter(providers, adapter) {
			const owned = /* @__PURE__ */ new Set();
			let released = false;
			const dispose = this.ctx.effect(function* () {
				if (providers.length === 0) throw new LlmError("an adapter must register at least one provider", "INVALID_ADAPTER");
				this.commitRoutes(owned, this.prepareRoutes(providers, adapter, owned));
				yield () => {
					released = true;
					for (const provider of owned) this.adapters.delete(provider);
					owned.clear();
					this.emitAdaptersUpdated();
				};
			}.bind(this), "llm.registerAdapter()");
			const handle = (() => void dispose());
			handle.replace = (next) => {
				if (released) throw new LlmError("a disposed adapter registration cannot replace its routes", "REGISTRATION_DISPOSED");
				this.commitRoutes(owned, this.prepareRoutes(next, adapter, owned));
			};
			return handle;
		}
		/**
		* Validate one candidate route set for `adapter`, treating routes this
		* registration already holds as available. Nothing is mutated: a rejected
		* candidate leaves the registry exactly as it was.
		*/
		prepareRoutes(providers, adapter, owned) {
			const unique = /* @__PURE__ */ new Set();
			const registrations = [];
			for (const provider of providers) {
				if (provider.length === 0) throw new LlmError("adapter provider names must be non-empty", "INVALID_ADAPTER");
				if (unique.has(provider) || this.adapters.has(provider) && !owned.has(provider)) throw new LlmError(`an adapter for provider "${provider}" is already registered`, "DUPLICATE_ADAPTER");
				const info = adapter.providerInfo(provider);
				if (typeof info.id !== "string" || info.id !== provider || typeof info.name !== "string" || info.name.length === 0) throw new LlmError(`adapter metadata for provider "${provider}" must preserve its id and have a non-empty name`, "INVALID_ADAPTER");
				unique.add(provider);
				const retryPolicy = adapter.providerRetryPolicy(provider) ?? resolveRetryPolicy(void 0, `llm: provider "${provider}" retryPolicy`);
				registrations.push({
					adapter,
					provider: {
						id: info.id,
						name: info.name
					},
					retryPolicy
				});
			}
			return registrations;
		}
		/**
		* Swap this registration's routes for the prepared ones in one synchronous
		* section, so no observer can see the registry between the release and the
		* re-registration. The route set's one mutation point is also where
		* `llm/adapters-updated` is published, so a `replace` announces itself
		* exactly like a first registration.
		*/
		commitRoutes(owned, registrations) {
			for (const provider of owned) this.adapters.delete(provider);
			owned.clear();
			for (const registration of registrations) {
				this.adapters.set(registration.provider.id, registration);
				owned.add(registration.provider.id);
			}
			this.emitAdaptersUpdated();
		}
		/**
		* Describe provider routes with a registered adapter.
		* @returns detached provider metadata in registration order.
		*/
		listProviders() {
			return [...this.adapters.values()].map(({ provider }) => ({ ...provider }));
		}
		/**
		* Declare provider routes an adapter plugin can activate through
		* configuration. Registration is all-or-nothing: an empty list, invalid
		* entry, or a provider already declared by any registration throws
		* `LlmError` without registering the rest. Disposed with the fiber.
		* @param entries - every configurable provider this plugin owns.
		* @returns a handle that withdraws all of them, and can atomically replace them.
		*/
		registerConfigurableProviders(entries) {
			let held = [];
			let disposed = false;
			/**
			* Validate a candidate set in full against everything this registration
			* does not already hold, then publish it. Nothing is written until the
			* whole set passes, so a refused candidate leaves the current entries in
			* place — the property that makes `replace` a swap rather than a
			* delete-then-add that can strand the directory empty.
			*/
			const commit = (candidates) => {
				const detached = [];
				const own = new Set(held.map((entry) => entry.provider));
				for (const entry of candidates) {
					if (entry.provider.length === 0 || entry.displayName.length === 0 || entry.settingsNs.length === 0) throw new LlmError("configurable providers need a non-empty provider, displayName, and settingsNs", "INVALID_DIRECTORY");
					if (entry.settingsPath.some((segment) => segment.length === 0)) throw new LlmError(`configurable provider "${entry.provider}" has an empty settingsPath segment`, "INVALID_DIRECTORY");
					if (this.directory.has(entry.provider) && !own.has(entry.provider) || detached.some((seen) => seen.provider === entry.provider)) throw new LlmError(`configurable provider "${entry.provider}" is already declared`, "DUPLICATE_DIRECTORY");
					detached.push({
						...entry,
						settingsPath: [...entry.settingsPath]
					});
				}
				for (const entry of held) this.directory.delete(entry.provider);
				for (const entry of detached) this.directory.set(entry.provider, entry);
				held = detached;
				this.emitAdaptersUpdated();
			};
			const dispose = this.ctx.effect(function* () {
				if (entries.length === 0) throw new LlmError("a configurable-provider registration must declare at least one provider", "INVALID_DIRECTORY");
				commit(entries);
				yield () => {
					disposed = true;
					for (const entry of held) this.directory.delete(entry.provider);
					held = [];
					this.emitAdaptersUpdated();
				};
			}.bind(this), "llm.registerConfigurableProviders()");
			const handle = (() => void dispose());
			handle.replace = (next) => {
				if (disposed) throw new LlmError("this configurable-provider registration was disposed", "REGISTRATION_DISPOSED");
				commit(next);
			};
			return handle;
		}
		/**
		* List every declared configurable provider, registered or dormant.
		* @returns detached directory entries in declaration order.
		*/
		listConfigurableProviders() {
			return [...this.directory.values()].map((entry) => ({
				...entry,
				settingsPath: [...entry.settingsPath]
			}));
		}
		/**
		* Offer to interrogate provider endpoints on behalf of the settings
		* namespace this plugin owns. The namespace is the key because that is what
		* a configuration surface already holds from the configurable-provider
		* directory, and because a provider being *added* has no route to name yet.
		* Disposed with the fiber.
		* @param settingsNs - the namespace whose profiles this discovery serves.
		* @param discover - interrogates one endpoint and must honor the supplied signal.
		* @returns the disposer that withdraws the offer.
		*/
		registerModelDiscovery(settingsNs, discover) {
			const dispose = this.ctx.effect(function* () {
				if (settingsNs.length === 0) throw new LlmError("model discovery needs a non-empty settings namespace", "INVALID_DISCOVERY");
				if (this.discoveries.has(settingsNs)) throw new LlmError(`model discovery for "${settingsNs}" is already registered`, "DUPLICATE_DISCOVERY");
				this.discoveries.set(settingsNs, discover);
				yield () => {
					this.discoveries.delete(settingsNs);
				};
			}.bind(this), "llm.registerModelDiscovery()");
			return () => void dispose();
		}
		/**
		* Interrogate one provider endpoint for the models it advertises. The
		* request describes a draft, not a stored route, so nothing here reads or
		* writes settings or credentials — the caller owns both, and the reply is
		* candidate metadata a surface may offer for adoption.
		* @param settingsNs - namespace whose registered discovery serves this draft.
		* @param request - the endpoint, protocol, and one-shot credential to use.
		* @param signal - caller cancellation.
		* @returns the advertised models, deduplicated in endpoint order.
		*/
		async discoverModels(settingsNs, request, signal) {
			const discover = this.discoveries.get(settingsNs);
			if (discover === void 0) throw new LlmError(`no model discovery is registered for "${settingsNs}"`, "NO_DISCOVERY");
			if ((request.provider ?? "").length === 0 && (request.baseURL ?? "").length === 0) throw new LlmError("model discovery needs a provider route or a baseURL", "INVALID_DISCOVERY");
			const discovered = signal === void 0 ? await discover(request) : await discover(request, signal);
			const seen = /* @__PURE__ */ new Set();
			const models = [];
			for (const model of discovered) {
				if (typeof model.id !== "string" || model.id.length === 0 || seen.has(model.id)) continue;
				seen.add(model.id);
				models.push({
					id: model.id,
					...model.name === void 0 ? {} : { name: model.name },
					...model.contextWindow === void 0 ? {} : { contextWindow: model.contextWindow },
					...model.maxTokens === void 0 ? {} : { maxTokens: model.maxTokens }
				});
			}
			return models;
		}
		/**
		* Remote adapter for one draft provider interrogation.
		* @param settingsNs - namespace whose registered discovery serves this draft.
		* @param request - endpoint, protocol, and one-shot credential to use.
		* @param signal - caller cancellation supplied by the Remote carrier.
		* @returns advertised models in endpoint order.
		* @throws RemoteError with `llm/model-discovery-rejected` when discovery refuses or fails.
		*/
		async remoteDiscoverModels(settingsNs, request, signal) {
			try {
				return await this.discoverModels(settingsNs, request, signal);
			} catch (error) {
				throw new RemoteError("llm/model-discovery-rejected", error instanceof Error ? error.message : String(error), {
					settingsNs,
					...request.baseURL === void 0 ? {} : { baseURL: request.baseURL }
				}, { cause: error });
			}
		}
		/**
		* Resolve the retry policy captured when one provider route was registered.
		* @param provider - registered provider route to inspect.
		* @returns the provider-owned policy, with normal defaults already resolved.
		*/
		providerRetryPolicy(provider) {
			return this.registration(provider).retryPolicy;
		}
		/**
		* Resolve provider-side request-image pricing for one exact route, or
		* `undefined` when the provider is unregistered or declares none. Unknown
		* providers degrade to `undefined` rather than throwing because callers
		* price durable history whose route may no longer be mounted.
		* @param provider - provider route named by a request header.
		* @param model - exact model id named by the same header.
		* @returns the owning adapter's image pricing for the route, when declared.
		*/
		imageRequestPricing(provider, model) {
			return this.adapters.get(provider)?.adapter.imageRequestPricing(provider, model);
		}
		/**
		* Resolve the exact text one durable file occurrence contributes to every
		* provider request in the current execution environment.
		* @param ref - durable verbatim file reference from model history.
		* @returns the same deterministic handle text used at adapter dispatch.
		*/
		fileRequestText(ref) {
			return fileHandleText(ref, this.fileReadPath(ref));
		}
		/** Detach typed adapter-owned modality metadata. */
		detachedModalities(modalities) {
			return modalities === void 0 ? void 0 : [...modalities];
		}
		/**
		* Discover models advertised by one registered provider. Catalog membership
		* is advisory and never changes routing or request validation.
		* @param provider - registered provider route to inspect.
		* @returns detached model metadata in adapter-preferred order.
		*/
		async listModels(provider) {
			const models = await this.registration(provider).adapter.listModels(provider);
			const seen = /* @__PURE__ */ new Set();
			return models.map((model) => {
				if (typeof model.provider !== "string" || model.provider !== provider || typeof model.id !== "string" || model.id.length === 0 || typeof model.name !== "string" || model.name.length === 0 || model.description !== void 0 && typeof model.description !== "string" || seen.has(model.id)) throw new LlmError(`adapter returned invalid or duplicate model metadata for provider "${provider}"`, "INVALID_CATALOG");
				seen.add(model.id);
				const inputModalities = this.detachedModalities(model.inputModalities);
				return {
					provider: model.provider,
					id: model.id,
					name: model.name,
					...model.description === void 0 ? {} : { description: model.description },
					...inputModalities === void 0 ? {} : { inputModalities }
				};
			});
		}
		/**
		* Resolve and validate all metadata from the adapter that owns one exact
		* route. The result is detached from adapter-owned objects; catalog
		* membership remains advisory and does not control request routing.
		* @param provider - registered provider route to inspect.
		* @param model - exact model id passed to the adapter.
		* @param signal - optional cancellation for adapter-owned asynchronous lookup.
		* @returns exact model identity plus available context and reasoning metadata.
		*/
		async resolveModelInfo(provider, model, signal) {
			return this.resolveModelInfoFor(this.registration(provider), model, signal);
		}
		async resolveModelInfoFor(registration, model, signal) {
			const resolved = await registration.adapter.resolveModel(registration.provider.id, model, signal);
			return this.normalizeModelInfo(registration, model, resolved);
		}
		/** Validate and detach one adapter-returned exact model result. */
		normalizeModelInfo(registration, model, resolved) {
			const provider = registration.provider.id;
			if (typeof resolved.provider !== "string" || resolved.provider !== provider || typeof resolved.id !== "string" || resolved.id !== model || typeof resolved.name !== "string" || resolved.name.length === 0 || resolved.description !== void 0 && typeof resolved.description !== "string") throw new LlmError(`adapter returned invalid exact model metadata for provider "${provider}" model "${model}"`, "INVALID_MODEL_INFO");
			const context = resolved.context;
			if (context !== void 0 && (!Number.isInteger(context.contextWindow) || context.contextWindow <= 0)) throw new LlmError(`adapter returned invalid context metadata for provider "${provider}" model "${model}"`, "INVALID_MODEL_CONTEXT");
			const inputModalities = this.detachedModalities(resolved.inputModalities);
			const systemPromptUpdate = resolved.systemPromptUpdate;
			if (systemPromptUpdate !== void 0 && systemPromptUpdate !== "in-history") throw new LlmError(`adapter returned invalid system prompt update mode for provider "${provider}" model "${model}"`, "INVALID_MODEL_INFO");
			const defaultMaxTokens = resolved.defaultMaxTokens;
			if (defaultMaxTokens !== void 0 && (!Number.isSafeInteger(defaultMaxTokens) || defaultMaxTokens <= 0)) throw new LlmError(`adapter returned invalid default maxTokens for provider "${provider}" model "${model}"`, "INVALID_MODEL_MAX_TOKENS");
			const info = {
				provider,
				id: model,
				name: resolved.name,
				...resolved.description === void 0 ? {} : { description: resolved.description },
				...inputModalities === void 0 ? {} : { inputModalities },
				...context === void 0 ? {} : { context: { contextWindow: context.contextWindow } },
				...defaultMaxTokens === void 0 ? {} : { defaultMaxTokens },
				...resolved.systemPromptUpdate === void 0 ? {} : { systemPromptUpdate: resolved.systemPromptUpdate }
			};
			const reasoning = resolved.reasoning;
			if (reasoning === void 0) return info;
			if (reasoning.efforts.length === 0) throw new LlmError(`adapter returned invalid reasoning metadata for provider "${provider}" model "${model}"`, "INVALID_MODEL_REASONING");
			const seen = /* @__PURE__ */ new Set();
			const efforts = reasoning.efforts.map((effort) => {
				if (typeof effort.id !== "string" || effort.id.length === 0 || typeof effort.name !== "string" || effort.name.length === 0 || effort.description !== void 0 && typeof effort.description !== "string" || seen.has(effort.id)) throw new LlmError(`adapter returned invalid or duplicate reasoning effort metadata for provider "${provider}" model "${model}"`, "INVALID_MODEL_REASONING");
				seen.add(effort.id);
				return {
					id: effort.id,
					name: effort.name,
					...effort.description === void 0 ? {} : { description: effort.description }
				};
			});
			if (reasoning.defaultEffort !== void 0 && !seen.has(reasoning.defaultEffort)) throw new LlmError(`adapter returned an unknown default reasoning effort for provider "${provider}" model "${model}"`, "INVALID_MODEL_REASONING");
			return {
				...info,
				reasoning: {
					efforts,
					...reasoning.defaultEffort === void 0 ? {} : { defaultEffort: reasoning.defaultEffort }
				}
			};
		}
		/**
		* Validate a conversation call config against its exact model capability and
		* materialize adapter-configured defaults. Unsupported explicit efforts
		* reject before provider I/O; no clamping or aliasing is performed. This
		* standalone query does not bind a later dispatch; use {@link prepareCall}
		* when logging and streaming must share one adapter registration.
		* @param config - provider/model route and optional request controls.
		* @param signal - optional cancellation for adapter-owned capability lookup.
		* @returns a detached config only when a default must be materialized.
		*/
		async resolveCallConfig(config, signal) {
			return (await this.resolveCallFor(this.registration(config.provider), config, signal)).config;
		}
		async resolveCallFor(registration, config, signal) {
			const info = await this.resolveModelInfoFor(registration, config.model, signal);
			return this.resolveCallWithInfo(config, info);
		}
		/** Validate request controls against one already-bound exact model result. */
		resolveCallWithInfo(config, info) {
			const defaulted = config.maxTokens === void 0 && info.defaultMaxTokens !== void 0 ? {
				...config,
				maxTokens: info.defaultMaxTokens
			} : config;
			const reasoning = info.reasoning;
			const requested = defaulted.reasoningEffort;
			let resolvedConfig = defaulted;
			if (reasoning === void 0) {
				if (requested !== void 0) throw new LlmError(`provider "${config.provider}" model "${config.model}" does not support reasoning effort "${requested}"`, "UNSUPPORTED_REASONING_EFFORT");
			} else {
				const effective = requested ?? reasoning.defaultEffort;
				if (effective !== void 0) {
					if (!reasoning.efforts.some((effort) => effort.id === effective)) throw new LlmError(`provider "${config.provider}" model "${config.model}" does not support reasoning effort "${effective}"`, "UNSUPPORTED_REASONING_EFFORT");
					if (requested !== effective) resolvedConfig = {
						...defaulted,
						reasoningEffort: effective
					};
				}
			}
			return {
				config: resolvedConfig,
				...info.context === void 0 ? {} : { context: info.context },
				modelInfo: info
			};
		}
		/**
		* Resolve one call under its current adapter registration. The returned
		* one-shot handle keeps that registration across header logging and dispatch,
		* so HMR cannot combine one adapter's capability result with another adapter.
		* @param config - provider/model route and optional request controls.
		* @param signal - optional cancellation for adapter-owned capability lookup.
		* @returns a prepared config and its registration-bound stream entry point.
		*/
		async prepareCall(config, signal) {
			const registration = this.registration(config.provider);
			const adapterCall = await registration.adapter.prepareCall(config.provider, config.model, signal);
			const modelInfo = this.normalizeModelInfo(registration, config.model, adapterCall.model);
			const resolved = this.resolveCallWithInfo(config, modelInfo);
			const resolvedConfig = deepFreeze(structuredClone(resolved.config));
			const context = resolved.context === void 0 ? void 0 : deepFreeze(structuredClone(resolved.context));
			const adapterDefaults = deepFreeze({
				...config.reasoningEffort === void 0 && resolvedConfig.reasoningEffort !== void 0 ? { reasoningEffort: true } : {},
				...config.maxTokens === void 0 && resolvedConfig.maxTokens !== void 0 ? { maxTokens: true } : {}
			});
			let dispatched = false;
			return Object.freeze({
				config: resolvedConfig,
				retryPolicy: registration.retryPolicy,
				adapterDefaults,
				...context === void 0 ? {} : { context },
				...modelInfo.inputModalities === void 0 ? {} : { inputModalities: Object.freeze([...modelInfo.inputModalities]) },
				...modelInfo.systemPromptUpdate === void 0 ? {} : { systemPromptUpdate: modelInfo.systemPromptUpdate },
				stream: (options) => {
					if (dispatched) throw new LlmError("a prepared LLM call can only be dispatched once", "INVALID_PREPARED_CALL");
					if (!callConfigEquals(options, resolvedConfig)) throw new LlmError("prepared LLM call config changed before adapter dispatch", "INVALID_PREPARED_CALL");
					dispatched = true;
					return this.streamWithRegistration(options, {
						registration,
						config: resolvedConfig,
						modelInfo,
						dispatch: (options) => adapterCall.stream(options)
					});
				}
			});
		}
		registration(provider) {
			const registration = this.adapters.get(provider);
			if (!registration) throw new LlmError(`no adapter registered for provider "${provider}"`, "NO_ADAPTER");
			return registration;
		}
		/** Remove replay state whose historical route is owned by another adapter. */
		forAdapter(options, adapter) {
			const messages = options.messages.map((message) => {
				const source = message.source;
				if (message.role !== "assistant" || source.kind !== "model" || source.replayState === void 0) return message;
				if (this.adapters.get(source.provider)?.adapter === adapter) return message;
				return freezeMessage({
					...message,
					source: {
						kind: "model",
						provider: source.provider,
						model: source.model
					}
				});
			});
			if (messages.every((message, index) => message === options.messages[index])) return options;
			const filtered = {
				...options,
				messages
			};
			return Object.isFrozen(options) ? deepFreeze(filtered) : filtered;
		}
		/**
		* Resolve the current execution-world read path of one durable file
		* reference through the mounted attachment and filesystem providers.
		*/
		fileReadPath(ref) {
			let hostPath;
			try {
				hostPath = this.ctx.get("attachments")?.fileHostPath(ref);
			} catch {
				return;
			}
			if (hostPath === void 0) return void 0;
			return this.ctx.get("fs")?.processPathFromHostPath(hostPath);
		}
		/**
		* Final adapter boundary. Adapter selection, dispatch, iterator construction,
		* and iteration failures become one terminal failure chunk. Middleware and
		* downstream consumer failures remain thrown plugin or consumer errors.
		*/
		async *adapterStream(options, prepared) {
			let iterator;
			try {
				const registration = prepared?.registration ?? this.registration(options.provider);
				const adapter = registration.adapter;
				let modelInfo;
				let resolvedConfig;
				let dispatch;
				if (prepared === void 0) {
					const adapterCall = await adapter.prepareCall(options.provider, options.model, options.signal);
					modelInfo = this.normalizeModelInfo(registration, options.model, adapterCall.model);
					resolvedConfig = this.resolveCallWithInfo(options, modelInfo).config;
					dispatch = (options) => adapterCall.stream(options);
				} else {
					modelInfo = prepared.modelInfo;
					resolvedConfig = prepared.config;
					dispatch = prepared.dispatch;
				}
				if (prepared !== void 0 && !callConfigEquals(options, resolvedConfig)) throw new LlmError("prepared LLM call config changed before adapter dispatch", "INVALID_PREPARED_CALL");
				const resolvedOptions = callConfigEquals(options, resolvedConfig) ? options : Object.isFrozen(options) ? deepFreeze({
					...options,
					...resolvedConfig
				}) : {
					...options,
					...resolvedConfig
				};
				let projectedMessages = resolvedOptions.messages;
				if (projectedMessages.some((message) => contentHasFile(message.content))) projectedMessages = projectFilesToText(projectedMessages, (ref) => this.fileReadPath(ref));
				if (modelInfo.inputModalities !== void 0 && !modelInfo.inputModalities.includes("image") && projectedMessages.some((message) => contentHasImage(message.content))) projectedMessages = projectImagesForTextModel(projectedMessages);
				const projectedOptions = projectedMessages === resolvedOptions.messages ? resolvedOptions : Object.isFrozen(resolvedOptions) ? deepFreeze({
					...resolvedOptions,
					messages: projectedMessages
				}) : {
					...resolvedOptions,
					messages: projectedMessages
				};
				iterator = dispatch(this.forAdapter(projectedOptions, adapter))[Symbol.asyncIterator]();
			} catch (error) {
				yield adapterFailureChunk(error, options.signal);
				return;
			}
			let completed = false;
			try {
				while (true) {
					let item;
					try {
						const next = await iterator.next();
						item = next.done ? { done: true } : {
							done: false,
							value: next.value
						};
					} catch (error) {
						completed = true;
						yield adapterFailureChunk(error, options.signal);
						return;
					}
					if (item.done) {
						completed = true;
						return;
					}
					yield item.value;
				}
			} finally {
				if (!completed) {
					const close = iterator.return?.bind(iterator);
					if (close) await close();
				}
			}
		}
		/**
		* Stream one model call as raw chunks (token-level deltas). Replay state is
		* retained only when the same adapter instance owns its historical provider
		* and the target provider. Final adapter selection remains fixed through
		* asynchronous exact-model resolution and dispatch. Adapter selection,
		* dispatch, and iteration failures become terminal `error` or `aborted`
		* finish chunks; middleware, nested-call, cleanup, and consumer failures
		* remain thrown.
		* @param options - the full request; `options.provider` selects the adapter.
		* @returns the chunk stream, possibly wrapped by `llm/stream` listeners.
		*/
		stream(options) {
			return this.streamWithRegistration(options);
		}
		streamWithRegistration(options, prepared) {
			return this.ctx.waterfall(this, "llm/stream", options, () => this.adapterStream(options, prepared));
		}
	};
})();
/** Convert one adapter throw into the stream protocol's terminal outcome. */
function adapterFailureChunk(error, signal) {
	const failure = normalizeLlmFailure(error);
	return {
		type: "finish",
		reason: signal?.aborted || failure.code === "ABORTED" ? {
			kind: "aborted",
			failure
		} : {
			kind: "error",
			failure
		}
	};
}
//#endregion
//#region ../../core/native-tools/src/json-schema.ts
/**
* Enforced JSON Schema subset shared by tool outputs, generated PTC mode
* types, subagents, and workflows. The subset accepts any JSON root, an
* annotation-only schema for unconstrained JSON, one scalar `type`, object
* `properties`/`required`/boolean `additionalProperties`, array `items`,
* type-correct scalar `enum`/`const`, and exact-one `oneOf`.
*
* Unsupported or misplaced keywords reject rather than being accepted without
* enforcement. Consumers that require an object root apply
* {@link assertObjectJsonSchema} before accepting input.
* @module @deepseek-ai/dsh-native-tools/json-schema
*/
/**
* Thrown when a raw schema falls outside the enforced subset. `violations`
* lists every offending path instead of stopping at the first author error.
*/
var JsonSchemaError = class extends HarnessError {
	/** Individual schema violations in walk order. */
	violations;
	constructor(violations) {
		super(`unsupported JSON schema: ${violations.join("; ")}`, "UNSUPPORTED_SCHEMA");
		this.name = "JsonSchemaError";
		this.violations = violations;
	}
};
const CONSTRAINT_KEYWORDS = new Set([
	"type",
	"oneOf",
	"properties",
	"required",
	"additionalProperties",
	"items",
	"enum",
	"const"
]);
const ANNOTATION_KEYWORDS = new Set([
	"description",
	"title",
	"default",
	"examples"
]);
const SCHEMA_TYPES = [
	"object",
	"array",
	"string",
	"number",
	"integer",
	"boolean",
	"null"
];
/** Whether a realm-owned intrinsic prototype is backed by its native constructor. */
function hasIntrinsicConstructor(prototype, name) {
	const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
	if (typeof constructor !== "function") return false;
	try {
		return constructor.name === name && constructor.prototype === prototype && Function.prototype.toString.call(constructor) === `function ${name}() { [native code] }`;
	} catch {
		return false;
	}
}
/** Whether a candidate is one realm's intrinsic `Object.prototype`. */
function isIntrinsicObjectPrototype(value) {
	return Object.getPrototypeOf(value) === null && hasIntrinsicConstructor(value, "Object");
}
/**
* Test for a realm-agnostic plain JSON record without accepting arrays or
* exotic objects.
* @param value - candidate record from any JavaScript realm.
* @returns Whether the value has a plain-object prototype chain.
*/
function isPlainJsonRecord(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	try {
		const prototype = Object.getPrototypeOf(value);
		return prototype === null || typeof prototype === "object" && isIntrinsicObjectPrototype(prototype);
	} catch {
		return false;
	}
}
/** Whether an array uses one realm's intrinsic `Array.prototype`. */
function hasPlainArrayPrototype(value) {
	const prototype = Object.getPrototypeOf(value);
	if (!Array.isArray(prototype) || !hasIntrinsicConstructor(prototype, "Array")) return false;
	const objectPrototype = Object.getPrototypeOf(prototype);
	return typeof objectPrototype === "object" && objectPrototype !== null && isIntrinsicObjectPrototype(objectPrototype);
}
/** Return whether a record contains only own enumerable string keys. */
function hasOnlyEnumerableStringKeys(value) {
	try {
		return Reflect.ownKeys(value).every((key) => typeof key === "string" && Object.prototype.propertyIsEnumerable.call(value, key));
	} catch {
		return false;
	}
}
/**
* Test for an ordinary schema record whose keys survive JSON projection.
* @param value - candidate record from any JavaScript realm.
* @returns Whether the record has an intrinsic prototype and only own enumerable string keys.
*/
function isJsonSchemaRecord(value) {
	return isPlainJsonRecord(value) && hasOnlyEnumerableStringKeys(value);
}
/**
* Test for a dense ordinary array with no JSON-invisible decorations.
* @param value - candidate array from any JavaScript realm.
* @returns Whether the array is intrinsic, dense, and undecorated.
*/
function isPlainJsonArray(value) {
	if (!Array.isArray(value)) return false;
	try {
		if (!hasPlainArrayPrototype(value) || Reflect.ownKeys(value).length !== value.length + 1) return false;
		for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) return false;
		return true;
	} catch {
		return false;
	}
}
/** Lossless finite JSON number, excluding negative zero. */
function isJsonNumber(value) {
	return typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0);
}
/** Whether a scalar is valid for one declared schema type. */
function scalarMatches(type, value) {
	switch (type) {
		case "string": return typeof value === "string";
		case "number": return isJsonNumber(value);
		case "integer": return isJsonNumber(value) && Number.isInteger(value);
		case "boolean": return typeof value === "boolean";
		case "null": return value === null;
		/* v8 ignore next -- JsonSchemaScalarType is closed; this retains compile-time exhaustiveness. */
		default: return assertNever(type, "JsonSchemaType");
	}
}
/** Keywords that are invalid beside `oneOf`. */
const ONE_OF_SIBLING_KEYWORDS = [
	"properties",
	"required",
	"additionalProperties",
	"items",
	"enum",
	"const"
];
/** Validate object-only fields after its property schemas have been visited. */
function checkObjectSchemaTail(node, path, properties, violations) {
	const hasRequired = Object.hasOwn(node, "required");
	const required = hasRequired ? node.required : void 0;
	if (hasRequired) if (!isPlainJsonArray(required) || required.some((entry) => typeof entry !== "string")) violations.push(`${path}.required must be an array of strings`);
	else {
		const declared = isJsonSchemaRecord(properties) ? properties : {};
		for (const key of required) if (!Object.hasOwn(declared, key)) violations.push(`${path}.required names "${key}" which is not in properties`);
	}
	if (Object.hasOwn(node, "additionalProperties") && typeof node.additionalProperties !== "boolean") violations.push(`${path}.additionalProperties must be a boolean`);
}
/** Collect every violation for one raw schema tree without using the JavaScript call stack. */
function checkSchemaNode(root, rootPath, violations, seen) {
	const tasks = [{
		kind: "enter",
		node: root,
		path: rootPath
	}];
	for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
		if (task.kind === "leave") {
			seen.delete(task.node);
			continue;
		}
		if (task.kind === "one-of-tail") {
			for (const key of ONE_OF_SIBLING_KEYWORDS) if (Object.hasOwn(task.node, key)) violations.push(`${task.path}.${key} is not supported beside oneOf`);
			continue;
		}
		if (task.kind === "object-tail") {
			checkObjectSchemaTail(task.node, task.path, task.properties, violations);
			continue;
		}
		const { node, path } = task;
		if (!isJsonSchemaRecord(node)) {
			violations.push(`${path} must be a schema object`);
			continue;
		}
		if (seen.has(node)) {
			violations.push(`${path} is circular`);
			continue;
		}
		seen.add(node);
		tasks.push({
			kind: "leave",
			node
		});
		for (const key of Object.keys(node)) {
			if (CONSTRAINT_KEYWORDS.has(key)) continue;
			if (ANNOTATION_KEYWORDS.has(key)) {
				try {
					if (!isJsonValue(node[key])) violations.push(`${path}.${key} annotation must be lossless JSON data`);
				} catch {
					violations.push(`${path}.${key} annotation must be lossless JSON data`);
				}
				continue;
			}
			violations.push(`${path}.${key} is not a supported keyword (subset: type/oneOf/properties/required/additionalProperties/items/enum/const + annotations)`);
		}
		if (Object.hasOwn(node, "description") && typeof node.description !== "string") violations.push(`${path}.description must be a string`);
		if (Object.hasOwn(node, "title") && typeof node.title !== "string") violations.push(`${path}.title must be a string`);
		const hasType = Object.hasOwn(node, "type");
		const hasOneOf = Object.hasOwn(node, "oneOf");
		if (hasType && hasOneOf) {
			violations.push(`${path} cannot declare both type and oneOf`);
			continue;
		}
		if (!hasType && !hasOneOf) {
			for (const key of ONE_OF_SIBLING_KEYWORDS) if (Object.hasOwn(node, key)) violations.push(`${path}.${key} requires type or oneOf`);
			continue;
		}
		if (hasOneOf) {
			const oneOf = node.oneOf;
			tasks.push({
				kind: "one-of-tail",
				node,
				path
			});
			if (!isPlainJsonArray(oneOf) || oneOf.length < 2) violations.push(`${path}.oneOf must be an array of at least two schemas`);
			else for (let index = oneOf.length - 1; index >= 0; index--) tasks.push({
				kind: "enter",
				node: oneOf[index],
				path: `${path}.oneOf[${index}]`
			});
			continue;
		}
		const type = node.type;
		if (typeof type !== "string" || !SCHEMA_TYPES.includes(type)) {
			violations.push(Array.isArray(type) ? `${path}.type must be a single type string (type arrays are not supported)` : `${path}.type must be one of ${SCHEMA_TYPES.join("/")}`);
			continue;
		}
		const schemaType = type;
		for (const [key, types] of Object.entries({
			properties: ["object"],
			required: ["object"],
			additionalProperties: ["object"],
			items: ["array"],
			enum: [
				"string",
				"number",
				"integer",
				"boolean",
				"null"
			],
			const: [
				"string",
				"number",
				"integer",
				"boolean",
				"null"
			]
		})) if (Object.hasOwn(node, key) && !types.includes(schemaType)) violations.push(`${path}.${key} is not supported on type "${schemaType}"`);
		switch (schemaType) {
			case "object": {
				const properties = Object.hasOwn(node, "properties") ? node.properties : void 0;
				tasks.push({
					kind: "object-tail",
					node,
					path,
					properties
				});
				if (Object.hasOwn(node, "properties")) if (!isJsonSchemaRecord(properties)) violations.push(`${path}.properties must be an object of schemas`);
				else {
					const entries = Object.entries(properties);
					for (let index = entries.length - 1; index >= 0; index--) {
						const entry = entries[index];
						/* v8 ignore next -- the loop is bounded by the captured entry count. */
						if (entry === void 0) continue;
						tasks.push({
							kind: "enter",
							node: entry[1],
							path: `${path}.properties.${entry[0]}`
						});
					}
				}
				break;
			}
			case "array":
				if (Object.hasOwn(node, "items")) tasks.push({
					kind: "enter",
					node: node.items,
					path: `${path}.items`
				});
				break;
			case "string":
			case "number":
			case "integer":
			case "boolean":
			case "null": {
				const hasEnum = Object.hasOwn(node, "enum");
				const allowed = hasEnum ? node.enum : void 0;
				const enumValid = isPlainJsonArray(allowed) && allowed.length > 0 && allowed.every((entry) => scalarMatches(schemaType, entry));
				if (hasEnum && !enumValid) violations.push(`${path}.enum must be a non-empty array of ${schemaType} values`);
				const hasConst = Object.hasOwn(node, "const");
				const declaredConst = hasConst ? node.const : void 0;
				const constValid = scalarMatches(schemaType, declaredConst);
				if (hasConst) {
					if (!constValid) violations.push(`${path}.const must be a ${schemaType} value`);
					else if (enumValid && !allowed.includes(declaredConst)) violations.push(`${path}.const must be one of ${path}.enum when both are declared`);
				}
				break;
			}
			/* v8 ignore next -- schemaType was narrowed from the closed SCHEMA_TYPES table above. */
			default: assertNever(schemaType, "JsonSchemaType");
		}
	}
}
/**
* Assert that an arbitrary raw schema uses only the enforced subset.
* Annotation-only schemas are accepted as the standard unconstrained-JSON
* form; callers that require an object root use {@link assertObjectJsonSchema}.
* @param schema - untrusted raw JSON Schema.
* @returns Assertion that the schema belongs to the supported subset.
*/
function assertSupportedJsonSchema(schema) {
	const violations = [];
	checkSchemaNode(schema, "schema", violations, /* @__PURE__ */ new Set());
	if (violations.length > 0) throw new JsonSchemaError(violations);
}
/**
* Assert the enforced subset plus the object-root constraint retained by
* subagent and workflow structured outputs.
* @param schema - untrusted caller-supplied schema.
* @returns Assertion that the schema belongs to the supported subset and has an object root.
*/
function assertObjectJsonSchema(schema) {
	const violations = [];
	checkSchemaNode(schema, "schema", violations, /* @__PURE__ */ new Set());
	if (violations.length === 0 && (!isJsonSchemaRecord(schema) || !Object.hasOwn(schema, "type") || schema.type !== "object")) violations.push("schema.type must be \"object\" (structured output is object-rooted)");
	if (violations.length > 0) throw new JsonSchemaError(violations);
}
/** Safely test the lossless JSON boundary when a getter may throw. */
function safelyIsJsonValue(value) {
	try {
		return isJsonValue(value);
	} catch {
		return false;
	}
}
/** Root-aware diagnostic path for the parameter validator's empty sentinel. */
function diagnosticPath(path) {
	return path === "" ? "arguments" : path;
}
/** Append one object property without a leading dot at an implicit root. */
function propertyPath(path, key) {
	return path === "" ? key : `${path}.${key}`;
}
/** The generic exception-containment diagnostic owned by one valid schema node. */
function losslessValueViolation(path) {
	return [`"${diagnosticPath(path)}" must be a lossless JSON value`];
}
/** Append diagnostics without spreading a potentially wide child result as call arguments. */
function appendViolations(target, source) {
	for (const violation of source) target.push(violation);
}
/** Initialize one validation frame with empty aggregation state. */
function valueFrame(node, value, path) {
	return {
		node,
		value,
		path,
		catches: false,
		phase: "start",
		children: [],
		childIndex: 0,
		violations: [],
		tailViolations: [],
		matches: 0
	};
}
/** Validate one scalar node after its primitive type check. */
function checkScalarValue(node, value, path) {
	const allowed = Object.hasOwn(node, "enum") ? node.enum : void 0;
	if (allowed !== void 0 && !allowed.includes(value)) return [`"${diagnosticPath(path)}" must be one of ${JSON.stringify(allowed)}`];
	if (Object.hasOwn(node, "const") && value !== node.const) return [`"${diagnosticPath(path)}" must be ${JSON.stringify(node.const)}`];
	return [];
}
/** Validate one trusted schema/value pair with explicit frames rather than recursive calls. */
function checkValue(schema, value, path) {
	const frames = [valueFrame(schema, value, path)];
	let rootResult;
	const receive = (result) => {
		const parent = frames.at(-1);
		if (parent === void 0) {
			rootResult = result;
			return;
		}
		if (parent.kind === "oneOf") {
			if (result.length === 0) parent.matches++;
		} else appendViolations(parent.violations, result);
	};
	const finish = (result) => {
		frames.pop();
		receive(result);
	};
	while (frames.length > 0) {
		const frame = frames.at(-1);
		/* v8 ignore next -- the loop condition guarantees a current frame. */
		if (frame === void 0) break;
		try {
			if (frame.phase === "children") {
				if (frame.childIndex < frame.children.length) {
					const child = frame.children[frame.childIndex];
					/* v8 ignore next -- childIndex is bounded by children.length. */
					if (child === void 0) throw new Error("missing schema-value child frame");
					frame.childIndex++;
					frames.push(valueFrame(child.node, child.value, child.path));
					continue;
				}
				if (frame.kind === "oneOf") {
					finish(frame.matches === 1 ? [] : [`"${diagnosticPath(frame.path)}" must match exactly one oneOf branch (matched ${frame.matches})`]);
					continue;
				}
				appendViolations(frame.violations, frame.tailViolations);
				if (frame.violations.length > 0) finish(frame.violations);
				else if (frame.kind === "object") finish(safelyIsJsonValue(frame.value) ? [] : [`"${diagnosticPath(frame.path)}" must be a lossless JSON object`]);
				else finish(safelyIsJsonValue(frame.value) ? [] : [`"${diagnosticPath(frame.path)}" must be a dense lossless JSON array`]);
				continue;
			}
			const nodeType = Object.hasOwn(frame.node, "type") ? frame.node.type : void 0;
			frame.catches = !(nodeType !== void 0 && !SCHEMA_TYPES.includes(nodeType));
			const oneOf = Object.hasOwn(frame.node, "oneOf") ? frame.node.oneOf : void 0;
			if (oneOf !== void 0) {
				frame.kind = "oneOf";
				frame.children = Array.from(oneOf, (branch) => ({
					node: branch,
					value: frame.value,
					path: frame.path
				}));
				frame.childIndex = 0;
				frame.matches = 0;
				frame.phase = "children";
				continue;
			}
			if (nodeType === void 0) {
				finish(safelyIsJsonValue(frame.value) ? [] : losslessValueViolation(frame.path));
				continue;
			}
			switch (nodeType) {
				case "object": {
					if (!isPlainJsonRecord(frame.value)) {
						finish([`"${diagnosticPath(frame.path)}" must be an object`]);
						break;
					}
					const properties = Object.hasOwn(frame.node, "properties") ? frame.node.properties ?? {} : {};
					const violations = [];
					const required = Object.hasOwn(frame.node, "required") ? frame.node.required ?? [] : [];
					for (const key of required) if (!Object.hasOwn(frame.value, key) || frame.value[key] === void 0) violations.push(`missing required property "${propertyPath(frame.path, key)}"`);
					const children = [];
					for (const [key, child] of Object.entries(properties)) {
						if (!Object.hasOwn(frame.value, key) || frame.value[key] === void 0) continue;
						children.push({
							node: child,
							value: frame.value[key],
							path: propertyPath(frame.path, key)
						});
					}
					const tailViolations = [];
					if (Object.hasOwn(frame.node, "additionalProperties") && frame.node.additionalProperties === false) {
						for (const key of Object.keys(frame.value)) if (!Object.hasOwn(properties, key)) tailViolations.push(`"${propertyPath(frame.path, key)}" is not a declared property (additionalProperties: false)`);
					}
					frame.kind = "object";
					frame.children = children;
					frame.childIndex = 0;
					frame.violations = violations;
					frame.tailViolations = tailViolations;
					frame.phase = "children";
					break;
				}
				case "array": {
					if (!Array.isArray(frame.value)) {
						finish([`"${diagnosticPath(frame.path)}" must be an array`]);
						break;
					}
					const items = Object.hasOwn(frame.node, "items") ? frame.node.items : void 0;
					const children = items === void 0 ? [] : frame.value.flatMap((entry, index) => [{
						node: items,
						value: entry,
						path: `${frame.path}[${index}]`
					}]);
					frame.kind = "array";
					frame.children = children;
					frame.childIndex = 0;
					frame.violations = [];
					frame.phase = "children";
					break;
				}
				case "string":
					finish(typeof frame.value === "string" ? checkScalarValue(frame.node, frame.value, frame.path) : [`"${diagnosticPath(frame.path)}" must be a string`]);
					break;
				case "number":
					finish(typeof frame.value !== "number" ? [`"${diagnosticPath(frame.path)}" must be a number`] : !isJsonNumber(frame.value) ? [`"${diagnosticPath(frame.path)}" must be a finite JSON number`] : checkScalarValue(frame.node, frame.value, frame.path));
					break;
				case "integer":
					finish(!isJsonNumber(frame.value) || !Number.isInteger(frame.value) ? [`"${diagnosticPath(frame.path)}" must be an integer`] : checkScalarValue(frame.node, frame.value, frame.path));
					break;
				case "boolean":
					finish(typeof frame.value === "boolean" ? checkScalarValue(frame.node, frame.value, frame.path) : [`"${diagnosticPath(frame.path)}" must be a boolean`]);
					break;
				case "null":
					finish(frame.value === null ? checkScalarValue(frame.node, frame.value, frame.path) : [`"${diagnosticPath(frame.path)}" must be null`]);
					break;
				default: finish(assertNever(nodeType, "JsonSchemaType"));
			}
		} catch (error) {
			let failed = frames.pop();
			while (failed !== void 0 && !failed.catches) failed = frames.pop();
			if (failed === void 0) throw error;
			receive(losslessValueViolation(failed.path));
		}
	}
	/* v8 ignore next -- every root frame finishes or throws. */
	return rootResult ?? losslessValueViolation(path);
}
/**
* Validate a candidate value against an asserted raw schema. The function is
* total for arbitrary values and returns path-qualified violations.
* @param schema - a schema accepted by {@link assertSupportedJsonSchema}.
* @param value - the candidate JSON value.
* @param path - root label used in diagnostics.
* @returns All violations in walk order; empty means valid.
*/
function validateJsonSchemaValue(schema, value, path = "value") {
	return checkValue(schema, value, path);
}
//#endregion
//#region ../../core/tools/src/schema.ts
/** Unified JSON-value schema DSL, inference, compilation, and typed tool helper. @module dsh-tools/schema */
const ANNOTATION_KEYS = [
	"description",
	"title",
	"default",
	"examples"
];
/** Throw one author-schema violation through the shared schema error type. */
function authorError(message) {
	throw new JsonSchemaError([message]);
}
/** Copy own annotation fields for validation by the raw-schema boundary. */
function copyAnnotations(source, target) {
	if (Object.hasOwn(source, "description")) target.description = source.description;
	if (Object.hasOwn(source, "title")) target.title = source.title;
	if (Object.hasOwn(source, "default")) target.default = source.default;
	if (Object.hasOwn(source, "examples")) target.examples = source.examples;
}
/** Reject author-only keys outside one node's declared vocabulary. */
function assertAuthorKeys(source, path, allowed) {
	for (const key of Object.keys(source)) if (!allowed.includes(key)) authorError(`${path}.${key} is not supported by the value schema DSL`);
}
/** Install a compiled node without giving `__proto__` assignment semantics. */
function assignCompiledNode(destination, node) {
	switch (destination.kind) {
		case "root":
			destination.holder.value = node;
			break;
		case "property":
			Object.defineProperty(destination.target, destination.key, {
				value: node,
				enumerable: true,
				configurable: true,
				writable: true
			});
			break;
		case "item":
			destination.target.items = node;
			break;
		case "one-of":
			destination.target[destination.index] = node;
			break;
	}
}
/** Install a compiled property map at its root or containing object node. */
function assignCompiledPropertyMap(destination, compiled) {
	if (destination.kind === "root") destination.holder.value = compiled;
	else destination.target.properties = compiled.properties;
}
/** Execute an author-schema compilation task graph without recursive descent. */
function runSchemaCompiler(initial) {
	const seen = /* @__PURE__ */ new Set();
	const tasks = [initial];
	for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
		if (task.kind === "leave") {
			seen.delete(task.input);
			continue;
		}
		if (task.kind === "property-map-tail") {
			if (task.required.length > 0) {
				task.compiled.required = task.required;
				if (task.destination.kind === "object") task.destination.target.required = task.required;
			}
			continue;
		}
		if (task.kind === "property") {
			if (!isJsonSchemaRecord(task.property)) authorError(`${task.path} must be a value schema object`);
			if (Object.hasOwn(task.property, "required") && task.property.required !== true) authorError(`${task.path}.required must be true when present`);
			if (Object.hasOwn(task.property, "required") && task.property.required === true) task.required.push(task.key);
			tasks.push({
				kind: "value",
				input: task.property,
				path: task.path,
				allowRequired: true,
				destination: {
					kind: "property",
					target: task.properties,
					key: task.key
				}
			});
			continue;
		}
		if (task.kind === "property-map") {
			if (!isJsonSchemaRecord(task.input)) authorError(`${task.path} must be an object of value schemas`);
			if (seen.has(task.input)) authorError(`${task.path} is circular`);
			seen.add(task.input);
			const compiled = { properties: {} };
			const required = [];
			assignCompiledPropertyMap(task.destination, compiled);
			tasks.push({
				kind: "leave",
				input: task.input
			});
			tasks.push({
				kind: "property-map-tail",
				compiled,
				required,
				destination: task.destination
			});
			const entries = Object.entries(task.input);
			for (let index = entries.length - 1; index >= 0; index--) {
				const entry = entries[index];
				/* v8 ignore next -- the loop is bounded by the captured entry count. */
				if (entry === void 0) continue;
				tasks.push({
					kind: "property",
					property: entry[1],
					path: `${task.path}.${entry[0]}`,
					key: entry[0],
					properties: compiled.properties,
					required
				});
			}
			continue;
		}
		const { input, path } = task;
		if (!isJsonSchemaRecord(input)) authorError(`${path} must be a value schema object`);
		if (seen.has(input)) authorError(`${path} is circular`);
		seen.add(input);
		const authorKeys = [...ANNOTATION_KEYS, ...task.allowRequired ? ["required"] : []];
		const node = {};
		assignCompiledNode(task.destination, node);
		tasks.push({
			kind: "leave",
			input
		});
		if (Object.hasOwn(input, "oneOf")) {
			assertAuthorKeys(input, path, [
				...authorKeys,
				"oneOf",
				"type"
			]);
			if (Object.hasOwn(input, "type")) authorError(`${path} cannot declare both type and oneOf`);
			if (!isPlainJsonArray(input.oneOf)) authorError(`${path}.oneOf must be an array of at least two value schemas`);
			const branches = [];
			node.oneOf = branches;
			copyAnnotations(input, node);
			for (let index = input.oneOf.length - 1; index >= 0; index--) tasks.push({
				kind: "value",
				input: input.oneOf[index],
				path: `${path}.oneOf[${index}]`,
				allowRequired: false,
				destination: {
					kind: "one-of",
					target: branches,
					index
				}
			});
			continue;
		}
		const inputType = Object.hasOwn(input, "type") ? input.type : void 0;
		switch (inputType) {
			case "json":
				assertAuthorKeys(input, path, [...authorKeys, "type"]);
				copyAnnotations(input, node);
				break;
			case "object":
				assertAuthorKeys(input, path, [
					...authorKeys,
					"type",
					"properties",
					"additionalProperties"
				]);
				if (!Object.hasOwn(input, "additionalProperties") || typeof input.additionalProperties !== "boolean") authorError(`${path}.additionalProperties must be explicitly true or false`);
				node.type = "object";
				copyAnnotations(input, node);
				node.additionalProperties = input.additionalProperties;
				if (Object.hasOwn(input, "properties")) tasks.push({
					kind: "property-map",
					input: input.properties,
					path: `${path}.properties`,
					destination: {
						kind: "object",
						target: node
					}
				});
				break;
			case "array":
				assertAuthorKeys(input, path, [
					...authorKeys,
					"type",
					"items"
				]);
				node.type = "array";
				copyAnnotations(input, node);
				if (Object.hasOwn(input, "items")) tasks.push({
					kind: "value",
					input: input.items,
					path: `${path}.items`,
					allowRequired: false,
					destination: {
						kind: "item",
						target: node
					}
				});
				break;
			case "string":
			case "number":
			case "integer":
			case "boolean":
			case "null":
				assertAuthorKeys(input, path, [
					...authorKeys,
					"type",
					"enum",
					"const"
				]);
				node.type = inputType;
				copyAnnotations(input, node);
				if (Object.hasOwn(input, "enum")) {
					if (!isPlainJsonArray(input.enum)) authorError(`${path}.enum must be a non-empty array of scalar values`);
					node.enum = Array.from(input.enum, (entry) => entry);
				}
				if (Object.hasOwn(input, "const")) node.const = input.const;
				break;
			default: authorError(`${path}.type must be string/number/integer/boolean/null/array/object/json, or use oneOf`);
		}
	}
}
/** Compile one implicit property map, collecting per-property requiredness. */
function compilePropertyMap(input, path) {
	const holder = {};
	runSchemaCompiler({
		kind: "property-map",
		input,
		path,
		destination: {
			kind: "root",
			holder
		}
	});
	/* v8 ignore next -- the root task assigns before scheduling any descendants. */
	return holder.value ?? authorError(`${path} did not compile`);
}
/** Compile one author node without applying any consumer root restriction. */
function compileValueSchema(input, path) {
	const holder = {};
	runSchemaCompiler({
		kind: "value",
		input,
		path,
		allowRequired: false,
		destination: {
			kind: "root",
			holder
		}
	});
	/* v8 ignore next -- the root task assigns before scheduling any descendants. */
	return holder.value ?? authorError(`${path} did not compile`);
}
/**
* Compile one author-facing value schema to the enforced raw JSON Schema
* subset. The author-only `json` node becomes an annotation-only schema.
* @param spec - schema for any JSON-value root.
* @returns The asserted raw schema projection.
*/
function valueSchemaSpecToJsonSchema(spec) {
	const schema = compileValueSchema(spec, "schema");
	assertSupportedJsonSchema(schema);
	return schema;
}
/**
* Compile the implicit open parameter object into raw JSON Schema.
* @param spec - per-property parameter definitions.
* @returns An object-rooted raw schema with no implicit-root openness override.
*/
function parameterSchemaSpecToJsonSchema(spec) {
	const compiled = compilePropertyMap(spec, "parameters");
	const schema = {
		type: "object",
		properties: compiled.properties,
		...compiled.required === void 0 ? {} : { required: compiled.required }
	};
	assertSupportedJsonSchema(schema);
	return schema;
}
/** Invalid model-generated arguments for a typed tool. */
var ToolArgsError = class extends HarnessError {
	/** Individual violations in schema-walk order. */
	violations;
	constructor(violations) {
		super(`invalid arguments: ${violations.join("; ")}`, "INVALID_ARGS");
		this.name = "ToolArgsError";
		this.violations = violations;
	}
};
/**
* Define a first-party tool with inferred arguments and strict execution
* validation. Replay-only presenters validate softly and fall back to generic
* rendering for obsolete logged arguments.
* @param options - typed definition and optional finalizer and presenters.
* @returns A registry-ready definition.
*/
function defineTool(options) {
	const userExecute = options.execute;
	const userFinalizeContent = options.finalizeContent;
	const userRender = options.output.render;
	const userPresentationMeta = options.output.presentationMeta;
	const userPresentCall = options.presentCall;
	const userPresentResult = options.presentResult;
	const userIsConcurrencySafe = options.isConcurrencySafe;
	if (options.timeoutMs !== void 0 && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) throw new Error(`defineTool(${options.name}): timeoutMs must be a positive finite number`);
	const parameters = parameterSchemaSpecToJsonSchema(options.parameters);
	const outputSchema = valueSchemaSpecToJsonSchema(options.output.schema);
	const validate = (args) => validateJsonSchemaValue(parameters, args, "");
	const tool = {
		name: options.name,
		description: options.description,
		parameters,
		output: {
			schema: outputSchema,
			render(args, value) {
				return userRender(args, value);
			},
			...userPresentationMeta !== void 0 ? { presentationMeta(args, value) {
				return userPresentationMeta(args, value);
			} } : {}
		},
		...options.timeoutMs !== void 0 ? { timeoutMs: options.timeoutMs } : {},
		async execute(args, exec) {
			const violations = validate(args);
			if (violations.length > 0) throw new ToolArgsError(violations);
			return userExecute(args, exec);
		}
	};
	if (userFinalizeContent) tool.finalizeContent = (exec, result) => userFinalizeContent(exec, result);
	if (userPresentCall) tool.presentCall = (args) => {
		if (validate(args).length > 0) return void 0;
		return userPresentCall(args);
	};
	if (userPresentResult) tool.presentResult = (args, result) => {
		if (validate(args).length > 0) return void 0;
		return userPresentResult(args, result);
	};
	if (userIsConcurrencySafe) tool.isConcurrencySafe = (args) => {
		if (validate(args).length > 0) return false;
		return userIsConcurrencySafe(args);
	};
	return tool;
}
//#endregion
//#region ../../core/tools/src/ptc.ts
/**
* PTC mode `run_code` transport. Programs call the registry's agent-visible
* tools through nested executions scheduled under the native concurrency
* contract; each sub-dispatch is logged for reconstruction, while only the
* outer curated result enters model history.
* @module @deepseek-ai/dsh-tools/src/ptc
*/
/** The model-facing name of the PTC mode tool. */
const RUN_CODE_NAME = "run_code";
/**
* The TypeScript flavor: the fallback for a schema read with no runtime
* mounted ({@link resolveFlavor} owns which readers reach that). A real
* assembly always resolves a runtime first, so the model never sees this
* fallback outside its own language.
*/
const TYPESCRIPT_FLAVOR = {
	description: "Execute a TypeScript program against the available tools. Takes two required arguments: `code`, the BODY of an async function (erasable syntax only; top-level `await` and `return` work), and `description`, a short summary of what the program does. Call tools as `await tools.name(args)` per the declarations in the system prompt. Only what you print or return is program output — curate it. Image-bearing subtool results are attached after the run.",
	codeDescription: "The program: the body of an async TypeScript function."
};
/** Per-language `run_code` schema flavors (see {@link RunCodeFlavor}); one entry per {@link CodeSdkLanguage}. */
const RUN_CODE_FLAVORS = {
	typescript: TYPESCRIPT_FLAVOR,
	python: {
		description: "Execute a Python program against the available tools. Takes two required arguments: `code`, the BODY of an async function (top-level `await` and `return` work), and `description`, a short summary of what the program does. Call tools as `await tools.name(args)` per the declarations in the system prompt. Use `print(...)` and/or `return <value>` for program output — curate it. Image-bearing subtool results are attached after the run.",
		codeDescription: "The program: the body of an async Python function."
	}
};
/**
* The `description` parameter's model-facing description: language-independent
* (the UI label contract is the same for every runtime), shared between the
* static spec and the language-aware `parameters` getter so the two emissions
* can never drift.
*/
const RUN_CODE_DESCRIPTION_PARAM_DESCRIPTION = "Clear, concise description of what this program does in active voice, 5-10 words (shown in the UI). Examples: \"Count TODO markers across packages\"; \"Read failing test and its fixture\"; \"Rename config key in every cordis.yml\".";
/**
* Resolve the {@link RunCodeFlavor} for the loaded runtime's language, read at
* schema-emission time so the model-visible `run_code` schema always matches
* the SDK section's language. `peekRuntime` returns `undefined` only when no
* runtime is mounted, which reaches this function through definition readers
* and `schemas()` — the doc-catalog harvest is the only shipped one, and none
* of them feeds a model, because `wireSchemas` calls `requireCodeRuntime`
* before projecting — so that path degrades to {@link TYPESCRIPT_FLAVOR}. A
* mounted runtime whose language has no flavor entry fails loud, exactly as
* `requireCodeRuntime` rejects it at assembly. Keeping this table in step with
* `SDK_RENDERERS` is the compiler's job ({@link CodeSdkLanguage}); what this
* guard owns is the runtime-supplied language neither table knows, which never
* yields a wrong-language schema for a real runtime.
*/
function resolveFlavor(peekRuntime) {
	const runtime = peekRuntime();
	if (runtime === void 0) return TYPESCRIPT_FLAVOR;
	const flavor = RUN_CODE_FLAVORS[runtime.language];
	if (!Object.hasOwn(RUN_CODE_FLAVORS, runtime.language) || flavor === void 0) {
		const known = Object.keys(RUN_CODE_FLAVORS).map((name) => JSON.stringify(name)).join(", ");
		throw new Error(`dsh-tools: no run_code schema flavor registered for runtime language ${JSON.stringify(runtime.language)} (known: ${known})`);
	}
	return flavor;
}
/**
* Thrown by `run_code` when the program run itself failed — a program
* exception, a budget expiry, an abort, or substrate death. Extends
* {@link HarnessError} (`code: 'CODE_RUN_FAILED'`); the registry's execution
* pipeline converts it into a structured `isError` result whose text carries
* the failure kind plus the captured logs, so the model can self-correct.
*/
var CodeRunFailedError = class extends HarnessError {
	constructor(message) {
		super(message, "CODE_RUN_FAILED");
		this.name = "CodeRunFailedError";
	}
};
/**
* Snapshot one binding call's argument as lossless JSON, then snapshot that
* detached value again so dispatch and logging stay independent without
* reintroducing structured-clone's platform-specific nesting limit.
*/
function jsonNormalizeArgs(value) {
	let snapshot;
	try {
		snapshot = snapshotJsonValue(value);
	} catch (error) {
		throw new Error(`tool arguments must be lossless JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (snapshot === void 0) throw new Error("tool arguments must be lossless JSON (call the tool with an arguments object, e.g. `{}`)");
	const logged = snapshotJsonValue(snapshot);
	/* v8 ignore next -- snapshot is already a detached lossless JSON value. */
	if (logged === void 0) throw new Error("tool arguments could not be detached for durable logging");
	return {
		dispatched: snapshot,
		logged
	};
}
/** Two-space JSON presentation, matching the existing shallow `run_code` text contract. */
const JSON_INDENT = "  ";
/**
* ECMAScript caps `JSON.stringify`'s `space` string at ten characters. The
* renderer also caps TOTAL indentation there, compacting deeper subtrees, so
* formatted output remains linear in the canonical JSON size.
*/
const MAX_JSON_INDENT_CHARS = 10;
/** Render one non-string JSON root without recursive traversal or unbounded indentation growth. */
function renderJsonValue(value) {
	const chunks = [];
	const tasks = [{
		kind: "value",
		value,
		depth: 0,
		compact: false
	}];
	for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
		if (task.kind === "text") {
			chunks.push(task.text);
			continue;
		}
		const current = task.value;
		if (current === null || typeof current === "boolean" || typeof current === "number") {
			chunks.push(String(current));
			continue;
		}
		if (typeof current === "string") {
			chunks.push(JSON.stringify(current));
			continue;
		}
		const compact = task.compact || (task.depth + 1) * 2 > MAX_JSON_INDENT_CHARS;
		const childDepth = task.depth + 1;
		if (Array.isArray(current)) {
			chunks.push("[");
			if (current.length === 0) {
				chunks.push("]");
				continue;
			}
			tasks.push({
				kind: "text",
				text: compact ? "]" : `\n${JSON_INDENT.repeat(task.depth)}]`
			});
			for (let index = current.length - 1; index >= 0; index--) {
				const item = current[index];
				/* v8 ignore next -- canonical JsonValue arrays are dense. */
				if (item === void 0) throw new Error("cannot render a sparse JSON array");
				tasks.push({
					kind: "value",
					value: item,
					depth: childDepth,
					compact
				});
				tasks.push({
					kind: "text",
					text: compact ? index === 0 ? "" : "," : `${index === 0 ? "\n" : ",\n"}${JSON_INDENT.repeat(childDepth)}`
				});
			}
			continue;
		}
		const keys = Object.keys(current);
		chunks.push("{");
		if (keys.length === 0) {
			chunks.push("}");
			continue;
		}
		tasks.push({
			kind: "text",
			text: compact ? "}" : `\n${JSON_INDENT.repeat(task.depth)}}`
		});
		for (let index = keys.length - 1; index >= 0; index--) {
			const key = keys[index];
			/* v8 ignore next -- the loop is bounded by the captured key count. */
			if (key === void 0) throw new Error("cannot render a missing JSON object key");
			const item = current[key];
			/* v8 ignore next -- canonical JsonValue records contain no undefined properties. */
			if (item === void 0) throw new Error("cannot render an undefined JSON object property");
			tasks.push({
				kind: "value",
				value: item,
				depth: childDepth,
				compact
			});
			tasks.push({
				kind: "text",
				text: compact ? `${index === 0 ? "" : ","}${JSON.stringify(key)}:` : `${index === 0 ? "\n" : ",\n"}${JSON_INDENT.repeat(childDepth)}${JSON.stringify(key)}: `
			});
		}
	}
	return chunks.join("");
}
/** Render one present program completion value for the model-facing result text. */
function renderValue(value) {
	return typeof value === "string" ? value : renderJsonValue(value);
}
/**
* Build the `run_code` {@link ToolDefinition}: required `code` and
* `description` parameters, executed through the dispatch bridge described
* above. The
* registry reserves it as presentation infrastructure under non-native modes,
* outside the filterable global/scoped capability layers.
* @param registry - the owning registry (sub-calls go through its `execute`,
*   bindings cover its registered tools).
* @param options - the registry-private capabilities described above.
* @returns the registry-ready definition.
*/
function createRunCodeTool(registry, options) {
	const { requireRuntime, peekRuntime, maxParallel, shapeDispatchLog } = options;
	const definition = defineTool({
		name: RUN_CODE_NAME,
		description: TYPESCRIPT_FLAVOR.description,
		parameters: {
			code: {
				type: "string",
				required: true,
				description: TYPESCRIPT_FLAVOR.codeDescription
			},
			description: {
				type: "string",
				required: true,
				description: RUN_CODE_DESCRIPTION_PARAM_DESCRIPTION
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					logs: {
						type: "array",
						required: true,
						items: { type: "string" }
					},
					result: { type: "json" }
				}
			},
			render: (_args, value) => {
				const rendered = value.result === void 0 ? "" : renderValue(value.result);
				const parts = [value.logs.join("\n"), rendered].filter((part) => part.length > 0);
				return [{
					type: "text",
					text: parts.length > 0 ? parts.join("\n") : "(run_code completed with no output)"
				}];
			}
		},
		async execute(args, exec) {
			if (args.description.trim().length === 0) throw new Error("invalid description: expected a non-empty string");
			const runtime = requireRuntime();
			const runController = new AbortController();
			const onOuterAbort = () => {
				runController.abort(exec.signal.reason);
			};
			exec.signal.addEventListener("abort", onOuterAbort, { once: true });
			let dispatches = 0;
			const pendingQueue = [];
			const inFlight = /* @__PURE__ */ new Set();
			/** Tracked settle-event side work (log-content listener + append), drained at run settlement. */
			const logWork = /* @__PURE__ */ new Set();
			const commitQueue = [];
			let exclusiveActive = false;
			let driving = false;
			let driverRun = Promise.resolve();
			let wake;
			const wakeup = () => {
				const release = wake;
				wake = void 0;
				release?.();
			};
			/**
			* The single ordered lane. Each pass commits the head-of-line settled
			* dispatch (ordered post-execute), then starts the next queued entry if
			* its slot is free (ordered pre-execute), and otherwise sleeps until a
			* body settles or a new submission arrives. One run reaching the
			* empty-queues/empty-pool state is quiescence.
			*/
			const drive = () => {
				if (driving) return driverRun;
				driving = true;
				driverRun = (async () => {
					try {
						for (;;) {
							const signal = new Promise((resolve) => {
								wake = resolve;
							});
							const commitHead = commitQueue[0];
							if (commitHead !== void 0 && commitHead.settled) {
								commitQueue.shift();
								await commitHead.commit();
								if (commitHead.mode === "exclusive") exclusiveActive = false;
								continue;
							}
							const head = pendingQueue[0];
							if (head !== void 0) {
								if (runController.signal.aborted) {
									pendingQueue.shift();
									head.abandon();
									continue;
								}
								const mode = head.classify();
								if (!exclusiveActive && (mode === "exclusive" ? inFlight.size === 0 : inFlight.size < maxParallel)) {
									if (mode === "exclusive") exclusiveActive = true;
									head.mode = mode;
									pendingQueue.shift();
									commitQueue.push(head);
									await head.start();
									const flight = head.flight.finally(() => {
										inFlight.delete(flight);
										wakeup();
									});
									inFlight.add(flight);
									continue;
								}
							}
							if (pendingQueue.length === 0 && commitQueue.length === 0 && inFlight.size === 0) return;
							await signal;
						}
					} finally {
						driving = false;
						wake = void 0;
					}
				})();
				return driverRun;
			};
			/** Every dispatch settled AND committed; nothing can start (the run is aborted at call time). */
			const drainDispatches = async () => {
				await drive();
				while (logWork.size > 0) await Promise.allSettled([...logWork]);
			};
			const runOver = () => runController.signal.aborted;
			const binding = (name) => async (rawArgs) => {
				if (runOver()) throw new Error(`run_code run is over (${String(runController.signal.reason)}); ${name} not dispatched`);
				const normalized = jsonNormalizeArgs(rawArgs);
				const n = ++dispatches;
				const subCallId = brandString(`${String(exec.callId)}:ptc:${n}`);
				const input = {
					callId: subCallId,
					rootCallId: exec.rootCallId,
					name,
					arguments: normalized.dispatched,
					...exec.agent ? { agent: exec.agent } : {},
					parent: exec.token,
					signal: runController.signal
				};
				const scheduler = registry[TOOL_RUNTIME_SCHEDULER];
				const outcome = await new Promise((resolve, reject) => {
					let parked;
					const settle = (result) => {
						resolve(result.isError ? {
							isError: true,
							message: result.error.message
						} : {
							isError: false,
							value: result.value
						});
						const agent = exec.agent;
						if (agent === void 0) return;
						const task = (async () => {
							const logged = await shapeDispatchLog({
								exec,
								agent,
								subCallId,
								name,
								isError: result.isError,
								content: result.content
							});
							agent.session.append("tool/ptc-dispatch", {
								rootCallId: exec.rootCallId,
								parentCallId: exec.callId,
								subCallId,
								name,
								arguments: normalized.logged,
								isError: result.isError,
								content: logged
							});
						})().finally(() => {
							logWork.delete(task);
						});
						logWork.add(task);
					};
					pendingQueue.push({
						flight: Promise.resolve(),
						settled: false,
						classify: () => registry.executionMode(input).kind,
						abandon: () => {
							reject(/* @__PURE__ */ new Error(`run_code run is over (${String(runController.signal.reason)}); ${name} tool call abandoned`));
						},
						async start() {
							exec.agent?.session.append("tool/ptc-dispatch-start", {
								rootCallId: exec.rootCallId,
								parentCallId: exec.callId,
								subCallId,
								name,
								arguments: normalized.logged
							});
							const prepared = await scheduler.prepare(input);
							if (prepared.kind === "dispatch") {
								this.flight = scheduler.dispatch(prepared.exec).then((dispatchOutcome) => {
									parked = {
										kind: dispatchOutcome.kind,
										exec: prepared.exec,
										result: dispatchOutcome.result
									};
									this.settled = true;
								});
								return;
							}
							parked = {
								kind: prepared.kind,
								exec: prepared.exec,
								result: prepared.result
							};
							this.settled = true;
						},
						async commit() {
							/* v8 ignore next -- commit() runs only after `settled` flipped, which set parked. */
							if (parked === void 0) return;
							const result = parked.kind === "post-result" ? await scheduler.finalize(parked.exec, parked.result) : scheduler.finish(parked.exec, parked.result);
							if (!result.isError && result.content.some((block) => block.type === "image")) exec.deferContext(createUserMessage({
								content: result.content,
								source: {
									kind: "plugin",
									plugin: "tools-ptc"
								}
							}));
							for (const context of result.additionalContexts ?? []) exec.deferContext(context);
							if (result.concludesTurn) exec.concludeTurn();
							settle(result);
							while (logWork.size > maxParallel) await Promise.race(logWork);
						}
					});
					wakeup();
					drive();
				});
				if (runOver()) throw new Error(`run_code run is over (${String(runController.signal.reason)}); ${name} result discarded`);
				if (outcome.isError) throw new Error(outcome.message);
				return outcome.value;
			};
			const functions = Object.create(null);
			for (const schema of registry.schemas(exec.agent)) {
				if (schema.name === "run_code") continue;
				Object.defineProperty(functions, schema.name, {
					enumerable: true,
					value: binding(schema.name)
				});
			}
			try {
				let result;
				try {
					result = await runtime.run({
						program: args.code,
						bindings: [{
							global: "tools",
							functions,
							errorClass: {
								name: "ToolCallError",
								memberNameProperty: "toolName"
							}
						}],
						signal: runController.signal
					});
				} finally {
					runController.abort("run_code settled");
					await drainDispatches();
				}
				if (result.error) {
					const logsText = result.logs.length > 0 ? `\nCaptured output:\n${result.logs.join("\n")}` : "";
					throw new CodeRunFailedError(`code run failed (${result.error.kind}): ${result.error.message}${logsText}`);
				}
				return {
					logs: result.logs,
					...result.value !== void 0 ? { result: result.value } : {}
				};
			} finally {
				exec.signal.removeEventListener("abort", onOuterAbort);
			}
		},
		presentCall: (args) => ({
			card: "generic",
			title: args.description,
			kind: "execute",
			rawInput: args.code
		})
	});
	Object.defineProperty(definition, "description", {
		enumerable: true,
		get: () => resolveFlavor(peekRuntime).description
	});
	Object.defineProperty(definition, "parameters", {
		enumerable: true,
		get: () => parameterSchemaSpecToJsonSchema({
			code: {
				type: "string",
				required: true,
				description: resolveFlavor(peekRuntime).codeDescription
			},
			description: {
				type: "string",
				required: true,
				description: RUN_CODE_DESCRIPTION_PARAM_DESCRIPTION
			}
		})
	});
	return definition;
}
//#endregion
//#region ../../core/tools/src/ts-types.ts
/** Property names that are valid bare TS identifiers; anything else is quoted. */
const IDENTIFIER$1 = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
/** Render an object key: bare when it is a valid identifier, quoted otherwise (every name stays reachable, no aliasing). */
function renderKey(name) {
	return IDENTIFIER$1.test(name) ? name : JSON.stringify(name);
}
/** One `indent`-deep line prefix (two spaces per level). */
function pad$1(indent) {
	return "  ".repeat(indent);
}
/** A one-line JSDoc block for a schema `description`, or no lines when there is none. */
function docLines$1(description, indent) {
	if (typeof description !== "string" || description.length === 0) return [];
	const collapsed = description.replace(/\s+/g, " ").trim();
	return [`${pad$1(indent)}/** ${collapsed.replaceAll("*/", String.raw`*\/`)} */`];
}
/** Render one scalar already validated by the unified schema boundary. */
function renderScalar(value) {
	return JSON.stringify(value);
}
/** Render a validated scalar `const`/`enum`, falling back to the broad type. */
function renderConstrainedScalar$1(node, type) {
	const broad = type === "integer" ? "number" : type;
	if (Object.hasOwn(node, "const")) return renderScalar(node.const);
	if (Object.hasOwn(node, "enum")) return node.enum.map(renderScalar).join(" | ");
	return broad;
}
/** Build one document from captured parts while retaining the legacy array-parenthesization test. */
function typeDocumentFrom(parts) {
	return {
		parts,
		containsUnionOrIntersection: parts.some((part) => typeof part === "string" ? part.includes("|") || part.includes("&") : part.containsUnionOrIntersection)
	};
}
/** Build a small document without an intermediate array at each call site. */
function typeDocument(...parts) {
	return typeDocumentFrom(parts);
}
/** Flatten a nested document with an explicit work stack. */
function flattenTypeDocument(document) {
	const chunks = [];
	const tasks = [document];
	for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
		if (typeof task === "string") {
			chunks.push(task);
			continue;
		}
		for (let index = task.parts.length - 1; index >= 0; index--) {
			const part = task.parts[index];
			/* v8 ignore next -- the loop is bounded by the captured part count. */
			if (part !== void 0) tasks.push(part);
		}
	}
	return chunks.join("");
}
/** Initialize one schema-render frame with empty aggregation state. */
function schemaRenderFrame(node, indent) {
	return {
		node,
		indent,
		phase: "start",
		children: [],
		childIndex: 0,
		childDocuments: [],
		entries: []
	};
}
/** Render an already asserted schema to a composable document. */
function renderSupportedSchema(schema, indent) {
	const frames = [schemaRenderFrame(schema, indent)];
	let rootDocument;
	const finish = (document) => {
		frames.pop();
		const parent = frames.at(-1);
		if (parent === void 0) rootDocument = document;
		else parent.childDocuments.push(document);
	};
	while (frames.length > 0) {
		const frame = frames.at(-1);
		/* v8 ignore next -- the loop condition guarantees a current frame. */
		if (frame === void 0) break;
		if (frame.phase === "children") {
			if (frame.childIndex < frame.children.length) {
				const child = frame.children[frame.childIndex];
				/* v8 ignore next -- childIndex is bounded by children.length. */
				if (child === void 0) throw new Error("missing schema render child");
				frame.childIndex++;
				frames.push(schemaRenderFrame(child.node, child.indent));
				continue;
			}
			if (frame.kind === "oneOf") {
				const parts = [];
				for (let index = 0; index < frame.childDocuments.length; index++) {
					if (index > 0) parts.push(" | ");
					const child = frame.childDocuments[index];
					/* v8 ignore next -- child documents correspond one-to-one with children. */
					if (child !== void 0) parts.push(child);
				}
				finish(typeDocumentFrom(parts));
				continue;
			}
			if (frame.kind === "array") {
				const child = frame.childDocuments[0];
				/* v8 ignore next -- array frames always schedule exactly one child. */
				if (child === void 0) throw new Error("missing array item type");
				finish(child.containsUnionOrIntersection ? typeDocument("(", child, ")[]") : typeDocument(child, "[]"));
				continue;
			}
			const required = new Set(frame.node.required);
			const parts = ["{"];
			for (let index = 0; index < frame.entries.length; index++) {
				const entry = frame.entries[index];
				const child = frame.childDocuments[index];
				/* v8 ignore next -- object entries and child documents have the same length. */
				if (entry === void 0 || child === void 0) throw new Error("missing object property type");
				const [name, prop] = entry;
				for (const line of docLines$1(prop.description, frame.indent + 1)) parts.push("\n", line);
				parts.push("\n", `${pad$1(frame.indent + 1)}${renderKey(name)}${required.has(name) ? "" : "?"}: `, child, ";");
			}
			parts.push("\n", `${pad$1(frame.indent)}}`);
			const declared = typeDocumentFrom(parts);
			finish(frame.node.additionalProperties === false ? declared : typeDocument(declared, " & Record<string, JsonValue>"));
			continue;
		}
		const node = frame.node;
		if (node.oneOf !== void 0) {
			frame.kind = "oneOf";
			frame.children = Array.from(node.oneOf, (child) => ({
				node: child,
				indent: frame.indent
			}));
			frame.childIndex = 0;
			frame.childDocuments = [];
			frame.phase = "children";
			continue;
		}
		if (node.type === void 0) {
			finish(typeDocument("JsonValue"));
			continue;
		}
		switch (node.type) {
			case "string":
			case "number":
			case "integer":
			case "boolean":
			case "null":
				finish(typeDocument(renderConstrainedScalar$1(node, node.type)));
				break;
			case "array":
				if (node.items === void 0) finish(typeDocument("JsonValue[]"));
				else {
					frame.kind = "array";
					frame.children = [{
						node: node.items,
						indent: frame.indent
					}];
					frame.childIndex = 0;
					frame.childDocuments = [];
					frame.phase = "children";
				}
				break;
			case "object": {
				const open = node.additionalProperties !== false;
				const entries = Object.entries(node.properties ?? {});
				if (entries.length === 0) finish(typeDocument(open ? "Record<string, JsonValue>" : "Record<string, never>"));
				else {
					frame.kind = "object";
					frame.entries = entries;
					frame.children = entries.map(([, child]) => ({
						node: child,
						indent: frame.indent + 1
					}));
					frame.childIndex = 0;
					frame.childDocuments = [];
					frame.phase = "children";
				}
				break;
			}
			/* v8 ignore next -- assertSupportedJsonSchema narrowed this closed type union. */
			default: finish(typeDocument("unknown"));
		}
	}
	/* v8 ignore next -- every root frame produces one document. */
	return rootDocument ?? typeDocument("unknown");
}
/**
* Map one enforced JSON-Schema node to a TypeScript type literal. Supports
* every unified schema construct and returns `unknown` for malformed or
* unsupported inputs without throwing.
* @param schema - the JSON-Schema node (any shape; hostile inputs degrade).
* @param indent - the indentation level for nested object members.
* @returns the TS type text (multi-line for objects with properties).
*/
function jsonSchemaToTs(schema, indent = 0) {
	try {
		assertSupportedJsonSchema(schema);
		return flattenTypeDocument(renderSupportedSchema(schema, indent));
	} catch {
		return "unknown";
	}
}
/** The fixed model-facing usage contract rendered above the declarations (see the PTC mode Agent Note's "What the model sees"). */
const SDK_INSTRUCTIONS$1 = `## Writing code for run_code

\`run_code\` takes two required arguments: \`code\` — the body of an async TypeScript function (erasable syntax only — no \`enum\` or namespaces; type annotations are advisory, the code runs type-stripped) — and \`description\`, a short summary of what the program does. The declarations below are SDK bindings for this program. A declaration does not make its name a directly callable tool; only names supplied as separate tool schemas may be called directly.`;
const SDK_PROGRAM_INSTRUCTIONS = `Inside the program:

- Call tools as \`await tools.name(args)\` — quoted access for exotic names: \`tools["my-tool"](args)\`. Every call resolves to the tool's typed canonical JSON value. Tool arguments must be lossless JSON.
- A FAILED tool call rejects with \`ToolCallError\`, whose \`toolName\` identifies the failed tool and whose \`message\` is human-readable — \`try/catch\` it to handle and continue.
- Independent read-only calls MAY overlap under \`Promise.all\` (safe calls run concurrently; mutating calls run alone, in submission order). Sequence dependent work with \`await\`.
- Emit results with \`return\` and/or \`console.log(...)\`. Only what you print or return is program output. A successful tool result containing an image is attached after the run so you can inspect it on the next step; every other intermediate result stays out of the conversation, so extract just what you need.

Program-only SDK bindings:`;
/** Whether one string schema accepts the literal used by the bash example. */
function acceptsExampleString(schema, value) {
	return schema?.type === "string" && (schema.const === void 0 || schema.const === value) && (schema.enum === void 0 || schema.enum.includes(value));
}
/** Render the bash example only when its literal arguments satisfy the current parameter schema. */
function renderBashExample(schemas) {
	const bash = schemas.find((schema) => schema.name === "bash");
	if (bash === void 0) return "";
	const parameters = bash.parameters;
	if (parameters.type !== "object") return "";
	const required = parameters.required ?? [];
	if (required.some((name) => name !== "command" && name !== "description")) return "";
	if (!acceptsExampleString(parameters.properties?.command, "pwd")) return "";
	const needsDescription = required.includes("description");
	if (needsDescription && !acceptsExampleString(parameters.properties?.description, "Show current directory")) return "";
	return ` When no separate \`bash\` schema is supplied, invoke a declared \`bash\` binding inside \`run_code\`:\n\n\`run_code({ code: "return await tools.bash({ command: 'pwd'${needsDescription ? ", description: 'Show current directory'" : ""} })", description: "Show current directory" })\``;
}
/**
* Render the full `tools:sdk` prompt section: the fixed usage instructions
* plus one `declare const tools` interface covering every given tool.
* Deterministic — tools are emitted in lexicographic name order, so an
* unchanged tool set produces byte-identical text across assemblies. The sort
* is not a total order on byte-equal names, so two schemas sharing a name
* would render in argument order; the caller's visible-capability map is keyed
* by name, so the input never carries a duplicate.
* @param schemas - the tool schemas to declare (the caller excludes
*   `run_code` itself).
* @returns the complete section text.
*/
function renderToolsSdk(schemas) {
	const sorted = [...schemas].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
	const argsMembers = [];
	const outputMembers = [];
	for (const schema of sorted) {
		argsMembers.push(...docLines$1(schema.description, 1));
		argsMembers.push(`${pad$1(1)}${renderKey(schema.name)}: ${jsonSchemaToTs(schema.parameters, 1)};`);
		outputMembers.push(`${pad$1(1)}${renderKey(schema.name)}: ${jsonSchemaToTs(schema.output, 1)};`);
	}
	const declaration = [
		`interface ToolArgsMap {${argsMembers.length > 0 ? `\n${argsMembers.join("\n")}\n` : ""}}`,
		`interface ToolOutputMap {${outputMembers.length > 0 ? `\n${outputMembers.join("\n")}\n` : ""}}`,
		"type ToolName = keyof ToolOutputMap",
		[
			"declare class ToolCallError extends Error {",
			"  readonly name: \"ToolCallError\";",
			"  readonly toolName: ToolName;",
			"}"
		].join("\n"),
		[
			"declare const tools: {",
			"  [K in ToolName]: (args: ToolArgsMap[K]) => Promise<ToolOutputMap[K]>;",
			"}"
		].join("\n")
	].join("\n\n");
	return `${SDK_INSTRUCTIONS$1}${renderBashExample(sorted)}\n\n${SDK_PROGRAM_INSTRUCTIONS}\n\n\`\`\`ts\ntype JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }\n\n${declaration}\n\`\`\``;
}
//#endregion
//#region ../../core/tools/src/py-types.ts
/**
* PTC mode codegen — Python flavor. The pure projection from registered tool schemas to the
* Python SDK text the model programs against under `runtime.language === 'python'`. Sibling of
* {@link ./ts-types.ts | ts-types.ts}; the two files are two projections of the same registry
* store, keyed by the loaded {@link @deepseek-ai/dsh-code-runtime#CodeRuntime.language | code
* runtime's language}.
*
* Under `mode: 'ptc'` the native tool schemas are omitted from the request, so this generated
* SDK is the model's ONLY source for each tool's argument names, required fields, types,
* descriptions, and canonical output shapes; under `mode: 'both'` the native schemas ship
* alongside it and it is one of two. Object-shaped arguments and outputs therefore render as one
* named `TypedDict` per tool (and per nested object), not an opaque `dict[str, Any]`, so the
* shape survives into the program under the mode that has nothing else to carry it.
* @module @deepseek-ai/dsh-tools/src/py-types
*/
/**
* The reference grammar's `xid_start xid_continue*` — the set
* `str.isidentifier()` accepts on a CPython whose Unicode tables match the
* engine's. See {@link isBareIdentifier} for what a version skew does.
*/
const IDENTIFIER = /^[\p{XID_Start}_]\p{XID_Continue}*$/u;
/**
* Whether a name can be emitted as a bare Python identifier rather than
* routed to the subscript/`dict[str, Any]` path.
*
* Python identifiers are not ASCII: `路径` is as legal a field name as `path`,
* and rejecting it would degrade the whole enclosing object, dropping every
* field's name, requiredness, and type — information whose only source under
* `mode: 'ptc'` is this generated text.
*
* NFKC stability is a second and separate condition, because CPython
* normalizes identifiers at compile time while JSON keys are compared as
* written: `ﬁeld` would be declared and reachable as `field`, so the SDK would
* advertise a key under a spelling the harness never accepts, and two keys
* that normalize together would collapse into one declaration. Those names
* take the subscript path, which carries their exact bytes.
*
* `IDENTIFIER` matches `str.isidentifier()` (measured on Node 22.23.1 vs
* CPython 3.9.6 tables): the equivalence holds inside the two versions' shared
* tables, and the skew characters below are exactly where that pair diverges.
* The predicate as a whole is deliberately stricter than `isidentifier()`,
* which does not test NFKC stability: `'ﬁeld'.isidentifier()` is True and
* this returns false.
*
* Both conditions are evaluated against the ENGINE's Unicode tables, and the
* two sides are versioned independently — `\p{XID_Start}`/`\p{XID_Continue}`
* follow the running engine (Node 22.23.1 reports Unicode 17.0) while CPython
* follows its own (3.9.6 reports 13.0.0). The skew is not symmetric. A CPython
* older than the engine is the dangerous direction: a character added to either
* property since its tables (U+10570 Vithkuqi and U+1E290 Toto, 14.0; U+1E4D0
* Nag Mundari, 15.0; U+1C89 Cyrillic TJE, 16.0 — ages per `DerivedAge.txt`; all
* four are NFKC-stable and accepted here, and all four are `Cn` on that 3.9.6,
* which rejects them) is emitted bare and its tokenizer refuses the character,
* taking the whole SDK block down — the same parseability invariant
* {@link UNPRINTABLE}, {@link LONE_SURROGATE} and {@link MAX_LIST_NESTING}
* exist for. Both properties carry it: a character added only to `XID_Continue`
* passes the trailing `\p{XID_Continue}*` in a tail position and fails the same
* way — U+200C ZWNJ and U+200D ZWJ are that case, gaining `XID_Continue` in UCD
* 15.1 and absent from it in 13.0.0, 14.0.0 and 15.0.0, so `a\u{200C}b` is
* emitted bare here while `isidentifier()` is False on 3.9.6 and on 3.12.13
* (15.0.0). A CPython newer than the engine only routes a legal name to the
* subscript/`dict[str, Any]` path: less readable, still correct. The NFKC
* condition reduces to the same skew, since normalization stability guarantees
* an assigned character's normalization never changes afterwards.
*
* This predicate is not the only reader of engine tables. {@link camelCase}
* reads them at three further points — its split set, its head test, and its
* `toUpperCase()` case mapping — and this predicate's verdict gates none of
* them: a class name derived there reaches emitted text whenever any object
* shape in the tool's schema declares a `TypedDict`, including for a tool this
* predicate rejected. A tool named `zz-\u{1E4D0}x` with such parameters never
* reaches the skew here (the `-` rejects it outright) yet emits `class
* Zz\u{1E4D0}xArgs`, which that same 3.9.6 refuses — Nag Mundari arrived two
* releases after its tables. The case mapping is a separate table rather than
* an XID membership test, and it fails on names both conditions above accept:
* `\u{019B}` is XID_Start and NFKC-stable, so this predicate accepts it and
* `async def \u{019B}` compiles on 3.9.6, but Node uppercases it to
* `\u{A7DC}` — unassigned in that CPython, whose own `.upper()` is the identity
* here — and the declared `class \u{A7DC}Args` fails with `invalid
* non-printable character U+A7DC`. Closing the exposure therefore covers all
* four read points, not this predicate alone; it needs the target interpreter's
* version, which the backend reporting `language: 'python'` owns; the
* language-dispatch Agent Note records the deferral.
*
* The `ts-types` sibling keeps its own ASCII rule rather than sharing this
* one: ECMAScript identifiers are a different set (`$`) and are never
* normalized, so one predicate cannot be correct for both. ZWJ/ZWNJ are not
* part of that difference — both sets carry them on the engine's tables; what
* separates the two there is the CPython table version above.
* @param name - the raw schema field or tool name.
* @returns whether the name can be emitted bare.
*/
function isBareIdentifier(name) {
	return IDENTIFIER.test(name) && name.normalize("NFKC") === name;
}
/**
* Python hard keywords: reserved everywhere, so a tool or field named
* ``class`` or ``lambda`` is legal on the wire but not as an attribute
* (``tools.class`` would be a SyntaxError in the model program) and not as a
* class-syntax `TypedDict` field. Such a tool renders under subscript access
* and such an object degrades to ``dict[str, Any]`` — the model still reaches
* every tool and field without collisions.
* Soft keywords (``match``, ``case``, ``type``, ``_`` — the language
* reference's whole set) are deliberately ABSENT: each is special in exactly
* one syntactic position — a statement head (``match``, ``type``), a ``match``
* statement's clause head (``case``), or a pattern (``_``) — so ``match: str``
* as a field and ``async def match(...)`` as a method are both legal, and
* including them would needlessly degrade common search/regex tool fields to
* ``dict[str, Any]``. Underscore-leading names are handled separately, not
* here: a non-dunder ``__token`` name-mangles, a dunder present on
* ``object``/``type`` resolves before the proxy hook, and implicit
* special-method lookup bypasses the hook.
*/
const RESERVED = new Set([
	"False",
	"None",
	"True",
	"and",
	"as",
	"assert",
	"async",
	"await",
	"break",
	"class",
	"continue",
	"def",
	"del",
	"elif",
	"else",
	"except",
	"finally",
	"for",
	"from",
	"global",
	"if",
	"import",
	"in",
	"is",
	"lambda",
	"nonlocal",
	"not",
	"or",
	"pass",
	"raise",
	"return",
	"try",
	"while",
	"with",
	"yield",
	"__debug__"
]);
/** `typing` symbols this module may emit, in the deterministic import order. */
const TYPING_ORDER = [
	"Any",
	"Literal",
	"NotRequired",
	"Protocol",
	"TypedDict"
];
/** `indent`-deep line prefix (four spaces per level to match PEP 8 output). */
function pad(indent) {
	return "    ".repeat(indent);
}
/**
* The `Cc` code points that survive the whitespace collapse in {@link describe}
* and have no printable form: the C0 controls, DEL, and the C1 controls. Only
* U+0009 to U+000D are absent, because ECMAScript `\s` already collapsed them —
* `\s` is TAB/VT/FF/SP/NBSP/ZWNBSP/Zs plus LF/CR/LS/PS, so no C1 code point is
* in it and the whole U+0080 to U+009F block reaches this rule intact. Those
* are not hypothetical input: they are what Windows-1252 bytes 0x80 to 0x9F
* (smart quotes, em dash) become when decoded as Latin-1.
* CPython rejects source containing a NUL outright
* (`SyntaxError: source code string cannot contain null bytes`), whether it
* sits in a docstring or in a comment, so one such byte anywhere in a schema
* description would make the whole generated SDK unparseable — under
* `mode: 'ptc'`, the model's only declaration of the tools. The rest are
* legal but invisible; escaping them with the same rule keeps the emitted text
* readable and the treatment uniform.
*
* The boundary is the category, not per-code-point addressability: `\xNN`
* addresses U+0000 to U+00FF, so one escape form covers `Cc` exactly. The
* invisible `Cf` formatting characters pass through by design — of them only
* U+00AD soft hyphen would fit `\xNN` at all, and escaping that one while
* U+200B ZWSP, U+200E/U+200F bidi marks, and U+2060 word joiner passed through
* would leave a rule that is neither category- nor addressability-shaped. The
* whole family is legal in both consumers, since only LF and CR terminate a
* Python string literal or a `#` comment. That set is the tokenizer's, not
* `str.splitlines()`': NEL (U+0085), LS (U+2028), and PS (U+2029) split a
* string at run time but do not end a physical line in source — measured on
* CPython 3.9.6 and 3.12.13, each accepted in both positions with the value
* round-tripping — so they are safe raw wherever they reach emitted text
* unescaped, which for all three is `JSON.stringify`, at two call sites:
* {@link pyScalar}'s literal path, and the subscript tool-name comment's own
* call, which a name carrying any of them always reaches, none being
* `XID_Continue`. The `description` path escapes NEL under the class above and
* folds LS and PS in {@link describe}'s `\s+` collapse, both being `\s`.
*/
const UNPRINTABLE = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/g;
/**
* Unpaired surrogate code points, escaped by {@link describe} as `\uNNNN` —
* its own form, since `\xNN` stops at U+00FF. The `u` flag is what makes this
* the LONE ones: in Unicode mode a well-formed pair is a single astral code
* point outside D800 to DFFF, so an emoji in a description survives untouched.
*
* This is the NUL case from {@link UNPRINTABLE}, not the invisible-character
* case. Python source must be UTF-8-encodable and a lone surrogate is not, so
* `compile()` raises `UnicodeEncodeError: surrogates not allowed` for one
* anywhere in the text — measured on 3.9 for a string literal and for a `#`
* comment alike. A raw or MCP tool description reaches this: `JSON.parse` on a
* wire `"\ud800"` escape yields exactly such a code point.
*/
const LONE_SURROGATE = /[\ud800-\udfff]/gu;
/**
* The collapsed one-line `description` of a schema node (byte-stable across
* formatting churn), or `undefined` when the node carries none. Every caller
* passes an object — a validated property node, the `ToolSdkSchema` itself, or
* the `{ description }` wrapper {@link docLines} synthesizes — so only the
* description field needs guarding. A description that collapses
* to nothing (empty, or whitespace only) is `undefined` too: it documents the
* node no better than an absent one, and emitting it would leave an empty
* `"""` docstring or a bare `#   ` line in the SDK. Only ECMAScript whitespace
* folds, so a description of whitespace plus one surviving control character is
* NOT absent: it collapses to that character's visible escape.
*
* Control characters left over after the whitespace collapse are rendered as
* their `\xNN` escapes (see {@link UNPRINTABLE}) and unpaired surrogates as
* their `\uNNNN` escapes (see {@link LONE_SURROGATE}); the escape's own backslash is
* emitted literally by both consumers, since {@link docLines} doubles it into a
* Python source escape and a `#` comment carries it verbatim.
*/
function describe(schema) {
	const description = schema.description;
	if (typeof description !== "string") return void 0;
	const collapsed = description.replace(/\s+/g, " ").replace(UNPRINTABLE, (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`).replace(LONE_SURROGATE, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`).trim();
	return collapsed.length === 0 ? void 0 : collapsed;
}
/**
* One-line docstring for a tool `description`, or no lines when there is none.
* Backslashes are doubled first, every quote is escaped, and a trailing
* backslash cannot survive: a description ending in `"` or an odd backslash
* would otherwise merge with (or escape) the closing triple quote and make
* the generated block — PTC mode's only SDK — syntactically invalid Python.
*/
function docLines(description, indent) {
	const collapsed = describe({ description });
	if (collapsed === void 0) return [];
	const escaped = collapsed.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
	return [`${pad(indent)}"""${escaped}"""`];
}
/**
* CamelCase a name into a Python type identifier: non-identifier characters
* split words, `_` splits too (it is `XID_Continue`, so the split set names it
* explicitly), and a head that cannot start an identifier takes a `Tool`
* prefix. Unicode survives, so a `路径` field yields `路径`-based class names
* instead of collapsing to the bare prefix. A character that is not
* `XID_Continue` splits even when it is a letter, so a name whose NFKC folding
* would leave the identifier set is not carried through — the split set is the
* grammar's, not an ASCII approximation of it.
*
* The result is NFKC-normalized: these names are generated, never matched
* against a JSON key, so normalizing is free here and keeps what CPython
* compiles identical to what is emitted — unlike {@link isBareIdentifier},
* which must reject unstable names outright. Normalizing AFTER the prefix
* decision is what makes that hold at the seam the prefix creates: `Tool` +
* a combining-mark head composes there (`U+0301` gives `Tooĺ`, U+013A), so
* normalizing only the un-prefixed part would emit a name CPython compiles to
* a different symbol. The second call is idempotent on the un-prefixed arm.
*
* The split set, the head test, and `toUpperCase()` all read the engine's
* Unicode tables, so this function carries the same version skew
* {@link isBareIdentifier} documents, by paths independent of it: a class name
* derived here reaches emitted text whenever any object shape in the tool's
* schema declares a `TypedDict`, and the predicate's verdict on the tool name
* does not gate that. The case mapping is the one that can fail on a name the
* predicate accepted; the worked example is there.
* @param raw - the schema field or tool name to derive from.
* @returns a class-name segment safe to emit.
*/
function camelCase(raw) {
	const joined = raw.split(/[^\p{XID_Continue}]+|_+/u).filter((part) => part.length > 0).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join("").normalize("NFKC");
	return (/^\p{XID_Start}/u.test(joined) ? joined : `Tool${joined}`).normalize("NFKC");
}
/** Class-name base cap keeping each emitted name — and total text — linear in schema depth. */
const MAX_CLASS_NAME_BASE = 120;
/**
* Deepest `list[…]` nesting emitted into one annotation before the item type
* degrades to `Any`. CPython's tokenizer rejects a logical line holding more
* than 200 simultaneously-open brackets (`MAXLEVEL`, `SyntaxError: too many
* nested parentheses`), so an array chain deeper than that would render an SDK
* block that is not valid Python at all — the same failure the docstring
* escaping in {@link docLines} exists to prevent. 180 leaves headroom for the
* few brackets an annotation can add around the chain, all of which count
* toward the same limit. Per emission site, counting brackets open at the
* chain's innermost point:
*
* - Return annotation, `async def f(self, args: X) -> chain:` — 180 `list[`
*   plus an innermost `Literal[`. The parameter list's `(` closed at the `)`
*   before the `->`, so it is NOT open here: 181.
* - TypedDict field, `field: NotRequired[chain]` — a class-body line with no
*   other open bracket, and its children start at `listDepth: 1` to reserve
*   the `NotRequired[`, so 179 `list[` plus `Literal[`: 181. Required fields
*   share that start for uniformity, spending one level of representable depth
*   on a bracket they never emit.
* - Argument annotation, `async def f(self, args: chain) -> Y:` — the `(` IS
*   still open around it: 180 `list[` plus `Literal[` plus the paren, 182, the
*   worst case. Reachable only through a raw `register()` whose `parameters`
*   is an array reached from the root through `oneOf` arms alone — the root
*   array itself, or one nested under any depth of unions, since an arm
*   inherits the enclosing depth unchanged (`A | B` opens no bracket). An
*   object ancestor takes it out of this case: its fields restart the chain at
*   the 181 site. `defineTool` compiles an object root, so the annotation is a
*   bare TypedDict class name or a one-bracket `dict[str, Any]` when that
*   object degrades — never a chain.
*
* A CPython grammar limit, not a deployment choice, so it is fixed rather than
* configurable. The sibling `ts-types` renderer needs no counterpart: nothing
* in the TypeScript grammar bounds nesting, and its SDK block is never type-
* checked. Only bracket nesting counts — a `oneOf` renders as a flat `A | B`
* chain and nested objects render as separate `class` statements, so neither
* accumulates open brackets at any depth. The invariant this cap serves is
* grammatical validity; see the `oneOf` arm in {@link renderType} for the one
* interpreter limit deliberately left uncapped.
*/
const MAX_LIST_NESTING = 180;
/**
* Cap a class-name base at {@link MAX_CLASS_NAME_BASE} (see the callers for
* why capping keeps the render linear). `slice` counts UTF-16 code units, so
* an astral character straddling the boundary would be cut in half and leave a
* lone surrogate — not an identifier character, and not even well-formed text;
* drop it rather than emit it.
*/
function capClassNameBase(base) {
	if (base.length <= MAX_CLASS_NAME_BASE) return base;
	const capped = base.slice(0, MAX_CLASS_NAME_BASE);
	return /[\uD800-\uDBFF]$/.test(capped) ? capped.slice(0, -1) : capped;
}
/**
* Reserve a unique class name from a base, suffixing `2`, `3`, … on collision.
* The base is capped at {@link MAX_CLASS_NAME_BASE} first: child class names
* derive from their parent's allocated name (`ParentChild`), so an unbounded
* schema of single-field objects would otherwise grow each name by one field
* per level and the sum of all names to Θ(depth²). Capping the base keeps each
* name — and the total emitted text — linear in depth. Collisions resume from
* the per-base counter in `state.nextClassCounter` rather than rescanning from
* `2`, so a deep chain sharing one capped base stays O(1) per allocation
* (amortized) instead of Θ(depth²) in time.
*/
function allocateClassName(base, state) {
	const capped = capClassNameBase(base);
	let name = capped;
	if (state.usedClassNames.has(name)) {
		let n = state.nextClassCounter.get(capped) ?? 2;
		while (state.usedClassNames.has(`${capped}${n}`)) n++;
		name = `${capped}${n}`;
		state.nextClassCounter.set(capped, n + 1);
	}
	state.usedClassNames.add(name);
	return name;
}
/**
* Append a child-name segment to a parent class-name base, capping the result
* at {@link MAX_CLASS_NAME_BASE}. Capping AT PROPAGATION (not only inside
* {@link allocateClassName}) keeps each level O(1): a deep `oneOf`- or
* object-chain would otherwise carry an ever-growing ConsString down the tree
* and re-materialize it (via `.length`/`.slice`) at every level — Θ(depth²).
* The bounded base plus the collision counter still yields unique names.
*
* The join is NFKC-normalized because both sides are separately normalized yet
* their concatenation need not be: a base ending in a Hangul L jamo or LV
* syllable composes with a following V or T jamo head (`가` + `ᆨ` gives `각`),
* so the emitted class name would differ from the symbol CPython compiles, and
* two byte-distinct names could fold onto one — `usedClassNames` dedupes by the
* raw bytes, so the collision counter would not see it. Normalizing costs
* O(cap + segment) per level, the same order as the `slice` it feeds. The other
* two join points need no counterpart: `Args`/`Output` start with `A`/`O` and
* {@link allocateClassName}'s suffix is digits, none of which compose backwards.
*/
function childClassName(base, segment) {
	return capClassNameBase(`${base}${segment}`.normalize("NFKC"));
}
/**
* Render one validated scalar as Python literal text (`True`/`False`,
* JSON-quoted strings, bare numbers). `null` cannot reach here: the `null`
* type renders directly as `None`, and the unified validator rejects a null
* `const`/`enum` entry on every other scalar type.
*
* A beyond-safe-range integral number takes `BigInt` digits rather than
* `String`: Python integers are arbitrary-precision, so the emitted digits ARE
* the value the model programs against, and `String` can give a different
* integer than the double holds (`2 ** 60` prints the rounded `...847000`, not
* the exact `...846976`) or no integer literal at all (`1e21` prints `1e+21`).
* `String`'s rounding is not a bug in it: `Number::toString` emits the shortest
* decimal string that re-reads to the same double, then pads to the exponent
* with zeros (1 significant digit for `1e20`, 16 for `2 ** 60`) — and when the
* shortest string is shorter than the double's exact value, those padded digits
* name an integer no double holds. Passing one back would have to cross the
* argument boundary as a JSON number — a double again — so the SDK would
* document a value no program can pass. `BigInt` needs no case split: where
* `String` is already exact (`2 ** 53`, `1e20`) the two agree byte for byte,
* and where it is not, `BigInt` is the exact one. The TS flavor needs no
* counterpart at all: its literal is re-read by a JS parser back into the same
* double.
*
* `JSON.stringify` is also what keeps this path's output parseable, and it is
* the only thing that does. It covers both classes of hazard: the two kinds of
* code point CPython refuses anywhere in source — NUL among the C0 controls,
* and the whole D800–DFFF unpaired-surrogate block, escaped under ES2019
* well-formed stringification, which the engines range guarantees — and the
* ones that break this line in particular, a bare `"` closing the literal
* early, a trailing odd backslash eating the closing quote, and a bare LF/CR
* ending it before its terminator. The `description` path carries
* {@link UNPRINTABLE} and {@link LONE_SURROGATE} because nothing quotes it,
* and folds newlines in {@link describe}.
*
* That leans on a coincidence worth naming: every escape `JSON.stringify` can
* emit (`\"`, `\\`, `\b`, `\f`, `\n`, `\r`, `\t`, `\uXXXX`) is also a Python
* escape denoting the same character, so the emitted `Literal[...]` both
* parses and decodes back to the value the schema declared. DEL, the C1
* controls (NEL among them), and LS/PS (U+2028/U+2029) do reach it raw —
* legal but invisible, byte-for-byte as in the TS flavor; escaping them is a
* both-flavors change. Those last three are legal here for the reason
* {@link UNPRINTABLE} records: they are `str.splitlines()` boundaries, not
* tokenizer line terminators. The subscript tool-name comment quotes its name
* through its own call to the same `JSON.stringify`, never through this
* function, and inherits both halves — escapes and pass-throughs alike.
*/
function pyScalar(value) {
	if (value === true) return "True";
	if (value === false) return "False";
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)) return BigInt(value).toString();
	return String(value);
}
/**
* Render a validated scalar `const`/`enum` as `Literal[...]`, falling back to
* the broad type. Deliberately deviates from PEP 586, which restricts `Literal`
* parameters to int/bool/str/bytes/enum/None: a non-integral number
* `const`/`enum` emits a float literal (`Literal[1.5]`) a strict checker would
* reject. An integral one does not deviate — {@link pyScalar} emits int digits,
* including for the beyond-safe-range values it widens through `BigInt`, and
* PEP 586 admits int parameters. Harmless either way — the stub is advisory
* prompt text, only required to parse — and keeping the exact value
* communicates the constraint to the model.
*/
function renderConstrainedScalar(node, broad, state) {
	if (node.const !== void 0) {
		state.typing.add("Literal");
		return `Literal[${pyScalar(node.const)}]`;
	}
	if (node.enum !== void 0) {
		state.typing.add("Literal");
		return `Literal[${node.enum.map(pyScalar).join(", ")}]`;
	}
	return broad;
}
/**
* Map one JSON-Schema node to a Python type expression, threading `state` to
* collect the `TypedDict` declarations and `typing` symbols a full render
* needs. `className` is the name to give an object node with properties (and
* the prefix for its nested objects). Handles every unified schema construct —
* `oneOf` (→ `X | Y`), `const`/`enum` (→ `Literal[...]`), `integer` (→ `int`),
* `null` (→ `None`) — and degrades an unsupported or malformed schema to `Any`
* without throwing, the same trusted-after-validation stance as the sibling
* {@link ./ts-types.ts | ts-types} renderer. {@link jsonSchemaToPy} is the
* context-free entry point; this is the collecting core.
*/
function renderType(schema, className, state) {
	const newFrame = (schema, className, listDepth) => ({
		schema,
		className,
		phase: "start",
		listDepth,
		children: [],
		childIndex: 0,
		childTypes: [],
		entries: []
	});
	try {
		assertSupportedJsonSchema(schema);
		const frames = [newFrame(schema, className, 0)];
		let result;
		const finish = (type) => {
			frames.pop();
			const parent = frames.at(-1);
			if (parent === void 0) result = type;
			else parent.childTypes.push(type);
		};
		while (frames.length > 0) {
			const frame = frames.at(-1);
			/* v8 ignore next -- the loop condition guarantees a current frame. */
			if (frame === void 0) break;
			if (frame.phase === "children") {
				if (frame.childIndex < frame.children.length) {
					const child = frame.children[frame.childIndex];
					/* v8 ignore next -- childIndex is bounded by children.length. */
					if (child === void 0) throw new Error("missing python render child");
					frame.childIndex++;
					frames.push(newFrame(child.schema, child.className, child.listDepth));
					continue;
				}
				if (frame.kind === "oneOf") {
					let union = "";
					for (const [index, childType] of frame.childTypes.entries()) union = index === 0 ? childType : `${union} | ${childType}`;
					finish(union);
					continue;
				}
				if (frame.kind === "array") {
					/* v8 ignore next -- the ?? arm needs a childless array frame, which start never builds. */
					finish(`list[${frame.childTypes[0] ?? "Any"}]`);
					continue;
				}
				const node = frame.node;
				const name = frame.allocated;
				/* v8 ignore next -- typeddict frames always set node and allocated at start. */
				if (node === void 0 || name === void 0) throw new Error("missing typeddict frame state");
				const required = new Set(node.required);
				const lines = [`class ${name}(TypedDict):`];
				for (let index = 0; index < frame.entries.length; index++) {
					const entry = frame.entries[index];
					const fieldType = frame.childTypes[index];
					/* v8 ignore next -- entries and childTypes correspond one-to-one. */
					if (entry === void 0 || fieldType === void 0) throw new Error("missing typeddict field type");
					const [field, fieldSchema] = entry;
					const description = describe(fieldSchema);
					if (description !== void 0) lines.push(`${pad(1)}# ${description}`);
					if (required.has(field)) lines.push(`${pad(1)}${field}: ${fieldType}`);
					else {
						state.typing.add("NotRequired");
						lines.push(`${pad(1)}${field}: NotRequired[${fieldType}]`);
					}
				}
				if (node.additionalProperties !== false) lines.push(`${pad(1)}# Additional keys beyond those declared are allowed.`);
				if (lines.length === 1) lines.push(`${pad(1)}pass`);
				state.classes.push(lines.join("\n"));
				finish(name);
				continue;
			}
			frame.phase = "children";
			const node = frame.schema;
			if (node.oneOf !== void 0) {
				frame.kind = "oneOf";
				frame.children = node.oneOf.map((branch, index) => ({
					schema: branch,
					className: childClassName(frame.className, `${index + 1}`),
					listDepth: frame.listDepth
				}));
				continue;
			}
			if (node.type === void 0) {
				state.typing.add("Any");
				finish("Any");
				continue;
			}
			switch (node.type) {
				case "string":
					finish(renderConstrainedScalar(node, "str", state));
					break;
				case "number":
					finish(renderConstrainedScalar(node, "float", state));
					break;
				case "integer":
					finish(renderConstrainedScalar(node, "int", state));
					break;
				case "boolean":
					finish(renderConstrainedScalar(node, "bool", state));
					break;
				case "null":
					finish("None");
					break;
				case "array":
					if (node.items === void 0) {
						state.typing.add("Any");
						finish("list[Any]");
						break;
					}
					if (frame.listDepth >= MAX_LIST_NESTING) {
						state.typing.add("Any");
						finish("Any");
						break;
					}
					frame.kind = "array";
					frame.children = [{
						schema: node.items,
						className: frame.className,
						listDepth: frame.listDepth + 1
					}];
					break;
				case "object": {
					const entries = Object.entries(node.properties ?? {});
					if (className === "" || !entries.every(([name]) => isBareIdentifier(name) && !RESERVED.has(name) && !(name.startsWith("__") && !name.endsWith("__")))) {
						state.typing.add("Any");
						finish("dict[str, Any]");
						break;
					}
					if (entries.length === 0 && node.additionalProperties !== false) {
						state.typing.add("Any");
						finish("dict[str, Any]");
						break;
					}
					frame.kind = "typeddict";
					frame.node = node;
					frame.allocated = allocateClassName(frame.className, state);
					state.typing.add("TypedDict");
					frame.entries = entries;
					/* v8 ignore next -- allocated is always set before children are built. */
					frame.children = entries.map(([field, child]) => ({
						schema: child,
						className: childClassName(frame.allocated ?? "", camelCase(field)),
						listDepth: 1
					}));
					break;
				}
				/* v8 ignore next 4 -- assertSupportedJsonSchema narrowed this closed type union. */
				default:
					state.typing.add("Any");
					finish("Any");
			}
		}
		/* v8 ignore next -- every root frame produces one expression. */
		return result ?? "Any";
	} catch {
		state.typing.add("Any");
		return "Any";
	}
}
/** The fixed model-facing usage contract rendered above the declarations. */
const SDK_INSTRUCTIONS = `## Writing code for run_code

\`run_code\` takes two required arguments: \`code\` — the body of an async Python function (top-level \`await\` and \`return\` both work) — and \`description\`, a short summary of what the program does. At run time exactly two of the names declared below are bound: \`tools\` and \`ToolCallError\`. Everything else is a STATIC STUB describing argument and return types — in particular the \`TypedDict\` classes do NOT exist at run time, so build arguments as plain \`dict\`/\`list\` JSON values: \`await tools.name({"field": 1})\`, never \`FooArgs(field=1)\`, which raises \`NameError\`. Inside the program:

- Call tools as \`await tools.name(args)\` — subscript access for exotic, reserved, or underscore-leading names: \`await tools["my-tool"](args)\`. Every call resolves to the tool's typed canonical JSON value (each method's return type below). Tool arguments must be lossless JSON.
- A FAILED tool call raises \`ToolCallError\`, whose \`toolName\` identifies the failed tool and whose message is human-readable — wrap in \`try/except\` to handle and continue.
- Independent read-only calls MAY overlap under \`asyncio.gather\` (safe calls run concurrently; mutating calls run alone, in submission order). Sequence dependent work with \`await\`.
- Emit the run's answer with \`print(...)\` and/or a top-level \`return <value>\`; the returned value must be lossless JSON. Only what you print and return is program output. A successful tool result containing an image is attached after the run so you can inspect it on the next step; every other intermediate result stays out of the conversation, so extract just what you need.

The available tools:`;
/**
* Render the full `tools:sdk` prompt section under `runtime.language ===
* 'python'`: the Python-flavored usage instructions plus one named `TypedDict`
* per tool argument or output object (and per nested object) and one awaitable
* method per visible tool on a `Tools` protocol — typed args in, the tool's
* canonical output value out — with a `tools: Tools` singleton the model calls
* into. The `typing` import line lists exactly the symbols the render used.
* Deterministic — tools are emitted in lexicographic name order, and class
* declarations precede the protocol in that same order (nested classes before
* the parent that references them), so an unchanged tool set produces
* byte-identical text across assemblies. The sort is not a total order on
* byte-equal names, so two schemas sharing a name would render in argument
* order; the caller's visible-capability map is keyed by name, so the input
* never carries a duplicate.
* @param schemas - the tool schemas plus canonical output schemas to declare
*   (the caller excludes `run_code` itself).
* @returns the complete section text.
*/
function renderToolsSdkPy(schemas) {
	const sorted = [...schemas].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
	const state = {
		classes: [],
		usedClassNames: /* @__PURE__ */ new Set(),
		nextClassCounter: /* @__PURE__ */ new Map(),
		typing: new Set(["Protocol"])
	};
	const members = [];
	let statements = 0;
	for (const schema of sorted) {
		const argType = renderType(schema.parameters, `${camelCase(schema.name)}Args`, state);
		const outputType = renderType(schema.output, `${camelCase(schema.name)}Output`, state);
		if (isBareIdentifier(schema.name) && !RESERVED.has(schema.name) && !schema.name.startsWith("_")) {
			const doc = docLines(schema.description, 2);
			members.push(doc.length > 0 ? `${pad(1)}async def ${schema.name}(self, args: ${argType}) -> ${outputType}:` : `${pad(1)}async def ${schema.name}(self, args: ${argType}) -> ${outputType}: ...`);
			members.push(...doc);
			statements += 1;
		} else {
			members.push(`${pad(1)}# tools[${JSON.stringify(schema.name)}](args: ${argType}) -> ${outputType}`);
			const description = describe(schema);
			if (description !== void 0) members.push(`${pad(1)}#   ${description}`);
		}
	}
	const body = (statements > 0 ? members : [`${pad(1)}pass`, ...members]).join("\n");
	const imports = TYPING_ORDER.filter((symbol) => state.typing.has(symbol));
	const classBlock = state.classes.length > 0 ? `${state.classes.join("\n\n")}\n\n` : "";
	return `${SDK_INSTRUCTIONS}\n\n\`\`\`python\n${`from typing import ${imports.join(", ")}\n\nclass ToolCallError(Exception):
    toolName: str\n\n${classBlock}class Tools(Protocol):\n${body}\n\ntools: Tools`}\n\`\`\``;
}
//#endregion
//#region ../../core/tools/src/index.ts
/**
* Tool registry, model presentation modes, and pre/guard/around/post/result
* execution pipeline.
* @module @deepseek-ai/dsh-tools
*/
/**
* Language → SDK-section renderer. The registry looks up the loaded
* `ctx.codeRuntime.language` in this table when assembling the `tools:sdk`
* section under a non-native mode; a runtime whose language is not a key
* fails the assembly loudly (same idiom as `toolOrder` violations). Adding a
* new backend language is three parallel edits — a {@link CodeSdkLanguage}
* member, an entry here, and a `RUN_CODE_FLAVORS` entry in `ptc.ts` for
* its `run_code` schema strings — plus the renderer function this table points
* at. The `satisfies` clause pins this table's key set to that union, which
* the flavor table is checked against too, so any of the three left out is a
* typecheck failure. What no check reaches is the prose that names the values
* instead of deriving them: the seam's `dsh-code-runtime` README pair, its
* `CodeRuntime.language` JSDoc, and `rsh/Docs/subsystems/code-runtime.md`
* with its zh pair, plus this package's own README pair and the
* {@link Config.mode} JSDoc.
*/
/**
* The model-facing statement of the `ptc` collapse. Names the consequence
* (the call fails) and the route (inside the program), because a rule the
* model can only discover by being denied is one it corrects too late.
*/
const PTC_ONLY_INSTRUCTION = `\`${RUN_CODE_NAME}\` is the only tool you can call directly — a tool call naming any other tool fails. Reach every tool the SDK declares below from inside the program.`;
const SDK_RENDERERS = {
	typescript: renderToolsSdk,
	python: renderToolsSdkPy
};
/**
* Scheduler entry point omitted from the generated named service API.
* @internal
*/
const TOOL_RUNTIME_SCHEDULER = Symbol("@deepseek-ai/dsh-tools.scheduler");
/** Canonical error code for cancellation after a tool body was invoked. */
const TOOL_ABORTED = "ABORTED";
/** Canonical error code for cancellation before a tool body was invoked. */
const TOOL_ABORTED_BEFORE_DISPATCH = "ABORTED_BEFORE_DISPATCH";
/**
* Thrown (internally) when the model requests a tool that isn't registered.
* Extends {@link HarnessError} (`code: 'UNKNOWN_TOOL'`) so an unknown-tool
* failure is as routable as a tool-thrown one — retry/sandbox/replay code can
* distinguish it from a tool body's own error.
*/
var ToolNotFoundError = class extends HarnessError {
	/**
	* @param toolName - the name the caller asked for.
	* @param reachableFrom - how the model reaches this tool instead, when the
	*   name IS visible and only the presentation denies calling it directly.
	*   Omitted for a name that is registered nowhere.
	*/
	constructor(toolName, reachableFrom) {
		super(reachableFrom === void 0 ? `unknown tool "${toolName}"` : `unknown tool "${toolName}": ${reachableFrom}`, "UNKNOWN_TOOL");
		this.name = "ToolNotFoundError";
	}
};
/** Thrown when a tool body or post-policy value violates its declared output. */
var ToolOutputError = class extends HarnessError {
	/** Schema/value violations in validation order. */
	violations;
	constructor(toolName, violations) {
		super(`tool "${toolName}" returned invalid output: ${violations.join("; ")}`, "INVALID_TOOL_OUTPUT");
		this.name = "ToolOutputError";
		this.violations = violations;
	}
};
/** Convert one projector exception into the canonical invalid-output failure. */
function projectionError(toolName, projector, error) {
	return new ToolOutputError(toolName, [`output.${projector} failed: ${errorMessage$1(error)}`]);
}
/** Snapshot one projector result before later durable-result materialization. */
function snapshotProjection(toolName, projector, candidate) {
	try {
		const detached = snapshotJsonValue(candidate);
		if (detached === void 0) throw new ToolOutputError(toolName, [`output.${projector} returned non-lossless JSON`]);
		return detached;
	} catch (error) {
		if (error instanceof ToolOutputError) throw error;
		throw projectionError(toolName, projector, error);
	}
}
/** Snapshot one body or policy value into the canonical invalid-output failure class. */
function snapshotToolValue(toolName, candidate) {
	try {
		const detached = snapshotJsonValue(candidate);
		if (detached === void 0) throw new ToolOutputError(toolName, ["value is not lossless JSON"]);
		return detached;
	} catch (error) {
		if (error instanceof ToolOutputError) throw error;
		throw new ToolOutputError(toolName, [`value snapshot failed: ${errorMessage$1(error)}`]);
	}
}
/**
* Best-effort human-readable message from an arbitrary thrown value: Error
* instances use `.message`; non-Error objects with a string `message`
* property (e.g. `throw { message: 'denied' }`) use it too; everything else
* is stringified.
*/
function errorMessage$1(error) {
	try {
		if (error instanceof Error) return error.message;
		if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") return error.message;
		return String(error);
	} catch {
		return "<unprintable thrown value>";
	}
}
/** Derive one failure message from policy feedback without changing its rendered blocks. */
function failureMessageFromContent(content) {
	const text = content.map((block) => block.type === "text" ? block.text : `[${block.type} content]`).join("\n");
	return text.length > 0 ? text : "tool result blocked by post-execute policy";
}
/** Snapshot and freeze one durable tool-result projection or reject lossy data. */
function materializePresentation(candidate) {
	const detached = snapshotJsonValue(candidate);
	if (detached === void 0) throw new TypeError("tool result must be losslessly JSON-serializable");
	return deepFreeze(detached);
}
/** Structured `{ name, code }` for a thrown HarnessError, else undefined. */
function errorInfo(error) {
	try {
		return error instanceof HarnessError ? {
			name: error.name,
			code: error.code
		} : void 0;
	} catch {
		return;
	}
}
/** One scope's complete tool-registry contribution. */
var ToolLayer = class {
	tools;
	restrictions = new AnonymousEntries();
	guards = new AnonymousEntries();
	/**
	* Presentation this scope's agent declared for itself, shadowing the
	* deployment default. One cell rather than an entry table: two answers to
	* "which form does the model see" is a contradiction, not a merge.
	*/
	mode;
	constructor(scope) {
		this.tools = new NamedEntries((name) => /* @__PURE__ */ new Error(scope === void 0 ? `tool "${name}" is already registered (for a per-agent variant, register through that agent's \`agent.ctx\` instead)` : `tool "${name}" is already registered in this scope`));
	}
	/** Whether every contribution table in this aggregate layer is empty. */
	isEmpty() {
		return this.tools.isEmpty() && this.restrictions.isEmpty() && this.guards.isEmpty() && this.mode === void 0;
	}
	/** Whether every compiled restriction in this layer admits a global tool name. */
	admits(name) {
		for (const filter of this.restrictions.values()) if (filter.allow !== void 0 && !filter.allow.has(name) || filter.deny !== void 0 && filter.deny.has(name)) return false;
		return true;
	}
	/** First monotonic denial from this layer's live guard registrations. */
	guardReason(exec) {
		for (const guard of this.guards.values()) {
			const reason = guard(exec);
			if (reason !== void 0) return reason;
		}
	}
};
/** Resolve the run_code overlap cap at the owning config boundary (direct construction bypasses the Loader schema). */
function resolveMaxParallelSubCalls(value) {
	const maxParallelSubCalls = value ?? 10;
	if (!Number.isInteger(maxParallelSubCalls) || maxParallelSubCalls < 1) throw new Error("maxParallelSubCalls must be a positive integer");
	return maxParallelSubCalls;
}
(class extends Service {
	static inject = ["systemPrompt"];
	static Config = Schema.object({
		mode: Schema.union([
			"native",
			"ptc",
			"both"
		]).default("native"),
		maxParallelSubCalls: Schema.natural().min(1).default(10)
	});
	/** Internal staged view consumed by `dsh-agent-loop`'s parallel scheduler. */
	[TOOL_RUNTIME_SCHEDULER] = {
		prepare: (exec) => this.prepareScheduledExecution(exec),
		dispatch: (exec) => this.dispatchScheduledExecution(exec),
		finalize: (exec, result) => this.finalizeScheduledExecution(exec, result),
		finish: (exec, result) => this.finishScheduledExecution(exec, result)
	};
	/** Context deferred by a running tool body, keyed by its scheduler-owned execution. */
	deferredContexts = /* @__PURE__ */ new WeakMap();
	/** Executions whose tool body declared the current turn complete. */
	concludingExecutions = /* @__PURE__ */ new WeakSet();
	/** Original caller cancellation, kept outside the wrapper-mutable execution object. */
	cancellationStates = /* @__PURE__ */ new WeakMap();
	/** Definition-owned final content transform snapshotted before policy begins. */
	contentFinalizers = /* @__PURE__ */ new WeakMap();
	layers = new ScopedLayers((scope) => new ToolLayer(scope), () => {
		this.ctx.emit("tools/change");
	});
	/** Presentation for scopes that declare none; {@link presentAs} shadows it per scope. */
	defaultMode;
	maxParallelSubCalls;
	/**
	* Reserved presentation transport, kept outside the filterable registration
	* layers. Built on first need rather than at construction: which agents run
	* a PTC mode is no longer known when the service is constructed, and the
	* transport is stateless beyond its closures over `this`.
	*/
	ptcTransport;
	constructor(ctx, config = {}) {
		super(ctx, "tools");
		this.defaultMode = config.mode ?? "native";
		this.maxParallelSubCalls = resolveMaxParallelSubCalls(config.maxParallelSubCalls);
		ctx.systemPrompt.tools((context) => this.wireSchemas(context.scope));
		if (this.defaultMode !== "native") {
			ctx.systemPrompt.section(this.collapseSection());
			ctx.systemPrompt.section(this.sdkSection());
		}
	}
	/**
	* The prompt statement of the `ptc` executor collapse, registered wherever
	* {@link sdkSection} is and rendering empty outside an effective `ptc`.
	*
	* Every tool contributes its own guidance section naming its tool, none of
	* them qualify how that tool is reached, and they all render before the SDK.
	* Without this the model reads a catalog of tools it is told to use and no
	* statement that only `run_code` may be called, so it emits a native call,
	* receives `UNKNOWN_TOOL` for a tool the prompt just declared, and concludes
	* the deployment is inconsistent. Its order places the rule before that
	* guidance rather than after it.
	*
	* `both` renders empty: native calls do execute there, so the rule is false.
	* @returns the section registration.
	*/
	collapseSection() {
		return {
			name: "tools:ptc-only",
			order: this.ctx.systemPrompt.getSectionOrder("PTC_ONLY"),
			text: (context) => this.modeFor(context.scope) === "ptc" ? PTC_ONLY_INSTRUCTION : ""
		};
	}
	/**
	* The generated-SDK prompt section, registered globally by a PTC mode
	* deployment and per scope by {@link presentAs}.
	*
	* The body regenerates from the CALLING scope, and renders empty for an
	* agent presenting natively — an agent that opted out under a PTC mode
	* deployment still sees the global registration, and an empty section is
	* dropped from the rendered prompt.
	* @returns the section registration.
	*/
	sdkSection() {
		return {
			name: "tools:sdk",
			order: this.ctx.systemPrompt.getSectionOrder("TOOLS_SDK"),
			text: (context) => {
				const mode = this.modeFor(context.scope);
				if (mode === "native") return "";
				const runtime = this.requireCodeRuntime(mode);
				const render = SDK_RENDERERS[runtime.language];
				/* v8 ignore next -- requireCodeRuntime rejects an unknown language before this runs. */
				if (render === void 0) throw new Error(`dsh-tools: no SDK renderer for ${runtime.language}`);
				return render(this.sdkSchemas(context.scope));
			}
		};
	}
	/**
	* The presentation one scope's agent sees: its own declaration, else the
	* deployment default.
	* @param scope - the calling agent, or undefined for the global view.
	* @returns the resolved presentation mode.
	*/
	modeFor(scope) {
		const layers = this.layers.chainLayers(scope);
		for (let index = layers.length - 1; index >= 0; index -= 1) {
			const mode = layers[index]?.mode;
			if (mode !== void 0) return mode;
		}
		return this.defaultMode;
	}
	/**
	* The reserved `run_code` transport, built on first need.
	*
	* It never enters the global layer: per-agent restrictions must not remove
	* it, and a scoped registration must not shadow it. The visibility resolver
	* appends it after resolving the filterable global/scoped capability layers,
	* and only for scopes whose mode actually presents it.
	* @returns the shared transport definition.
	*/
	requireCodeTransport() {
		this.ptcTransport ??= createRunCodeTool(this, {
			requireRuntime: () => this.requireCodeRuntime(this.defaultMode),
			peekRuntime: () => this.ctx.get("codeRuntime"),
			maxParallel: this.maxParallelSubCalls,
			shapeDispatchLog: (dispatch) => this.shapeDispatchLog(dispatch)
		});
		return this.ptcTransport;
	}
	/**
	* Present the calling scope's tools in `mode` instead of the deployment
	* default. Nearest scope on the chain wins, so a preset's standing
	* declaration covers every agent joined under it.
	*
	* Scoped only, and one declaration per scope: this is how an agent preset
	* composes PTC mode agents beside native ones in the same process, and a
	* process-global override would be the `mode` config field instead.
	* @param mode - the presentation the covered agents' models see.
	* @returns the exact disposer that restores the deployment default.
	*/
	presentAs(mode) {
		const ctx = this.ctx;
		if (scopeOf(ctx) === void 0) throw new Error("tools.presentAs() requires a scoped context (agent.ctx): a context-global presentation is the `mode` config field on the tools row");
		return ctx.effect(function* () {
			yield this.layers.effect(ctx, (layer) => {
				if (layer.mode !== void 0) throw new Error(`tools.presentAs("${mode}") conflicts with "${layer.mode}" already declared for this scope; one composition selects one presentation`);
				layer.mode = mode;
				return () => {
					layer.mode = void 0;
				};
			}, { label: "tools.presentAs()" });
			if (mode !== "native") {
				yield ctx.systemPrompt.section(this.collapseSection());
				yield ctx.systemPrompt.section(this.sdkSection());
			}
		}.bind(this), "tools.presentAs()");
	}
	/**
	* Build one scope's wire schemas and names for prompt-order validation.
	* Restrictions do not make known tools invalid, but a mode collapse does.
	*/
	wireSchemas(scope) {
		const view = this.view(scope);
		const mode = this.modeFor(scope);
		if (mode === "native") return {
			schemas: [...view.visible.values()].map((definition) => this.schemaOf(definition, false)),
			knownNames: [...view.knownNames]
		};
		this.requireCodeRuntime(mode);
		const schemas = [...view.visible.values()].map((definition) => this.schemaOf(definition, false));
		if (mode === "ptc") return {
			schemas: schemas.filter((schema) => schema.name === RUN_CODE_NAME),
			knownNames: [RUN_CODE_NAME]
		};
		return {
			schemas,
			knownNames: [...view.knownNames, RUN_CODE_NAME]
		};
	}
	/**
	* Resolve the code runtime or throw the actionable misconfiguration error.
	* Read at use time (assembly / run_code execution), NOT via static
	* `inject`: an inject entry would hold `ctx.tools` — and every tool plugin
	* behind it — hostage to a code runtime existing even under `mode:
	* 'native'`.
	*
	* Assembly and `run_code` execution read separately, so the language is not
	* bound to a request. Harmless while one published backend exists — both
	* reads return the same flavor — but a reload that swapped in a second
	* language between them would hand a program written against one SDK to the
	* other. Binding it is deferred until a second backend ships (the first
	* point it is testable).
	*/
	requireCodeRuntime(mode) {
		const runtime = this.ctx.get("codeRuntime");
		if (!runtime) throw new Error(`dsh-tools: mode "${mode}" requires a code runtime — load a ctx.codeRuntime implementation (e.g. @deepseek-ai/dsh-code-runtime-worker-thread) or set tools mode to "native"`);
		if (!Object.hasOwn(SDK_RENDERERS, runtime.language)) {
			const known = Object.keys(SDK_RENDERERS).map((name) => JSON.stringify(name)).join(", ");
			throw new Error(`dsh-tools: no SDK renderer registered for runtime language ${JSON.stringify(runtime.language)} (known: ${known})`);
		}
		return runtime;
	}
	/**
	* Register globally or in the calling agent scope. Scoped tools shadow
	* globals; duplicates within one layer and the reserved `run_code` name fail.
	* @param definition - tool schema, execution, and optional finalization/presentation callbacks.
	* @returns the exact disposer that unregisters the tool.
	*/
	register(definition) {
		const name = definition.name;
		const output = definition.output;
		if (output === void 0 || typeof output !== "object" || typeof output.render !== "function" || output.presentationMeta !== void 0 && typeof output.presentationMeta !== "function") throw new TypeError(`tool "${name}" must declare output { schema, render, presentationMeta? }`);
		assertSupportedJsonSchema(output.schema);
		const timeoutMs = definition.timeoutMs;
		if (timeoutMs !== void 0 && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) throw new TypeError(`tool "${name}" timeoutMs must be a positive finite number`);
		if (name === "run_code") throw new Error(`tool name "${RUN_CODE_NAME}" is reserved for the PTC mode presentation transport and cannot be registered or shadowed`);
		return this.layers.effect(this.ctx, (layer) => layer.tools.insert(name, definition), { label: "tools.register()" });
	}
	/**
	* Restrict global tools for the calling agent scope. Empty filters, unknown
	* names, scope-local names, and reserved transport names fail. Restrictions
	* intersect; scoped registrations remain visible.
	* @param filter - global-tool mask: `allow` (keep only) and/or `deny` (remove).
	* @returns the exact disposer that lifts this restriction.
	*/
	restrict(filter) {
		const scope = scopeOf(this.ctx);
		if (scope === void 0) throw new Error("tools.restrict() requires a scoped context (agent.ctx): a context-global restriction would mask every agent — deny the tool for the intended agent instead");
		const allow = filter.allow;
		const deny = filter.deny;
		if (allow === void 0 && deny === void 0) throw new Error("tools.restrict({}) is a no-op: pass `allow` and/or `deny` (an empty filter is almost always a materialized-empty-config bug)");
		const compiled = {
			...allow !== void 0 ? { allow: new Set(allow) } : {},
			...deny !== void 0 ? { deny: new Set(deny) } : {}
		};
		if ([...allow ?? [], ...deny ?? []].includes("run_code")) throw new Error(`tools.restrict() cannot name reserved PTC mode presentation transport "${RUN_CODE_NAME}"; restrict end-capability tools instead`);
		const known = this.view(scope).restrictableNames;
		const unknown = [...allow ?? [], ...deny ?? []].filter((name) => !known.has(name));
		if (unknown.length > 0) throw new Error(`tools.restrict() names unknown global tool${unknown.length > 1 ? "s" : ""} ${unknown.map((n) => `"${n}"`).join(", ")}; known global tools: ${[...known].sort().join(", ") || "(none)"}`);
		return this.layers.effect(this.ctx, (layer) => layer.restrictions.append(compiled), { label: "tools.restrict()" });
	}
	/**
	* Register a monotonic guard after the extensible `tools/pre-execute`
	* waterfall. A plain-context guard applies globally; one registered through
	* `agent.ctx` applies only to that agent. Any matching guard may deny by
	* returning a reason, while no guard can force-allow a call another guard
	* denied. The exact effect disposer is returned for ordered ownership and
	* HMR cleanup.
	* @param guard - synchronous check; a returned string denies the execution.
	* @returns the exact disposer that unregisters the guard.
	*/
	guard(guard) {
		return this.layers.effect(this.ctx, (layer) => layer.guards.append(guard), {
			label: "tools.guard()",
			notify: false
		});
	}
	/** First monotonic denial from the global then the scope chain's guard layers, farthest first. */
	guardReason(exec) {
		const globalReason = this.layers.global.guardReason(exec);
		if (globalReason !== void 0) return globalReason;
		if (exec.agent === void 0) return void 0;
		for (const layer of this.layers.chainLayers(exec.agent)) {
			const reason = layer.guardReason(exec);
			if (reason !== void 0) return reason;
		}
	}
	/**
	* Resolve every registry fact one scope needs in one layer traversal. The
	* visible map applies restrictions to the INHERITED surface, then the
	* scope's own registrations and the reserved presentation transport; the
	* other sets retain the pre-restriction facts needed by restriction and
	* prompt-order validation.
	*
	* A restriction filters what a scope inherits — the global layer and every
	* ancestor layer on its chain — and never what its OWN layer registers.
	* That exemption is what a per-child capability filter has to keep intact:
	* the delegation runtime registers a child's structured-output tool into the
	* child's own layer, and a filter naming the capabilities the child may use
	* must not strip the machinery it answers through.
	*
	* Reading the exempt set as "the global layer" instead of "not mine" held
	* only while every model-facing tool sat in the host composition. Once
	* presets moved them onto the agent plane they became an ANCESTOR
	* contribution, so a child's filter silently stopped constraining anything
	* it was given.
	* @param scope - the viewing scope (the agent), or undefined for the global view.
	* @returns the complete derived view for that scope.
	*/
	view(scope) {
		const layers = this.layers.chainLayers(scope);
		const own = this.layers.peek(scope);
		const inherited = new Map(this.layers.global.tools.entries());
		for (const layer of layers) {
			if (layer === own) continue;
			for (const [name, definition] of layer.tools.entries()) inherited.set(name, definition);
		}
		const visible = /* @__PURE__ */ new Map();
		const knownNames = /* @__PURE__ */ new Set();
		const restrictableNames = /* @__PURE__ */ new Set();
		for (const [name, definition] of inherited) {
			knownNames.add(name);
			restrictableNames.add(name);
			if (layers.every((layer) => layer.admits(name))) visible.set(name, definition);
		}
		if (own !== void 0) for (const [name, definition] of own.tools.entries()) {
			knownNames.add(name);
			visible.set(name, definition);
		}
		if (this.modeFor(scope) !== "native") visible.set(RUN_CODE_NAME, this.requireCodeTransport());
		return {
			visible,
			knownNames,
			restrictableNames
		};
	}
	/**
	* Look up a tool as one scope sees it (scoped
	* shadows global; a restricted-away global reads as absent). Presenters pass
	* the calling agent so the rendered card matches the definition that
	* actually executed.
	* @param name - the tool name as registered.
	* @param scope - the viewing scope (the agent); omitted = the global view.
	* @returns the definition the scope resolves, or undefined when none is visible.
	*/
	get(name, scope) {
		return this.view(scope).visible.get(name);
	}
	/**
	* Resolve the definition that MAY EXECUTE for a call, applying the mode
	* collapse at the operation boundary that owns it. The registry view
	* (`get`) is presentation-agnostic; here a MODEL-DIRECT call under `ptc`
	* may only name the reserved `run_code` transport, while a nested
	* sub-dispatch (a `parent` token set — the `run_code` SDK calling a tool
	* it bound) may call any visible tool. Denial surfaces as `UNKNOWN_TOOL`
	* through the executor, matching an absent definition.
	* @param name - the tool name as registered.
	* @param scope - the viewing scope (the agent); omitted = the global view.
	* @param nested - whether the call is a transport sub-dispatch, not a model-direct call.
	* @returns the definition that may run, or undefined when the call must be rejected.
	*/
	resolveExecution(name, scope, nested) {
		const tool = this.get(name, scope);
		if (tool === void 0) return void 0;
		if (this.collapses(name, scope, nested)) return void 0;
		return tool;
	}
	/**
	* Project visible definitions onto the allowlisted model-facing schema fields,
	* excluding execution and presentation callbacks.
	* @param scope - the viewing scope (the agent); omitted = the global view.
	* @returns one deep-cloned schema per visible tool.
	*/
	schemas(scope) {
		return [...this.view(scope).visible.values()].map((definition) => this.schemaOf(definition, true));
	}
	/** Project visible callable tools onto the generated PTC mode SDK contract. */
	sdkSchemas(scope) {
		return [...this.view(scope).visible.values()].filter((definition) => definition.name !== RUN_CODE_NAME).map((definition) => {
			const output = snapshotJsonValue(definition.output.schema);
			/* v8 ignore next -- registration already validated and retained this schema as lossless JSON. */
			if (output === void 0) throw new Error(`tool "${definition.name}" output schema must be lossless JSON before SDK projection`);
			return {
				...this.schemaOf(definition, true),
				output
			};
		});
	}
	/** Project one definition onto the model-facing schema fields. */
	schemaOf(definition, detachParameters) {
		const { name, description, parameters } = definition;
		const detached = detachParameters ? snapshotJsonValue(parameters) : parameters;
		if (detached === void 0) throw new Error(`tool "${name}" parameters must be lossless JSON before schema projection`);
		return {
			name,
			description,
			parameters: detached
		};
	}
	/**
	* Classify a pending call through the caller's visible tool definition. Only
	* an exact `true` is parallel; unknown, hidden, undeclared, invalid, or
	* throwing classifiers are exclusive.
	* @param exec - call name, parsed arguments, and optional agent scope.
	* @returns the fail-closed scheduling mode.
	*/
	executionMode(exec) {
		const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== void 0);
		if (!tool?.isConcurrencySafe) return { kind: "exclusive" };
		try {
			return tool.isConcurrencySafe(exec.arguments) === true ? { kind: "parallel" } : { kind: "exclusive" };
		} catch {
			return { kind: "exclusive" };
		}
	}
	/**
	* Run the `tools/ptc-dispatch-log` waterfall over one settled sub-dispatch
	* and return the content the bridge should log on `tool/ptc-dispatch`.
	* Contained: when a listener throws, the method logs the original settled
	* content; that failure must not fail the dispatch or omit the settle event. Private:
	* the ONE consumer is the `run_code` bridge this registry constructs, which
	* receives it as a capability parameter (the `requireRuntime` idiom) — the
	* waterfall, not this invoker, is the public extension point.
	*/
	async shapeDispatchLog(dispatch) {
		try {
			return await this.ctx.waterfall(scopeTarget(this, dispatch.agent), "tools/ptc-dispatch-log", dispatch, () => Promise.resolve(dispatch.content));
		} catch (error) {
			this.ctx.logger.warn(`tools: ptc-dispatch-log listener failed for ${dispatch.name}: ${errorMessage$1(error)}; logging the original settled content`);
			return dispatch.content;
		}
	}
	/**
	* Whether the `ptc` mode collapse denies a model-direct call: only the
	* reserved `run_code` transport may be named. Nested sub-dispatches (a
	* `parent` token set) bypass the collapse. One home for the
	* security-relevant predicate, shared by {@link resolveExecution} and
	* {@link createExecution} so the two can never drift apart.
	*
	* Resolved through {@link modeFor}, NOT `defaultMode`: an agent given `ptc`
	* by an agent preset under a native deployment is the composition
	* `dsh-agent-tool-presentation` exists for, and reading the deployment default would
	* leave exactly that agent uncollapsed — announcing one surface while
	* executing another, which is the bypass this collapse closes.
	* @param name - the tool name as registered.
	* @param scope - the viewing scope whose effective presentation mode applies.
	* @param nested - whether the call is a transport sub-dispatch, not a model-direct call.
	*/
	collapses(name, scope, nested) {
		return !nested && this.modeFor(scope) === "ptc" && name !== "run_code";
	}
	/**
	* Execute through pre-policy, guards, around-dispatch, post-policy,
	* definition-owned content finalization, and final notification. Tool and
	* listener failures resolve as materialized error results; an invisible tool
	* reports `UNKNOWN_TOOL`. The returned outcome is the same lossless, frozen
	* snapshot final observers receive. Cancellation
	* arriving after entry and before final result materialization skips a
	* not-yet-started body with `ABORTED_BEFORE_DISPATCH` or replaces a
	* successful started outcome with `ABORTED`; already-started work is still
	* drained and may retain a tool-owned structured error.
	* @param exec - the typed same-process call input. The registry assigns its
	*   correlation token before policy begins.
	* @returns the materialized final result.
	*/
	async execute(exec) {
		return this.prepareExecution(exec, (prepared) => this.completeScheduledExecution(prepared));
	}
	async completeScheduledExecution(prepared) {
		switch (prepared.kind) {
			case "dispatch": {
				const dispatched = await this.dispatchScheduledExecution(prepared.exec);
				return dispatched.kind === "post-result" ? await this.finalizeScheduledExecution(prepared.exec, dispatched.result) : this.finishScheduledExecution(prepared.exec, dispatched.result);
			}
			case "post-result": return await this.finalizeScheduledExecution(prepared.exec, prepared.result);
			case "final-result": return this.finishScheduledExecution(prepared.exec, prepared.result);
			/* v8 ignore next -- closed-union exhaustiveness guard */
			default: return assertNever(prepared, "scheduled tool preparation");
		}
	}
	createExecution(exec) {
		const deferredContexts = [];
		const token = createExecutionToken();
		const callId = exec.callId;
		const rootCallId = exec.rootCallId ?? callId;
		const name = exec.name;
		const agent = exec.agent;
		const parent = exec.parent;
		const signal = exec.signal;
		const visible = this.get(name, agent);
		const collapsed = visible !== void 0 && this.collapses(name, agent, parent !== void 0);
		const concludingExecutions = this.concludingExecutions;
		const base = {
			token,
			callId,
			rootCallId,
			name,
			signal,
			...agent !== void 0 ? { agent } : {},
			...parent !== void 0 ? { parent } : {},
			deferContext(context) {
				deferredContexts.push(context);
			},
			concludeTurn() {
				concludingExecutions.add(this);
			}
		};
		const capturedFinalizer = visible?.finalizeContent?.bind(visible);
		const finalizerFor = () => collapsed && !signal.aborted ? void 0 : capturedFinalizer;
		try {
			const detached = snapshotJsonValue(exec.arguments);
			if (detached === void 0) throw new TypeError("tool execution arguments must be losslessly JSON-serializable");
			const execution = {
				...base,
				arguments: deepFreeze(detached)
			};
			this.deferredContexts.set(execution, deferredContexts);
			this.contentFinalizers.set(execution, finalizerFor());
			this.cancellationStates.set(execution, {
				callerSignal: signal,
				bodyInvoked: false
			});
			if (collapsed) {
				if (signal.aborted) return {
					kind: "final-result",
					exec: execution,
					result: toolAbortedBeforeDispatchResult()
				};
				return {
					kind: "final-result",
					exec: execution,
					result: toolErrorResult(new ToolNotFoundError(name, `only \`${RUN_CODE_NAME}\` is callable directly — call \`${name}\` from inside a \`${RUN_CODE_NAME}\` program instead`))
				};
			}
			return {
				kind: "ready",
				exec: execution
			};
		} catch (error) {
			const execution = {
				...base,
				arguments: void 0
			};
			this.contentFinalizers.set(execution, finalizerFor());
			return {
				kind: "final-result",
				exec: execution,
				result: toolErrorResult(error)
			};
		}
	}
	/**
	* Run the ordered pre-execute and monotonic guard stages for the scheduler.
	* @param input - the caller-supplied execution input.
	* @returns the prepared execution plus the next scheduler stage.
	* @internal
	*/
	async prepareScheduledExecution(input) {
		return this.prepareExecution(input, (prepared) => prepared);
	}
	async prepareExecution(input, next) {
		const created = this.createExecution(input);
		if (created.kind !== "ready") return next(created);
		const exec = created.exec;
		if (this.callerCancelled(exec)) return next({
			kind: "final-result",
			exec,
			result: toolAbortedBeforeDispatchResult()
		});
		try {
			const carrier = scopeTarget(this, exec.agent);
			const gate = await this.ctx.waterfall(carrier, "tools/pre-execute", exec, () => Promise.resolve({ kind: "allow" }));
			const askResolution = gate.kind === "ask" ? await this.serviceAsk(exec, gate) : {
				decision: gate,
				approvalCancelled: false
			};
			const { decision } = askResolution;
			if (this.callerCancelled(exec) && askResolution.approvalCancelled) return await next({
				kind: "post-result",
				exec,
				result: toolAbortedBeforeDispatchResult()
			});
			const denialReason = decision.kind === "allow" ? this.guardReason(exec) : decision.reason;
			if (denialReason !== void 0) return await next({
				kind: "post-result",
				exec,
				result: this.materializeFinalResult({
					content: [{
						type: "text",
						text: `Error: ${denialReason}`
					}],
					isError: true,
					error: { message: denialReason }
				})
			});
			if (this.callerCancelled(exec)) return await next({
				kind: "post-result",
				exec,
				result: toolAbortedBeforeDispatchResult()
			});
			return await next({
				kind: "dispatch",
				exec
			});
		} catch (error) {
			return next({
				kind: "final-result",
				exec,
				result: toolErrorResult(error)
			});
		}
	}
	/** Whether the original caller signal is currently aborted. */
	callerCancelled(exec) {
		const state = this.cancellationStates.get(exec);
		/* v8 ignore next -- only registry-minted executions reach the staged scheduler methods */
		if (state === void 0) throw new Error("tool registry scheduler invariant violated: missing cancellation state");
		return state.callerSignal.aborted;
	}
	/** Canonical cancellation outcome selected by whether the tool body started. */
	cancellationResult(exec, prior) {
		const state = this.cancellationStates.get(exec);
		/* v8 ignore next -- only registry-minted executions reach the staged scheduler methods */
		if (state === void 0) throw new Error("tool registry scheduler invariant violated: missing cancellation state");
		return state.bodyInvoked ? toolAbortedResult(prior) : toolAbortedBeforeDispatchResult(prior);
	}
	/**
	* Dispatch the registered body with the original caller signal fused back
	* into any around-wrapper replacement. Cancellation never abandons the body:
	* a started promise reaches quiescence before its outcome becomes `ABORTED`.
	*/
	async dispatchToolBody(exec) {
		const state = this.cancellationStates.get(exec);
		/* v8 ignore next -- only registry-minted executions reach the staged scheduler methods */
		if (state === void 0) throw new Error("tool registry scheduler invariant violated: missing cancellation state");
		const wrapperSignal = exec.signal;
		const fused = fuseToolSignals(state.callerSignal, wrapperSignal);
		const signal = fused.signal;
		if (isAborted(signal)) {
			fused.dispose();
			return toolAbortedBeforeDispatchResult();
		}
		exec.signal = signal;
		try {
			const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== void 0);
			if (!tool) throw new ToolNotFoundError(exec.name);
			state.bodyInvoked = true;
			const returned = await tool.execute(exec.arguments, exec);
			const result = this.createSuccessResult(exec, tool, returned);
			return isAborted(signal) ? toolAbortedResult(result) : result;
		} catch (error) {
			return toolErrorResult(error);
		} finally {
			fused.dispose();
			exec.signal = wrapperSignal;
		}
	}
	/**
	* Run around-dispatch and the tool body. Tool and unknown-tool failures still
	* receive post-execute; pipeline failures are already final.
	* @param exec - the prepared execution.
	* @returns whether the result still needs post-execute.
	* @internal
	*/
	async dispatchScheduledExecution(exec) {
		try {
			const mutableExec = exec;
			const carrier = scopeTarget(this, exec.agent);
			const result = await this.ctx.waterfall(carrier, "tools/execute", mutableExec, () => this.dispatchToolBody(mutableExec));
			const normalized = this.normalizeDispatchResult(exec, result);
			const deferredContexts = this.deferredContexts.get(exec);
			/* v8 ignore next -- dispatch only receives executions minted by this registry's prepare stage */
			if (deferredContexts === void 0) throw new Error("tool registry scheduler invariant violated: unprepared execution");
			const resultWithDeferredContexts = deferredContexts.length === 0 ? normalized : this.markCanonical(exec, {
				...normalized,
				additionalContexts: [...deferredContexts, ...normalized.additionalContexts ?? []]
			});
			return {
				kind: "post-result",
				result: this.callerCancelled(exec) && !resultWithDeferredContexts.isError ? this.cancellationResult(exec, resultWithDeferredContexts) : resultWithDeferredContexts
			};
		} catch (error) {
			return {
				kind: "final-result",
				result: toolErrorResult(error)
			};
		}
	}
	/**
	* Run ordered post-execute, then apply definition-owned content finalization,
	* materialize, and notify the final outcome.
	* @param exec - the prepared execution.
	* @param result - dispatch/pre result that still needs post-execute.
	* @returns the materialized final result.
	* @internal
	*/
	async finalizeScheduledExecution(exec, result) {
		try {
			const postResult = await this.postExecute(exec, result);
			return this.finishScheduledExecution(exec, this.callerCancelled(exec) && !postResult.isError ? this.cancellationResult(exec, postResult) : postResult);
		} catch (error) {
			return this.finishScheduledExecution(exec, toolErrorResult(error));
		}
	}
	/**
	* Materialize the candidate, apply definition-owned content finalization,
	* then materialize and notify the authoritative result.
	* @param exec - the prepared execution.
	* @param result - final result.
	* @returns the materialized final result.
	* @internal
	*/
	finishScheduledExecution(exec, result) {
		let materializedResult;
		try {
			materializedResult = this.materializeFinalResult(result);
		} catch (error) {
			materializedResult = this.materializeFinalResult(toolErrorResult(error));
		}
		let finalResult;
		try {
			finalResult = this.materializeFinalResult(this.applyFinalContent(exec, materializedResult));
		} catch (error) {
			finalResult = this.materializeFinalResult(toolErrorResult(error));
		}
		this.notifyResult(exec, finalResult);
		return finalResult;
	}
	/** Apply the snapshotted tool-owned content transform without exposing other result fields. */
	applyFinalContent(exec, result) {
		const finalizeContent = this.contentFinalizers.get(exec);
		if (finalizeContent === void 0) return result;
		const content = finalizeContent(exec, result);
		return content === void 0 ? result : {
			...result,
			content
		};
	}
	/** Notify observers without exposing a mutation or error channel into the outcome. */
	notifyResult(exec, result) {
		Object.freeze(exec);
		const { name: toolName, callId } = exec;
		const reportFailure = (error) => {
			this.ctx.logger.warn(`tool "${toolName}" (${callId}): tools/result observer failed: ${errorMessage$1(error)}`);
		};
		const callbacks = this.ctx.events.dispatch("emit", [
			scopeTarget(this, exec.agent),
			"tools/result",
			exec,
			result
		]);
		for (const callback of callbacks) try {
			const returned = callback(exec, result);
			Promise.resolve(returned).catch(reportFailure);
		} catch (error) {
			reportFailure(error);
		}
	}
	/**
	* Resolve an `ask` decision to allow/deny through the approval seam. The
	* seam is consumed opportunistically with `ctx.get('approval')` — a
	* deployment that composes no ApprovalService keeps the historical degrade
	* to deny, and an unmount mid-session degrades the same way on the next ask.
	* An agent-less execution also degrades: without an agent there is no
	* session to audit to and no UI to route to. Otherwise the outcome maps
	* one-to-one — `allowed-once` proceeds; the three non-grants deny with
	* distinct reasons so the model can tell a human "no" from an absent
	* approval channel.
	*/
	async serviceAsk(exec, ask) {
		const approval = this.ctx.get("approval");
		if (approval === void 0) return {
			decision: {
				kind: "deny",
				reason: ask.reason ?? `tool "${exec.name}" requires approval (not yet supported)`
			},
			approvalCancelled: false
		};
		if (exec.agent === void 0) return {
			decision: {
				kind: "deny",
				reason: `tool "${exec.name}" requires approval, but the call has no agent to route it through`
			},
			approvalCancelled: false
		};
		const outcome = await approval.request({
			agent: exec.agent,
			toolName: exec.name,
			callId: exec.callId,
			...ask.reason !== void 0 ? { reason: ask.reason } : {},
			signal: exec.signal
		});
		switch (outcome) {
			case "allowed-once": return {
				decision: { kind: "allow" },
				approvalCancelled: false
			};
			case "rejected": return {
				decision: {
					kind: "deny",
					reason: `the user rejected tool "${exec.name}"`
				},
				approvalCancelled: false
			};
			case "cancelled": return {
				decision: {
					kind: "deny",
					reason: `approval for tool "${exec.name}" was cancelled`
				},
				approvalCancelled: true
			};
			case "unavailable": return {
				decision: {
					kind: "deny",
					reason: `tool "${exec.name}" requires approval, but no approval channel is available`
				},
				approvalCancelled: false
			};
			default: return assertNever(outcome, "ApprovalOutcome");
		}
	}
	/**
	* Run the `tools/post-execute` waterfall over a dispatched `result` and apply
	* its {@link PostToolDecision}: `accept` keeps the call successful (replacing
	* `content` when given), `block` turns it into an `isError` whose content is
	* the corrective `feedback`. Either decision may attach `additionalContexts`,
	* which are ferried on the returned result for the loop's active-batch FIFO.
	* Context deferred by the tool body survives an accepted result but is
	* discarded when the outer call is blocked; a block exposes only context the
	* blocking decision explicitly supplied.
	* Runs inside `execute`'s outer try/catch (a throwing listener → isError).
	*/
	async postExecute(exec, result) {
		const decision = await this.ctx.waterfall(scopeTarget(this, exec.agent), "tools/post-execute", exec, result, () => Promise.resolve({ kind: "accept" }));
		const decisionContexts = decision.additionalContexts ?? [];
		if (decision.kind === "block") {
			const message = failureMessageFromContent(decision.feedback);
			return this.markCanonical(exec, {
				content: decision.feedback,
				isError: true,
				error: { message },
				...decisionContexts.length > 0 ? { additionalContexts: decisionContexts } : {}
			});
		}
		if (Object.hasOwn(decision, "content") && Object.hasOwn(decision, "value")) throw new TypeError("tools/post-execute accept decision cannot replace both value and content");
		const additionalContexts = [...result.additionalContexts ?? [], ...decisionContexts];
		if (Object.hasOwn(decision, "value")) {
			if (result.isError) throw new TypeError("tools/post-execute cannot replace the value of a failed result");
			const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== void 0);
			if (tool === void 0) throw new ToolNotFoundError(exec.name);
			const replaced = this.createSuccessResult(exec, tool, decision.value);
			return this.markCanonical(exec, {
				...replaced,
				...additionalContexts.length > 0 ? { additionalContexts } : {}
			});
		}
		return this.markCanonical(exec, {
			...result,
			...decision.content !== void 0 ? { content: decision.content } : {},
			...additionalContexts.length > 0 ? { additionalContexts } : {}
		});
	}
	/** Registry-normalized results and the exact dispatch that validated each value. */
	canonicalResults = /* @__PURE__ */ new WeakMap();
	/** Mark one registry-normalized result as canonical only for its owning dispatch. */
	markCanonical(exec, result) {
		this.canonicalResults.set(result, exec.token);
		return result;
	}
	/** Snapshot, validate, render, and optionally project one successful body value. */
	createSuccessResult(exec, tool, candidate) {
		const detached = snapshotToolValue(tool.name, candidate);
		const violations = validateJsonSchemaValue(tool.output.schema, detached, "value");
		if (violations.length > 0) throw new ToolOutputError(tool.name, violations);
		const value = deepFreeze(detached);
		let rendered;
		try {
			rendered = tool.output.render(exec.arguments, value);
		} catch (error) {
			throw projectionError(tool.name, "render", error);
		}
		const content = snapshotProjection(tool.name, "render", rendered);
		let meta;
		if (exec.parent === void 0 && tool.output.presentationMeta !== void 0) {
			let projected;
			try {
				projected = tool.output.presentationMeta(exec.arguments, value);
			} catch (error) {
				throw projectionError(tool.name, "presentationMeta", error);
			}
			meta = snapshotProjection(tool.name, "presentationMeta", projected);
		}
		const concludesTurn = this.concludingExecutions.has(exec);
		return this.markCanonical(exec, this.materializeFinalResult({
			isError: false,
			value,
			content,
			...meta !== void 0 ? { meta } : {},
			...concludesTurn ? { concludesTurn: true } : {}
		}));
	}
	/** Normalize an around-dispatch wrapper's authored result through the owning output contract. */
	normalizeDispatchResult(exec, result) {
		if (this.canonicalResults.get(result) === exec.token) return result;
		if (result.isError) return this.markCanonical(exec, {
			isError: true,
			error: result.error,
			content: result.content,
			...result.meta !== void 0 ? { meta: result.meta } : {},
			...result.additionalContexts !== void 0 ? { additionalContexts: result.additionalContexts } : {}
		});
		const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== void 0);
		if (tool === void 0) throw new ToolNotFoundError(exec.name);
		const normalized = this.createSuccessResult(exec, tool, result.value);
		return this.markCanonical(exec, {
			...normalized,
			...result.additionalContexts !== void 0 ? { additionalContexts: result.additionalContexts } : {}
		});
	}
	/** Materialize the authoritative commit outcome once, immediately before `tools/result`. */
	materializeFinalResult(result) {
		const presentation = {
			content: result.content,
			...result.meta !== void 0 ? { meta: result.meta } : {},
			...result.additionalContexts !== void 0 ? { additionalContexts: result.additionalContexts } : {}
		};
		if (result.isError) return materializePresentation({
			isError: true,
			error: result.error,
			...presentation
		});
		return deepFreeze({
			...materializePresentation({
				isError: false,
				...presentation,
				...result.concludesTurn === true ? { concludesTurn: true } : {}
			}),
			value: result.value
		});
	}
});
/** Mint a same-process correlation token whose identity is its value. */
function createExecutionToken() {
	return Symbol("dsh.tool.execution");
}
function toolErrorResult(error) {
	const info = errorInfo(error);
	const message = errorMessage$1(error);
	return {
		content: [{
			type: "text",
			text: `Error: ${message}`
		}],
		isError: true,
		error: {
			message,
			...info ? { info } : {}
		}
	};
}
/** Read live abort state across an await without treating it as synchronously immutable. */
function isAborted(signal) {
	return signal.aborted;
}
/**
* Fuse caller and wrapper cancellation without nesting `AbortSignal.any`.
* Keeping the relay dispatch-scoped also removes listeners when work settles.
*/
function fuseToolSignals(caller, wrapper) {
	if (caller === wrapper) return {
		signal: caller,
		dispose() {}
	};
	const controller = new AbortController();
	let listening = false;
	const dispose = () => {
		if (!listening) return;
		listening = false;
		caller.removeEventListener("abort", abortFromCaller);
		wrapper.removeEventListener("abort", abortFromWrapper);
	};
	const abortFrom = (source) => {
		const reason = source.reason;
		controller.abort(reason);
		dispose();
	};
	const abortFromCaller = () => {
		abortFrom(caller);
	};
	const abortFromWrapper = () => {
		abortFrom(wrapper);
	};
	if (wrapper.aborted) abortFromWrapper();
	else if (caller.aborted) abortFromCaller();
	else {
		listening = true;
		caller.addEventListener("abort", abortFromCaller, { once: true });
		wrapper.addEventListener("abort", abortFromWrapper, { once: true });
	}
	return {
		signal: controller.signal,
		dispose
	};
}
/** Canonical result when cancellation supersedes success after body invocation. */
function toolAbortedResult(prior) {
	const additionalContexts = prior?.additionalContexts ?? [];
	return {
		content: [{
			type: "text",
			text: "Error: tool call aborted"
		}],
		isError: true,
		error: {
			message: "tool call aborted",
			info: {
				name: "AbortError",
				code: TOOL_ABORTED
			}
		},
		...additionalContexts.length > 0 ? { additionalContexts } : {}
	};
}
/** Canonical result when cancellation prevents tool body invocation. */
function toolAbortedBeforeDispatchResult(prior) {
	const additionalContexts = prior?.additionalContexts ?? [];
	return {
		content: [{
			type: "text",
			text: "Error: tool call aborted before dispatch"
		}],
		isError: true,
		error: {
			message: "tool call aborted before dispatch",
			info: {
				name: "AbortError",
				code: TOOL_ABORTED_BEFORE_DISPATCH
			}
		},
		...additionalContexts.length > 0 ? { additionalContexts } : {}
	};
}
//#endregion
//#region ../../../Core/util/time/src/index.ts
/**
* Time vocabulary shared by the wire boundaries that accept a caller's zone.
* Validation and canonicalization only: this library formats nothing and owns
* no failure vocabulary — each boundary declares and throws its own refusal.
* @module @deepseek-ai/dsh-util-time
*/
/** Strict browser-zone profile: UTC or an IANA Area/Location-style identifier. */
const IANA_TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)+$/;
/**
* Validate and canonicalize one caller-supplied IANA zone at a wire boundary.
*
* The canonical name is what a later reader needs: a zone identity is stored on
* durable records and resolved again by another process, so an alias accepted
* here would not compare equal to the zone a reader derives.
* @param value - the caller's reported zone name.
* @returns the canonical zone, or `undefined` when the name is unusable.
*/
function canonicalClientTimeZone(value) {
	if (value.length === 0 || value.trim() !== value || value !== "UTC" && !IANA_TIME_ZONE.test(value)) return void 0;
	try {
		const canonical = new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
		/* v8 ignore next -- Intl returns UTC or a canonical IANA Area/Location for accepted input. */
		if (canonical !== "UTC" && !IANA_TIME_ZONE.test(canonical)) return void 0;
		return canonical;
	} catch {
		return;
	}
}
//#endregion
//#region ../../../Modules/Official/attachment/attachment/src/error.ts
/** Attachment failure class. @module @deepseek-ai/dsh-attachment/error */
const IMAGE_ADMISSION_ERROR_CODES = [
	"TOO_MANY_IMAGES",
	"IMAGES_TOO_LARGE",
	"UNSUPPORTED_IMAGE_TYPE",
	"INVALID_IMAGE_BASE64",
	"INVALID_IMAGE",
	"IMAGE_TYPE_MISMATCH",
	"IMAGE_TOO_LARGE",
	"IMAGE_TOO_MANY_PIXELS",
	"IMAGE_DIMENSION_TOO_LARGE"
];
const ATTACHMENT_ERROR_CODES = [
	...IMAGE_ADMISSION_ERROR_CODES,
	"INVALID_FILE_BASE64",
	"INVALID_ATTACHMENT_REF",
	"ATTACHMENT_CORRUPT",
	"ATTACHMENT_WRITE_FAILED",
	"ATTACHMENT_NOT_FOUND",
	"ATTACHMENT_READ_FAILED",
	"ATTACHMENT_PROJECTION_UNSUPPORTED",
	"ATTACHMENT_FILES_UNSUPPORTED"
];
new Set(IMAGE_ADMISSION_ERROR_CODES);
new Set(ATTACHMENT_ERROR_CODES);
/**
* Stable failures suitable for host RPC error mapping.
*
* Deliberately re-implements the `HarnessError` shape instead of extending it:
* the base lives in `@deepseek-ai/dsh-llm`, which itself depends on this
* package (`ImageBlock` references `ImageAttachmentRef`), so sharing the base
* would create a dependency cycle. Consumers route on `code`, never on the
* prototype chain, so the shapes stay interchangeable at the wire boundary.
*/
var AttachmentError = class extends Error {
	/** Stable machine-routing failure code. */
	code;
	/**
	* @param message - human-readable failure description without raw bytes or host paths.
	* @param code - stable machine-routing code.
	* @param options - optional chained cause.
	*/
	constructor(message, code, options) {
		super(message, options);
		this.name = "AttachmentError";
		this.code = code;
	}
};
//#endregion
//#region ../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/core.js
var _a$1;
function $constructor(name, initializer, params) {
	function init(inst, def) {
		if (!inst._zod) Object.defineProperty(inst, "_zod", {
			value: {
				def,
				constr: _,
				traits: /* @__PURE__ */ new Set()
			},
			enumerable: false
		});
		if (inst._zod.traits.has(name)) return;
		inst._zod.traits.add(name);
		initializer(inst, def);
		const proto = _.prototype;
		const keys = Object.keys(proto);
		for (let i = 0; i < keys.length; i++) {
			const k = keys[i];
			if (!(k in inst)) inst[k] = proto[k].bind(inst);
		}
	}
	const Parent = params?.Parent ?? Object;
	class Definition extends Parent {}
	Object.defineProperty(Definition, "name", { value: name });
	function _(def) {
		var _a;
		const inst = params?.Parent ? new Definition() : this;
		init(inst, def);
		(_a = inst._zod).deferred ?? (_a.deferred = []);
		for (const fn of inst._zod.deferred) fn();
		return inst;
	}
	Object.defineProperty(_, "init", { value: init });
	Object.defineProperty(_, Symbol.hasInstance, { value: (inst) => {
		if (params?.Parent && inst instanceof params.Parent) return true;
		return inst?._zod?.traits?.has(name);
	} });
	Object.defineProperty(_, "name", { value: name });
	return _;
}
var $ZodAsyncError = class extends Error {
	constructor() {
		super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
	}
};
var $ZodEncodeError = class extends Error {
	constructor(name) {
		super(`Encountered unidirectional transform during encode: ${name}`);
		this.name = "ZodEncodeError";
	}
};
(_a$1 = globalThis).__zod_globalConfig ?? (_a$1.__zod_globalConfig = {});
const globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
	if (newConfig) Object.assign(globalConfig, newConfig);
	return globalConfig;
}
//#endregion
//#region ../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/util.js
function getEnumValues(entries) {
	const numericValues = Object.values(entries).filter((v) => typeof v === "number");
	return Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
}
function jsonStringifyReplacer(_, value) {
	if (typeof value === "bigint") return value.toString();
	return value;
}
function cached$1(getter) {
	return { get value() {
		{
			const value = getter();
			Object.defineProperty(this, "value", { value });
			return value;
		}
		throw new Error("cached value already set");
	} };
}
function nullish(input) {
	return input === null || input === void 0;
}
function cleanRegex(source) {
	const start = source.startsWith("^") ? 1 : 0;
	const end = source.endsWith("$") ? source.length - 1 : source.length;
	return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
	const ratio = val / step;
	const roundedRatio = Math.round(ratio);
	const tolerance = Number.EPSILON * Math.max(Math.abs(ratio), 1);
	if (Math.abs(ratio - roundedRatio) < tolerance) return 0;
	return ratio - roundedRatio;
}
const EVALUATING = /* @__PURE__*/ Symbol("evaluating");
function defineLazy(object, key, getter) {
	let value = void 0;
	Object.defineProperty(object, key, {
		get() {
			if (value === EVALUATING) return;
			if (value === void 0) {
				value = EVALUATING;
				value = getter();
			}
			return value;
		},
		set(v) {
			Object.defineProperty(object, key, { value: v });
		},
		configurable: true
	});
}
function assignProp(target, prop, value) {
	Object.defineProperty(target, prop, {
		value,
		writable: true,
		enumerable: true,
		configurable: true
	});
}
function mergeDefs(...defs) {
	const mergedDescriptors = {};
	for (const def of defs) Object.assign(mergedDescriptors, Object.getOwnPropertyDescriptors(def));
	return Object.defineProperties({}, mergedDescriptors);
}
function esc(str) {
	return JSON.stringify(str);
}
function slugify(input) {
	return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
const captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
function isObject(data) {
	return typeof data === "object" && data !== null && !Array.isArray(data);
}
const allowsEval = /* @__PURE__*/ cached$1(() => {
	if (globalConfig.jitless) return false;
	if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) return false;
	try {
		new Function("");
		return true;
	} catch (_) {
		return false;
	}
});
function isPlainObject(o) {
	if (isObject(o) === false) return false;
	const ctor = o.constructor;
	if (ctor === void 0) return true;
	if (typeof ctor !== "function") return true;
	const prot = ctor.prototype;
	if (isObject(prot) === false) return false;
	if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) return false;
	return true;
}
function shallowClone(o) {
	if (isPlainObject(o)) return { ...o };
	if (Array.isArray(o)) return [...o];
	if (o instanceof Map) return new Map(o);
	if (o instanceof Set) return new Set(o);
	return o;
}
const propertyKeyTypes = /* @__PURE__*/ new Set([
	"string",
	"number",
	"symbol"
]);
function escapeRegex(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
	const cl = new inst._zod.constr(def ?? inst._zod.def);
	if (!def || params?.parent) cl._zod.parent = inst;
	return cl;
}
function normalizeParams(_params) {
	const params = _params;
	if (!params) return {};
	if (typeof params === "string") return { error: () => params };
	if (params?.message !== void 0) {
		if (params?.error !== void 0) throw new Error("Cannot specify both `message` and `error` params");
		params.error = params.message;
	}
	delete params.message;
	if (typeof params.error === "string") return {
		...params,
		error: () => params.error
	};
	return params;
}
function optionalKeys(shape) {
	return Object.keys(shape).filter((k) => {
		return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
	});
}
const NUMBER_FORMAT_RANGES = {
	safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
	int32: [-2147483648, 2147483647],
	uint32: [0, 4294967295],
	float32: [-34028234663852886e22, 34028234663852886e22],
	float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
function pick(schema, mask) {
	const currDef = schema._zod.def;
	const checks = currDef.checks;
	if (checks && checks.length > 0) throw new Error(".pick() cannot be used on object schemas containing refinements");
	return clone(schema, mergeDefs(schema._zod.def, {
		get shape() {
			const newShape = {};
			for (const key in mask) {
				if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
				if (!mask[key]) continue;
				newShape[key] = currDef.shape[key];
			}
			assignProp(this, "shape", newShape);
			return newShape;
		},
		checks: []
	}));
}
function omit(schema, mask) {
	const currDef = schema._zod.def;
	const checks = currDef.checks;
	if (checks && checks.length > 0) throw new Error(".omit() cannot be used on object schemas containing refinements");
	return clone(schema, mergeDefs(schema._zod.def, {
		get shape() {
			const newShape = { ...schema._zod.def.shape };
			for (const key in mask) {
				if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
				if (!mask[key]) continue;
				delete newShape[key];
			}
			assignProp(this, "shape", newShape);
			return newShape;
		},
		checks: []
	}));
}
function extend(schema, shape) {
	if (!isPlainObject(shape)) throw new Error("Invalid input to extend: expected a plain object");
	const checks = schema._zod.def.checks;
	if (checks && checks.length > 0) {
		const existingShape = schema._zod.def.shape;
		for (const key in shape) if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
	}
	return clone(schema, mergeDefs(schema._zod.def, { get shape() {
		const _shape = {
			...schema._zod.def.shape,
			...shape
		};
		assignProp(this, "shape", _shape);
		return _shape;
	} }));
}
function safeExtend(schema, shape) {
	if (!isPlainObject(shape)) throw new Error("Invalid input to safeExtend: expected a plain object");
	return clone(schema, mergeDefs(schema._zod.def, { get shape() {
		const _shape = {
			...schema._zod.def.shape,
			...shape
		};
		assignProp(this, "shape", _shape);
		return _shape;
	} }));
}
function merge(a, b) {
	if (a._zod.def.checks?.length) throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
	return clone(a, mergeDefs(a._zod.def, {
		get shape() {
			const _shape = {
				...a._zod.def.shape,
				...b._zod.def.shape
			};
			assignProp(this, "shape", _shape);
			return _shape;
		},
		get catchall() {
			return b._zod.def.catchall;
		},
		checks: b._zod.def.checks ?? []
	}));
}
function partial(Class, schema, mask) {
	const checks = schema._zod.def.checks;
	if (checks && checks.length > 0) throw new Error(".partial() cannot be used on object schemas containing refinements");
	return clone(schema, mergeDefs(schema._zod.def, {
		get shape() {
			const oldShape = schema._zod.def.shape;
			const shape = { ...oldShape };
			if (mask) for (const key in mask) {
				if (!(key in oldShape)) throw new Error(`Unrecognized key: "${key}"`);
				if (!mask[key]) continue;
				shape[key] = Class ? new Class({
					type: "optional",
					innerType: oldShape[key]
				}) : oldShape[key];
			}
			else for (const key in oldShape) shape[key] = Class ? new Class({
				type: "optional",
				innerType: oldShape[key]
			}) : oldShape[key];
			assignProp(this, "shape", shape);
			return shape;
		},
		checks: []
	}));
}
function required(Class, schema, mask) {
	return clone(schema, mergeDefs(schema._zod.def, { get shape() {
		const oldShape = schema._zod.def.shape;
		const shape = { ...oldShape };
		if (mask) for (const key in mask) {
			if (!(key in shape)) throw new Error(`Unrecognized key: "${key}"`);
			if (!mask[key]) continue;
			shape[key] = new Class({
				type: "nonoptional",
				innerType: oldShape[key]
			});
		}
		else for (const key in oldShape) shape[key] = new Class({
			type: "nonoptional",
			innerType: oldShape[key]
		});
		assignProp(this, "shape", shape);
		return shape;
	} }));
}
function aborted(x, startIndex = 0) {
	if (x.aborted === true) return true;
	for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue !== true) return true;
	return false;
}
function explicitlyAborted(x, startIndex = 0) {
	if (x.aborted === true) return true;
	for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue === false) return true;
	return false;
}
function prefixIssues(path, issues) {
	return issues.map((iss) => {
		var _a;
		(_a = iss).path ?? (_a.path = []);
		iss.path.unshift(path);
		return iss;
	});
}
function unwrapMessage(message) {
	return typeof message === "string" ? message : message?.message;
}
function finalizeIssue(iss, ctx, config) {
	const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
	const { inst: _inst, continue: _continue, input: _input, ...rest } = iss;
	rest.path ?? (rest.path = []);
	rest.message = message;
	if (ctx?.reportInput) rest.input = _input;
	return rest;
}
function getLengthableOrigin(input) {
	if (Array.isArray(input)) return "array";
	if (typeof input === "string") return "string";
	return "unknown";
}
function issue(...args) {
	const [iss, input, inst] = args;
	if (typeof iss === "string") return {
		message: iss,
		code: "custom",
		input,
		inst
	};
	return { ...iss };
}
//#endregion
//#region ../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/errors.js
const initializer$1 = (inst, def) => {
	inst.name = "$ZodError";
	Object.defineProperty(inst, "_zod", {
		value: inst._zod,
		enumerable: false
	});
	Object.defineProperty(inst, "issues", {
		value: def,
		enumerable: false
	});
	inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
	Object.defineProperty(inst, "toString", {
		value: () => inst.message,
		enumerable: false
	});
};
const $ZodError = $constructor("$ZodError", initializer$1);
const $ZodRealError = $constructor("$ZodError", initializer$1, { Parent: Error });
function flattenError(error, mapper = (issue) => issue.message) {
	const fieldErrors = {};
	const formErrors = [];
	for (const sub of error.issues) if (sub.path.length > 0) {
		fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
		fieldErrors[sub.path[0]].push(mapper(sub));
	} else formErrors.push(mapper(sub));
	return {
		formErrors,
		fieldErrors
	};
}
function formatError(error, mapper = (issue) => issue.message) {
	const fieldErrors = { _errors: [] };
	const processError = (error, path = []) => {
		for (const issue of error.issues) if (issue.code === "invalid_union" && issue.errors.length) issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
		else if (issue.code === "invalid_key") processError({ issues: issue.issues }, [...path, ...issue.path]);
		else if (issue.code === "invalid_element") processError({ issues: issue.issues }, [...path, ...issue.path]);
		else {
			const fullpath = [...path, ...issue.path];
			if (fullpath.length === 0) fieldErrors._errors.push(mapper(issue));
			else {
				let curr = fieldErrors;
				let i = 0;
				while (i < fullpath.length) {
					const el = fullpath[i];
					if (!(i === fullpath.length - 1)) curr[el] = curr[el] || { _errors: [] };
					else {
						curr[el] = curr[el] || { _errors: [] };
						curr[el]._errors.push(mapper(issue));
					}
					curr = curr[el];
					i++;
				}
			}
		}
	};
	processError(error);
	return fieldErrors;
}
//#endregion
//#region ../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/parse.js
const _parse = (_Err) => (schema, value, _ctx, _params) => {
	const ctx = _ctx ? {
		..._ctx,
		async: false
	} : { async: false };
	const result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) throw new $ZodAsyncError();
	if (result.issues.length) {
		const e = new ((_params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
		captureStackTrace(e, _params?.callee);
		throw e;
	}
	return result.value;
};
const _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
	const ctx = _ctx ? {
		..._ctx,
		async: true
	} : { async: true };
	let result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) result = await result;
	if (result.issues.length) {
		const e = new ((params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
		captureStackTrace(e, params?.callee);
		throw e;
	}
	return result.value;
};
const _safeParse = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		async: false
	} : { async: false };
	const result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) throw new $ZodAsyncError();
	return result.issues.length ? {
		success: false,
		error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	} : {
		success: true,
		data: result.value
	};
};
const safeParse$1 = /* @__PURE__*/ _safeParse($ZodRealError);
const _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		async: true
	} : { async: true };
	let result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) result = await result;
	return result.issues.length ? {
		success: false,
		error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	} : {
		success: true,
		data: result.value
	};
};
const safeParseAsync$1 = /* @__PURE__*/ _safeParseAsync($ZodRealError);
const _encode = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _parse(_Err)(schema, value, ctx);
};
const _decode = (_Err) => (schema, value, _ctx) => {
	return _parse(_Err)(schema, value, _ctx);
};
const _encodeAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _parseAsync(_Err)(schema, value, ctx);
};
const _decodeAsync = (_Err) => async (schema, value, _ctx) => {
	return _parseAsync(_Err)(schema, value, _ctx);
};
const _safeEncode = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _safeParse(_Err)(schema, value, ctx);
};
const _safeDecode = (_Err) => (schema, value, _ctx) => {
	return _safeParse(_Err)(schema, value, _ctx);
};
const _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _safeParseAsync(_Err)(schema, value, ctx);
};
const _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
	return _safeParseAsync(_Err)(schema, value, _ctx);
};
//#endregion
//#region ../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/regexes.js
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link cuid2} instead.
* See https://github.com/paralleldrive/cuid.
*/
const cuid = /^[cC][0-9a-z]{6,}$/;
const cuid2 = /^[0-9a-z]+$/;
const ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
const xid = /^[0-9a-vA-V]{20}$/;
const ksuid = /^[A-Za-z0-9]{27}$/;
const nanoid = /^[a-zA-Z0-9_-]{21}$/;
/** ISO 8601-1 duration regex. Does not support the 8601-2 extensions like negative durations or fractional/negative components. */
const duration$1 = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
/** A regex for any UUID-like identifier: 8-4-4-4-12 hex pattern */
const guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
/** Returns a regex for validating an RFC 9562/4122 UUID.
*
* @param version Optionally specify a version 1-8. If no version is specified, all versions are supported. */
const uuid = (version) => {
	if (!version) return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
	return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
/** Practical email validation */
const email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
const _emoji$1 = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
function emoji() {
	return new RegExp(_emoji$1, "u");
}
const ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
const ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
const cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
const cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
const base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
const base64url = /^[A-Za-z0-9_-]*$/;
const httpProtocol = /^https?$/;
const e164 = /^\+[1-9]\d{6,14}$/;
const dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
const date$1 = /*@__PURE__*/ new RegExp(`^${dateSource}$`);
function timeSource(args) {
	const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
	return typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function time$1(args) {
	return new RegExp(`^${timeSource(args)}$`);
}
function datetime$1(args) {
	const time = timeSource({ precision: args.precision });
	const opts = ["Z"];
	if (args.local) opts.push("");
	if (args.offset) opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
	const timeRegex = `${time}(?:${opts.join("|")})`;
	return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
const string$1 = (params) => {
	const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
	return new RegExp(`^${regex}$`);
};
const integer = /^-?\d+$/;
const number$1 = /^-?\d+(?:\.\d+)?$/;
const boolean$1 = /^(?:true|false)$/i;
const lowercase = /^[^A-Z]*$/;
const uppercase = /^[^a-z]*$/;
//#endregion
//#region ../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/checks.js
const $ZodCheck = /*@__PURE__*/ $constructor("$ZodCheck", (inst, def) => {
	var _a;
	inst._zod ?? (inst._zod = {});
	inst._zod.def = def;
	(_a = inst._zod).onattach ?? (_a.onattach = []);
});
const numericOriginMap = {
	number: "number",
	bigint: "bigint",
	object: "date"
};
const $ZodCheckLessThan = /*@__PURE__*/ $constructor("$ZodCheckLessThan", (inst, def) => {
	$ZodCheck.init(inst, def);
	const origin = numericOriginMap[typeof def.value];
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
		if (def.value < curr) if (def.inclusive) bag.maximum = def.value;
		else bag.exclusiveMaximum = def.value;
	});
	inst._zod.check = (payload) => {
		if (def.inclusive ? payload.value <= def.value : payload.value < def.value) return;
		payload.issues.push({
			origin,
			code: "too_big",
			maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
			input: payload.value,
			inclusive: def.inclusive,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckGreaterThan = /*@__PURE__*/ $constructor("$ZodCheckGreaterThan", (inst, def) => {
	$ZodCheck.init(inst, def);
	const origin = numericOriginMap[typeof def.value];
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
		if (def.value > curr) if (def.inclusive) bag.minimum = def.value;
		else bag.exclusiveMinimum = def.value;
	});
	inst._zod.check = (payload) => {
		if (def.inclusive ? payload.value >= def.value : payload.value > def.value) return;
		payload.issues.push({
			origin,
			code: "too_small",
			minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
			input: payload.value,
			inclusive: def.inclusive,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckMultipleOf = /*@__PURE__*/ $constructor("$ZodCheckMultipleOf", (inst, def) => {
	$ZodCheck.init(inst, def);
	inst._zod.onattach.push((inst) => {
		var _a;
		(_a = inst._zod.bag).multipleOf ?? (_a.multipleOf = def.value);
	});
	inst._zod.check = (payload) => {
		if (typeof payload.value !== typeof def.value) throw new Error("Cannot mix number and bigint in multiple_of check.");
		if (typeof payload.value === "bigint" ? payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0) return;
		payload.issues.push({
			origin: typeof payload.value,
			code: "not_multiple_of",
			divisor: def.value,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckNumberFormat = /*@__PURE__*/ $constructor("$ZodCheckNumberFormat", (inst, def) => {
	$ZodCheck.init(inst, def);
	def.format = def.format || "float64";
	const isInt = def.format?.includes("int");
	const origin = isInt ? "int" : "number";
	const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.format = def.format;
		bag.minimum = minimum;
		bag.maximum = maximum;
		if (isInt) bag.pattern = integer;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		if (isInt) {
			if (!Number.isInteger(input)) {
				payload.issues.push({
					expected: origin,
					format: def.format,
					code: "invalid_type",
					continue: false,
					input,
					inst
				});
				return;
			}
			if (!Number.isSafeInteger(input)) {
				if (input > 0) payload.issues.push({
					input,
					code: "too_big",
					maximum: Number.MAX_SAFE_INTEGER,
					note: "Integers must be within the safe integer range.",
					inst,
					origin,
					inclusive: true,
					continue: !def.abort
				});
				else payload.issues.push({
					input,
					code: "too_small",
					minimum: Number.MIN_SAFE_INTEGER,
					note: "Integers must be within the safe integer range.",
					inst,
					origin,
					inclusive: true,
					continue: !def.abort
				});
				return;
			}
		}
		if (input < minimum) payload.issues.push({
			origin: "number",
			input,
			code: "too_small",
			minimum,
			inclusive: true,
			inst,
			continue: !def.abort
		});
		if (input > maximum) payload.issues.push({
			origin: "number",
			input,
			code: "too_big",
			maximum,
			inclusive: true,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckMaxLength = /*@__PURE__*/ $constructor("$ZodCheckMaxLength", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = (payload) => {
		const val = payload.value;
		return !nullish(val) && val.length !== void 0;
	});
	inst._zod.onattach.push((inst) => {
		const curr = inst._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
		if (def.maximum < curr) inst._zod.bag.maximum = def.maximum;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		if (input.length <= def.maximum) return;
		const origin = getLengthableOrigin(input);
		payload.issues.push({
			origin,
			code: "too_big",
			maximum: def.maximum,
			inclusive: true,
			input,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckMinLength = /*@__PURE__*/ $constructor("$ZodCheckMinLength", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = (payload) => {
		const val = payload.value;
		return !nullish(val) && val.length !== void 0;
	});
	inst._zod.onattach.push((inst) => {
		const curr = inst._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
		if (def.minimum > curr) inst._zod.bag.minimum = def.minimum;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		if (input.length >= def.minimum) return;
		const origin = getLengthableOrigin(input);
		payload.issues.push({
			origin,
			code: "too_small",
			minimum: def.minimum,
			inclusive: true,
			input,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckLengthEquals = /*@__PURE__*/ $constructor("$ZodCheckLengthEquals", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = (payload) => {
		const val = payload.value;
		return !nullish(val) && val.length !== void 0;
	});
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.minimum = def.length;
		bag.maximum = def.length;
		bag.length = def.length;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		const length = input.length;
		if (length === def.length) return;
		const origin = getLengthableOrigin(input);
		const tooBig = length > def.length;
		payload.issues.push({
			origin,
			...tooBig ? {
				code: "too_big",
				maximum: def.length
			} : {
				code: "too_small",
				minimum: def.length
			},
			inclusive: true,
			exact: true,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckStringFormat = /*@__PURE__*/ $constructor("$ZodCheckStringFormat", (inst, def) => {
	var _a, _b;
	$ZodCheck.init(inst, def);
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.format = def.format;
		if (def.pattern) {
			bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
			bag.patterns.add(def.pattern);
		}
	});
	if (def.pattern) (_a = inst._zod).check ?? (_a.check = (payload) => {
		def.pattern.lastIndex = 0;
		if (def.pattern.test(payload.value)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: def.format,
			input: payload.value,
			...def.pattern ? { pattern: def.pattern.toString() } : {},
			inst,
			continue: !def.abort
		});
	});
	else (_b = inst._zod).check ?? (_b.check = () => {});
});
const $ZodCheckRegex = /*@__PURE__*/ $constructor("$ZodCheckRegex", (inst, def) => {
	$ZodCheckStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		def.pattern.lastIndex = 0;
		if (def.pattern.test(payload.value)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "regex",
			input: payload.value,
			pattern: def.pattern.toString(),
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckLowerCase = /*@__PURE__*/ $constructor("$ZodCheckLowerCase", (inst, def) => {
	def.pattern ?? (def.pattern = lowercase);
	$ZodCheckStringFormat.init(inst, def);
});
const $ZodCheckUpperCase = /*@__PURE__*/ $constructor("$ZodCheckUpperCase", (inst, def) => {
	def.pattern ?? (def.pattern = uppercase);
	$ZodCheckStringFormat.init(inst, def);
});
const $ZodCheckIncludes = /*@__PURE__*/ $constructor("$ZodCheckIncludes", (inst, def) => {
	$ZodCheck.init(inst, def);
	const escapedRegex = escapeRegex(def.includes);
	const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
	def.pattern = pattern;
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
		bag.patterns.add(pattern);
	});
	inst._zod.check = (payload) => {
		if (payload.value.includes(def.includes, def.position)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "includes",
			includes: def.includes,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckStartsWith = /*@__PURE__*/ $constructor("$ZodCheckStartsWith", (inst, def) => {
	$ZodCheck.init(inst, def);
	const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
	def.pattern ?? (def.pattern = pattern);
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
		bag.patterns.add(pattern);
	});
	inst._zod.check = (payload) => {
		if (payload.value.startsWith(def.prefix)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "starts_with",
			prefix: def.prefix,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckEndsWith = /*@__PURE__*/ $constructor("$ZodCheckEndsWith", (inst, def) => {
	$ZodCheck.init(inst, def);
	const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
	def.pattern ?? (def.pattern = pattern);
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
		bag.patterns.add(pattern);
	});
	inst._zod.check = (payload) => {
		if (payload.value.endsWith(def.suffix)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "ends_with",
			suffix: def.suffix,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckOverwrite = /*@__PURE__*/ $constructor("$ZodCheckOverwrite", (inst, def) => {
	$ZodCheck.init(inst, def);
	inst._zod.check = (payload) => {
		payload.value = def.tx(payload.value);
	};
});
//#endregion
//#region ../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/doc.js
var Doc = class {
	constructor(args = []) {
		this.content = [];
		this.indent = 0;
		if (this) this.args = args;
	}
	indented(fn) {
		this.indent += 1;
		fn(this);
		this.indent -= 1;
	}
	write(arg) {
		if (typeof arg === "function") {
			arg(this, { execution: "sync" });
			arg(this, { execution: "async" });
			return;
		}
		const lines = arg.split("\n").filter((x) => x);
		const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
		const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
		for (const line of dedented) this.content.push(line);
	}
	compile() {
		const F = Function;
		const args = this?.args;
		const lines = [...(this?.content ?? [``]).map((x) => `  ${x}`)];
		return new F(...args, lines.join("\n"));
	}
};
//#endregion
//#region ../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/versions.js
const version$1 = {
	major: 4,
	minor: 4,
	patch: 3
};
//#endregion
//#region ../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/schemas.js
const $ZodType = /*@__PURE__*/ $constructor("$ZodType", (inst, def) => {
	var _a;
	inst ?? (inst = {});
	inst._zod.def = def;
	inst._zod.bag = inst._zod.bag || {};
	inst._zod.version = version$1;
	const checks = [...inst._zod.def.checks ?? []];
	if (inst._zod.traits.has("$ZodCheck")) checks.unshift(inst);
	for (const ch of checks) for (const fn of ch._zod.onattach) fn(inst);
	if (checks.length === 0) {
		(_a = inst._zod).deferred ?? (_a.deferred = []);
		inst._zod.deferred?.push(() => {
			inst._zod.run = inst._zod.parse;
		});
	} else {
		const runChecks = (payload, checks, ctx) => {
			let isAborted = aborted(payload);
			let asyncResult;
			for (const ch of checks) {
				if (ch._zod.def.when) {
					if (explicitlyAborted(payload)) continue;
					if (!ch._zod.def.when(payload)) continue;
				} else if (isAborted) continue;
				const currLen = payload.issues.length;
				const _ = ch._zod.check(payload);
				if (_ instanceof Promise && ctx?.async === false) throw new $ZodAsyncError();
				if (asyncResult || _ instanceof Promise) asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
					await _;
					if (payload.issues.length === currLen) return;
					if (!isAborted) isAborted = aborted(payload, currLen);
				});
				else {
					if (payload.issues.length === currLen) continue;
					if (!isAborted) isAborted = aborted(payload, currLen);
				}
			}
			if (asyncResult) return asyncResult.then(() => {
				return payload;
			});
			return payload;
		};
		const handleCanaryResult = (canary, payload, ctx) => {
			if (aborted(canary)) {
				canary.aborted = true;
				return canary;
			}
			const checkResult = runChecks(payload, checks, ctx);
			if (checkResult instanceof Promise) {
				if (ctx.async === false) throw new $ZodAsyncError();
				return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
			}
			return inst._zod.parse(checkResult, ctx);
		};
		inst._zod.run = (payload, ctx) => {
			if (ctx.skipChecks) return inst._zod.parse(payload, ctx);
			if (ctx.direction === "backward") {
				const canary = inst._zod.parse({
					value: payload.value,
					issues: []
				}, {
					...ctx,
					skipChecks: true
				});
				if (canary instanceof Promise) return canary.then((canary) => {
					return handleCanaryResult(canary, payload, ctx);
				});
				return handleCanaryResult(canary, payload, ctx);
			}
			const result = inst._zod.parse(payload, ctx);
			if (result instanceof Promise) {
				if (ctx.async === false) throw new $ZodAsyncError();
				return result.then((result) => runChecks(result, checks, ctx));
			}
			return runChecks(result, checks, ctx);
		};
	}
	defineLazy(inst, "~standard", () => ({
		validate: (value) => {
			try {
				const r = safeParse$1(inst, value);
				return r.success ? { value: r.data } : { issues: r.error?.issues };
			} catch (_) {
				return safeParseAsync$1(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
			}
		},
		vendor: "zod",
		version: 1
	}));
});
const $ZodString = /*@__PURE__*/ $constructor("$ZodString", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string$1(inst._zod.bag);
	inst._zod.parse = (payload, _) => {
		if (def.coerce) try {
			payload.value = String(payload.value);
		} catch (_) {}
		if (typeof payload.value === "string") return payload;
		payload.issues.push({
			expected: "string",
			code: "invalid_type",
			input: payload.value,
			inst
		});
		return payload;
	};
});
const $ZodStringFormat = /*@__PURE__*/ $constructor("$ZodStringFormat", (inst, def) => {
	$ZodCheckStringFormat.init(inst, def);
	$ZodString.init(inst, def);
});
const $ZodGUID = /*@__PURE__*/ $constructor("$ZodGUID", (inst, def) => {
	def.pattern ?? (def.pattern = guid);
	$ZodStringFormat.init(inst, def);
});
const $ZodUUID = /*@__PURE__*/ $constructor("$ZodUUID", (inst, def) => {
	if (def.version) {
		const v = {
			v1: 1,
			v2: 2,
			v3: 3,
			v4: 4,
			v5: 5,
			v6: 6,
			v7: 7,
			v8: 8
		}[def.version];
		if (v === void 0) throw new Error(`Invalid UUID version: "${def.version}"`);
		def.pattern ?? (def.pattern = uuid(v));
	} else def.pattern ?? (def.pattern = uuid());
	$ZodStringFormat.init(inst, def);
});
const $ZodEmail = /*@__PURE__*/ $constructor("$ZodEmail", (inst, def) => {
	def.pattern ?? (def.pattern = email);
	$ZodStringFormat.init(inst, def);
});
const $ZodURL = /*@__PURE__*/ $constructor("$ZodURL", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		try {
			const trimmed = payload.value.trim();
			if (!def.normalize && def.protocol?.source === httpProtocol.source) {
				if (!/^https?:\/\//i.test(trimmed)) {
					payload.issues.push({
						code: "invalid_format",
						format: "url",
						note: "Invalid URL format",
						input: payload.value,
						inst,
						continue: !def.abort
					});
					return;
				}
			}
			const url = new URL(trimmed);
			if (def.hostname) {
				def.hostname.lastIndex = 0;
				if (!def.hostname.test(url.hostname)) payload.issues.push({
					code: "invalid_format",
					format: "url",
					note: "Invalid hostname",
					pattern: def.hostname.source,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			}
			if (def.protocol) {
				def.protocol.lastIndex = 0;
				if (!def.protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol)) payload.issues.push({
					code: "invalid_format",
					format: "url",
					note: "Invalid protocol",
					pattern: def.protocol.source,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			}
			if (def.normalize) payload.value = url.href;
			else payload.value = trimmed;
			return;
		} catch (_) {
			payload.issues.push({
				code: "invalid_format",
				format: "url",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		}
	};
});
const $ZodEmoji = /*@__PURE__*/ $constructor("$ZodEmoji", (inst, def) => {
	def.pattern ?? (def.pattern = emoji());
	$ZodStringFormat.init(inst, def);
});
const $ZodNanoID = /*@__PURE__*/ $constructor("$ZodNanoID", (inst, def) => {
	def.pattern ?? (def.pattern = nanoid);
	$ZodStringFormat.init(inst, def);
});
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link $ZodCUID2} instead.
* See https://github.com/paralleldrive/cuid.
*/
const $ZodCUID = /*@__PURE__*/ $constructor("$ZodCUID", (inst, def) => {
	def.pattern ?? (def.pattern = cuid);
	$ZodStringFormat.init(inst, def);
});
const $ZodCUID2 = /*@__PURE__*/ $constructor("$ZodCUID2", (inst, def) => {
	def.pattern ?? (def.pattern = cuid2);
	$ZodStringFormat.init(inst, def);
});
const $ZodULID = /*@__PURE__*/ $constructor("$ZodULID", (inst, def) => {
	def.pattern ?? (def.pattern = ulid);
	$ZodStringFormat.init(inst, def);
});
const $ZodXID = /*@__PURE__*/ $constructor("$ZodXID", (inst, def) => {
	def.pattern ?? (def.pattern = xid);
	$ZodStringFormat.init(inst, def);
});
const $ZodKSUID = /*@__PURE__*/ $constructor("$ZodKSUID", (inst, def) => {
	def.pattern ?? (def.pattern = ksuid);
	$ZodStringFormat.init(inst, def);
});
const $ZodISODateTime = /*@__PURE__*/ $constructor("$ZodISODateTime", (inst, def) => {
	def.pattern ?? (def.pattern = datetime$1(def));
	$ZodStringFormat.init(inst, def);
});
const $ZodISODate = /*@__PURE__*/ $constructor("$ZodISODate", (inst, def) => {
	def.pattern ?? (def.pattern = date$1);
	$ZodStringFormat.init(inst, def);
});
const $ZodISOTime = /*@__PURE__*/ $constructor("$ZodISOTime", (inst, def) => {
	def.pattern ?? (def.pattern = time$1(def));
	$ZodStringFormat.init(inst, def);
});
const $ZodISODuration = /*@__PURE__*/ $constructor("$ZodISODuration", (inst, def) => {
	def.pattern ?? (def.pattern = duration$1);
	$ZodStringFormat.init(inst, def);
});
const $ZodIPv4 = /*@__PURE__*/ $constructor("$ZodIPv4", (inst, def) => {
	def.pattern ?? (def.pattern = ipv4);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.format = `ipv4`;
});
const $ZodIPv6 = /*@__PURE__*/ $constructor("$ZodIPv6", (inst, def) => {
	def.pattern ?? (def.pattern = ipv6);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.format = `ipv6`;
	inst._zod.check = (payload) => {
		try {
			new URL(`http://[${payload.value}]`);
		} catch {
			payload.issues.push({
				code: "invalid_format",
				format: "ipv6",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		}
	};
});
const $ZodCIDRv4 = /*@__PURE__*/ $constructor("$ZodCIDRv4", (inst, def) => {
	def.pattern ?? (def.pattern = cidrv4);
	$ZodStringFormat.init(inst, def);
});
const $ZodCIDRv6 = /*@__PURE__*/ $constructor("$ZodCIDRv6", (inst, def) => {
	def.pattern ?? (def.pattern = cidrv6);
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		const parts = payload.value.split("/");
		try {
			if (parts.length !== 2) throw new Error();
			const [address, prefix] = parts;
			if (!prefix) throw new Error();
			const prefixNum = Number(prefix);
			if (`${prefixNum}` !== prefix) throw new Error();
			if (prefixNum < 0 || prefixNum > 128) throw new Error();
			new URL(`http://[${address}]`);
		} catch {
			payload.issues.push({
				code: "invalid_format",
				format: "cidrv6",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		}
	};
});
function isValidBase64(data) {
	if (data === "") return true;
	if (/\s/.test(data)) return false;
	if (data.length % 4 !== 0) return false;
	try {
		atob(data);
		return true;
	} catch {
		return false;
	}
}
const $ZodBase64 = /*@__PURE__*/ $constructor("$ZodBase64", (inst, def) => {
	def.pattern ?? (def.pattern = base64);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.contentEncoding = "base64";
	inst._zod.check = (payload) => {
		if (isValidBase64(payload.value)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "base64",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
function isValidBase64URL(data) {
	if (!base64url.test(data)) return false;
	const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
	return isValidBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
}
const $ZodBase64URL = /*@__PURE__*/ $constructor("$ZodBase64URL", (inst, def) => {
	def.pattern ?? (def.pattern = base64url);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.contentEncoding = "base64url";
	inst._zod.check = (payload) => {
		if (isValidBase64URL(payload.value)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "base64url",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodE164 = /*@__PURE__*/ $constructor("$ZodE164", (inst, def) => {
	def.pattern ?? (def.pattern = e164);
	$ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
	try {
		const tokensParts = token.split(".");
		if (tokensParts.length !== 3) return false;
		const [header] = tokensParts;
		if (!header) return false;
		const parsedHeader = JSON.parse(atob(header));
		if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT") return false;
		if (!parsedHeader.alg) return false;
		if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm)) return false;
		return true;
	} catch {
		return false;
	}
}
const $ZodJWT = /*@__PURE__*/ $constructor("$ZodJWT", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		if (isValidJWT(payload.value, def.alg)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "jwt",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodNumber = /*@__PURE__*/ $constructor("$ZodNumber", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = inst._zod.bag.pattern ?? number$1;
	inst._zod.parse = (payload, _ctx) => {
		if (def.coerce) try {
			payload.value = Number(payload.value);
		} catch (_) {}
		const input = payload.value;
		if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) return payload;
		const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? "Infinity" : void 0 : void 0;
		payload.issues.push({
			expected: "number",
			code: "invalid_type",
			input,
			inst,
			...received ? { received } : {}
		});
		return payload;
	};
});
const $ZodNumberFormat = /*@__PURE__*/ $constructor("$ZodNumberFormat", (inst, def) => {
	$ZodCheckNumberFormat.init(inst, def);
	$ZodNumber.init(inst, def);
});
const $ZodBoolean = /*@__PURE__*/ $constructor("$ZodBoolean", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = boolean$1;
	inst._zod.parse = (payload, _ctx) => {
		if (def.coerce) try {
			payload.value = Boolean(payload.value);
		} catch (_) {}
		const input = payload.value;
		if (typeof input === "boolean") return payload;
		payload.issues.push({
			expected: "boolean",
			code: "invalid_type",
			input,
			inst
		});
		return payload;
	};
});
const $ZodUnknown = /*@__PURE__*/ $constructor("$ZodUnknown", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload) => payload;
});
const $ZodNever = /*@__PURE__*/ $constructor("$ZodNever", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, _ctx) => {
		payload.issues.push({
			expected: "never",
			code: "invalid_type",
			input: payload.value,
			inst
		});
		return payload;
	};
});
function handleArrayResult(result, final, index) {
	if (result.issues.length) final.issues.push(...prefixIssues(index, result.issues));
	final.value[index] = result.value;
}
const $ZodArray = /*@__PURE__*/ $constructor("$ZodArray", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		if (!Array.isArray(input)) {
			payload.issues.push({
				expected: "array",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		payload.value = Array(input.length);
		const proms = [];
		for (let i = 0; i < input.length; i++) {
			const item = input[i];
			const result = def.element._zod.run({
				value: item,
				issues: []
			}, ctx);
			if (result instanceof Promise) proms.push(result.then((result) => handleArrayResult(result, payload, i)));
			else handleArrayResult(result, payload, i);
		}
		if (proms.length) return Promise.all(proms).then(() => payload);
		return payload;
	};
});
function handlePropertyResult(result, final, key, input, isOptionalIn, isOptionalOut) {
	const isPresent = key in input;
	if (result.issues.length) {
		if (isOptionalIn && isOptionalOut && !isPresent) return;
		final.issues.push(...prefixIssues(key, result.issues));
	}
	if (!isPresent && !isOptionalIn) {
		if (!result.issues.length) final.issues.push({
			code: "invalid_type",
			expected: "nonoptional",
			input: void 0,
			path: [key]
		});
		return;
	}
	if (result.value === void 0) {
		if (isPresent) final.value[key] = void 0;
	} else final.value[key] = result.value;
}
function normalizeDef(def) {
	const keys = Object.keys(def.shape);
	for (const k of keys) if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
	const okeys = optionalKeys(def.shape);
	return {
		...def,
		keys,
		keySet: new Set(keys),
		numKeys: keys.length,
		optionalKeys: new Set(okeys)
	};
}
function handleCatchall(proms, input, payload, ctx, def, inst) {
	const unrecognized = [];
	const keySet = def.keySet;
	const _catchall = def.catchall._zod;
	const t = _catchall.def.type;
	const isOptionalIn = _catchall.optin === "optional";
	const isOptionalOut = _catchall.optout === "optional";
	for (const key in input) {
		if (key === "__proto__") continue;
		if (keySet.has(key)) continue;
		if (t === "never") {
			unrecognized.push(key);
			continue;
		}
		const r = _catchall.run({
			value: input[key],
			issues: []
		}, ctx);
		if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
		else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
	}
	if (unrecognized.length) payload.issues.push({
		code: "unrecognized_keys",
		keys: unrecognized,
		input,
		inst
	});
	if (!proms.length) return payload;
	return Promise.all(proms).then(() => {
		return payload;
	});
}
const $ZodObject = /*@__PURE__*/ $constructor("$ZodObject", (inst, def) => {
	$ZodType.init(inst, def);
	if (!Object.getOwnPropertyDescriptor(def, "shape")?.get) {
		const sh = def.shape;
		Object.defineProperty(def, "shape", { get: () => {
			const newSh = { ...sh };
			Object.defineProperty(def, "shape", { value: newSh });
			return newSh;
		} });
	}
	const _normalized = cached$1(() => normalizeDef(def));
	defineLazy(inst._zod, "propValues", () => {
		const shape = def.shape;
		const propValues = {};
		for (const key in shape) {
			const field = shape[key]._zod;
			if (field.values) {
				propValues[key] ?? (propValues[key] = /* @__PURE__ */ new Set());
				for (const v of field.values) propValues[key].add(v);
			}
		}
		return propValues;
	});
	const isObject$2 = isObject;
	const catchall = def.catchall;
	let value;
	inst._zod.parse = (payload, ctx) => {
		value ?? (value = _normalized.value);
		const input = payload.value;
		if (!isObject$2(input)) {
			payload.issues.push({
				expected: "object",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		payload.value = {};
		const proms = [];
		const shape = value.shape;
		for (const key of value.keys) {
			const el = shape[key];
			const isOptionalIn = el._zod.optin === "optional";
			const isOptionalOut = el._zod.optout === "optional";
			const r = el._zod.run({
				value: input[key],
				issues: []
			}, ctx);
			if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
			else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
		}
		if (!catchall) return proms.length ? Promise.all(proms).then(() => payload) : payload;
		return handleCatchall(proms, input, payload, ctx, _normalized.value, inst);
	};
});
const $ZodObjectJIT = /*@__PURE__*/ $constructor("$ZodObjectJIT", (inst, def) => {
	$ZodObject.init(inst, def);
	const superParse = inst._zod.parse;
	const _normalized = cached$1(() => normalizeDef(def));
	const generateFastpass = (shape) => {
		const doc = new Doc([
			"shape",
			"payload",
			"ctx"
		]);
		const normalized = _normalized.value;
		const parseStr = (key) => {
			const k = esc(key);
			return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
		};
		doc.write(`const input = payload.value;`);
		const ids = Object.create(null);
		let counter = 0;
		for (const key of normalized.keys) ids[key] = `key_${counter++}`;
		doc.write(`const newResult = {};`);
		for (const key of normalized.keys) {
			const id = ids[key];
			const k = esc(key);
			const schema = shape[key];
			const isOptionalIn = schema?._zod?.optin === "optional";
			const isOptionalOut = schema?._zod?.optout === "optional";
			doc.write(`const ${id} = ${parseStr(key)};`);
			if (isOptionalIn && isOptionalOut) doc.write(`
        if (${id}.issues.length) {
          if (${k} in input) {
            payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${k}, ...iss.path] : [${k}]
            })));
          }
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
			else if (!isOptionalIn) doc.write(`
        const ${id}_present = ${k} in input;
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
        }

        if (${id}_present) {
          if (${id}.value === undefined) {
            newResult[${k}] = undefined;
          } else {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
			else doc.write(`
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
		}
		doc.write(`payload.value = newResult;`);
		doc.write(`return payload;`);
		const fn = doc.compile();
		return (payload, ctx) => fn(shape, payload, ctx);
	};
	let fastpass;
	const isObject$3 = isObject;
	const jit = !globalConfig.jitless;
	const fastEnabled = jit && allowsEval.value;
	const catchall = def.catchall;
	let value;
	inst._zod.parse = (payload, ctx) => {
		value ?? (value = _normalized.value);
		const input = payload.value;
		if (!isObject$3(input)) {
			payload.issues.push({
				expected: "object",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
			if (!fastpass) fastpass = generateFastpass(def.shape);
			payload = fastpass(payload, ctx);
			if (!catchall) return payload;
			return handleCatchall([], input, payload, ctx, value, inst);
		}
		return superParse(payload, ctx);
	};
});
function handleUnionResults(results, final, inst, ctx) {
	for (const result of results) if (result.issues.length === 0) {
		final.value = result.value;
		return final;
	}
	const nonaborted = results.filter((r) => !aborted(r));
	if (nonaborted.length === 1) {
		final.value = nonaborted[0].value;
		return nonaborted[0];
	}
	final.issues.push({
		code: "invalid_union",
		input: final.value,
		inst,
		errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	});
	return final;
}
const $ZodUnion = /*@__PURE__*/ $constructor("$ZodUnion", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : void 0);
	defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
	defineLazy(inst._zod, "values", () => {
		if (def.options.every((o) => o._zod.values)) return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
	});
	defineLazy(inst._zod, "pattern", () => {
		if (def.options.every((o) => o._zod.pattern)) {
			const patterns = def.options.map((o) => o._zod.pattern);
			return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
		}
	});
	const first = def.options.length === 1 ? def.options[0]._zod.run : null;
	inst._zod.parse = (payload, ctx) => {
		if (first) return first(payload, ctx);
		let async = false;
		const results = [];
		for (const option of def.options) {
			const result = option._zod.run({
				value: payload.value,
				issues: []
			}, ctx);
			if (result instanceof Promise) {
				results.push(result);
				async = true;
			} else {
				if (result.issues.length === 0) return result;
				results.push(result);
			}
		}
		if (!async) return handleUnionResults(results, payload, inst, ctx);
		return Promise.all(results).then((results) => {
			return handleUnionResults(results, payload, inst, ctx);
		});
	};
});
const $ZodDiscriminatedUnion = /*@__PURE__*/ $constructor("$ZodDiscriminatedUnion", (inst, def) => {
	def.inclusive = false;
	$ZodUnion.init(inst, def);
	const _super = inst._zod.parse;
	defineLazy(inst._zod, "propValues", () => {
		const propValues = {};
		for (const option of def.options) {
			const pv = option._zod.propValues;
			if (!pv || Object.keys(pv).length === 0) throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(option)}"`);
			for (const [k, v] of Object.entries(pv)) {
				if (!propValues[k]) propValues[k] = /* @__PURE__ */ new Set();
				for (const val of v) propValues[k].add(val);
			}
		}
		return propValues;
	});
	const disc = cached$1(() => {
		const opts = def.options;
		const map = /* @__PURE__ */ new Map();
		for (const o of opts) {
			const values = o._zod.propValues?.[def.discriminator];
			if (!values || values.size === 0) throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(o)}"`);
			for (const v of values) {
				if (map.has(v)) throw new Error(`Duplicate discriminator value "${String(v)}"`);
				map.set(v, o);
			}
		}
		return map;
	});
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		if (!isObject(input)) {
			payload.issues.push({
				code: "invalid_type",
				expected: "object",
				input,
				inst
			});
			return payload;
		}
		const opt = disc.value.get(input?.[def.discriminator]);
		if (opt) return opt._zod.run(payload, ctx);
		if (def.unionFallback || ctx.direction === "backward") return _super(payload, ctx);
		payload.issues.push({
			code: "invalid_union",
			errors: [],
			note: "No matching discriminator",
			discriminator: def.discriminator,
			options: Array.from(disc.value.keys()),
			input,
			path: [def.discriminator],
			inst
		});
		return payload;
	};
});
const $ZodIntersection = /*@__PURE__*/ $constructor("$ZodIntersection", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		const left = def.left._zod.run({
			value: input,
			issues: []
		}, ctx);
		const right = def.right._zod.run({
			value: input,
			issues: []
		}, ctx);
		if (left instanceof Promise || right instanceof Promise) return Promise.all([left, right]).then(([left, right]) => {
			return handleIntersectionResults(payload, left, right);
		});
		return handleIntersectionResults(payload, left, right);
	};
});
function mergeValues(a, b) {
	if (a === b) return {
		valid: true,
		data: a
	};
	if (a instanceof Date && b instanceof Date && +a === +b) return {
		valid: true,
		data: a
	};
	if (isPlainObject(a) && isPlainObject(b)) {
		const bKeys = Object.keys(b);
		const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
		const newObj = {
			...a,
			...b
		};
		for (const key of sharedKeys) {
			const sharedValue = mergeValues(a[key], b[key]);
			if (!sharedValue.valid) return {
				valid: false,
				mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
			};
			newObj[key] = sharedValue.data;
		}
		return {
			valid: true,
			data: newObj
		};
	}
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return {
			valid: false,
			mergeErrorPath: []
		};
		const newArray = [];
		for (let index = 0; index < a.length; index++) {
			const itemA = a[index];
			const itemB = b[index];
			const sharedValue = mergeValues(itemA, itemB);
			if (!sharedValue.valid) return {
				valid: false,
				mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
			};
			newArray.push(sharedValue.data);
		}
		return {
			valid: true,
			data: newArray
		};
	}
	return {
		valid: false,
		mergeErrorPath: []
	};
}
function handleIntersectionResults(result, left, right) {
	const unrecKeys = /* @__PURE__ */ new Map();
	let unrecIssue;
	for (const iss of left.issues) if (iss.code === "unrecognized_keys") {
		unrecIssue ?? (unrecIssue = iss);
		for (const k of iss.keys) {
			if (!unrecKeys.has(k)) unrecKeys.set(k, {});
			unrecKeys.get(k).l = true;
		}
	} else result.issues.push(iss);
	for (const iss of right.issues) if (iss.code === "unrecognized_keys") for (const k of iss.keys) {
		if (!unrecKeys.has(k)) unrecKeys.set(k, {});
		unrecKeys.get(k).r = true;
	}
	else result.issues.push(iss);
	const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
	if (bothKeys.length && unrecIssue) result.issues.push({
		...unrecIssue,
		keys: bothKeys
	});
	if (aborted(result)) return result;
	const merged = mergeValues(left.value, right.value);
	if (!merged.valid) throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
	result.value = merged.data;
	return result;
}
const $ZodEnum = /*@__PURE__*/ $constructor("$ZodEnum", (inst, def) => {
	$ZodType.init(inst, def);
	const values = getEnumValues(def.entries);
	const valuesSet = new Set(values);
	inst._zod.values = valuesSet;
	inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
	inst._zod.parse = (payload, _ctx) => {
		const input = payload.value;
		if (valuesSet.has(input)) return payload;
		payload.issues.push({
			code: "invalid_value",
			values,
			input,
			inst
		});
		return payload;
	};
});
const $ZodLiteral = /*@__PURE__*/ $constructor("$ZodLiteral", (inst, def) => {
	$ZodType.init(inst, def);
	if (def.values.length === 0) throw new Error("Cannot create literal schema with no valid values");
	const values = new Set(def.values);
	inst._zod.values = values;
	inst._zod.pattern = new RegExp(`^(${def.values.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$`);
	inst._zod.parse = (payload, _ctx) => {
		const input = payload.value;
		if (values.has(input)) return payload;
		payload.issues.push({
			code: "invalid_value",
			values: def.values,
			input,
			inst
		});
		return payload;
	};
});
const $ZodTransform = /*@__PURE__*/ $constructor("$ZodTransform", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
		const _out = def.transform(payload.value, payload);
		if (ctx.async) return (_out instanceof Promise ? _out : Promise.resolve(_out)).then((output) => {
			payload.value = output;
			payload.fallback = true;
			return payload;
		});
		if (_out instanceof Promise) throw new $ZodAsyncError();
		payload.value = _out;
		payload.fallback = true;
		return payload;
	};
});
function handleOptionalResult(result, input) {
	if (input === void 0 && (result.issues.length || result.fallback)) return {
		issues: [],
		value: void 0
	};
	return result;
}
const $ZodOptional = /*@__PURE__*/ $constructor("$ZodOptional", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	inst._zod.optout = "optional";
	defineLazy(inst._zod, "values", () => {
		return def.innerType._zod.values ? new Set([...def.innerType._zod.values, void 0]) : void 0;
	});
	defineLazy(inst._zod, "pattern", () => {
		const pattern = def.innerType._zod.pattern;
		return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		if (def.innerType._zod.optin === "optional") {
			const input = payload.value;
			const result = def.innerType._zod.run(payload, ctx);
			if (result instanceof Promise) return result.then((r) => handleOptionalResult(r, input));
			return handleOptionalResult(result, input);
		}
		if (payload.value === void 0) return payload;
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodExactOptional = /*@__PURE__*/ $constructor("$ZodExactOptional", (inst, def) => {
	$ZodOptional.init(inst, def);
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	defineLazy(inst._zod, "pattern", () => def.innerType._zod.pattern);
	inst._zod.parse = (payload, ctx) => {
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodNullable = /*@__PURE__*/ $constructor("$ZodNullable", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
	defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
	defineLazy(inst._zod, "pattern", () => {
		const pattern = def.innerType._zod.pattern;
		return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
	});
	defineLazy(inst._zod, "values", () => {
		return def.innerType._zod.values ? new Set([...def.innerType._zod.values, null]) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		if (payload.value === null) return payload;
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodDefault = /*@__PURE__*/ $constructor("$ZodDefault", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		if (payload.value === void 0) {
			payload.value = def.defaultValue;
			/**
			* $ZodDefault returns the default value immediately in forward direction.
			* It doesn't pass the default value into the validator ("prefault"). There's no reason to pass the default value through validation. The validity of the default is enforced by TypeScript statically. Otherwise, it's the responsibility of the user to ensure the default is valid. In the case of pipes with divergent in/out types, you can specify the default on the `in` schema of your ZodPipe to set a "prefault" for the pipe.   */
			return payload;
		}
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => handleDefaultResult(result, def));
		return handleDefaultResult(result, def);
	};
});
function handleDefaultResult(payload, def) {
	if (payload.value === void 0) payload.value = def.defaultValue;
	return payload;
}
const $ZodPrefault = /*@__PURE__*/ $constructor("$ZodPrefault", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		if (payload.value === void 0) payload.value = def.defaultValue;
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodNonOptional = /*@__PURE__*/ $constructor("$ZodNonOptional", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "values", () => {
		const v = def.innerType._zod.values;
		return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => handleNonOptionalResult(result, inst));
		return handleNonOptionalResult(result, inst);
	};
});
function handleNonOptionalResult(payload, inst) {
	if (!payload.issues.length && payload.value === void 0) payload.issues.push({
		code: "invalid_type",
		expected: "nonoptional",
		input: payload.value,
		inst
	});
	return payload;
}
const $ZodCatch = /*@__PURE__*/ $constructor("$ZodCatch", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => {
			payload.value = result.value;
			if (result.issues.length) {
				payload.value = def.catchValue({
					...payload,
					error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
					input: payload.value
				});
				payload.issues = [];
				payload.fallback = true;
			}
			return payload;
		});
		payload.value = result.value;
		if (result.issues.length) {
			payload.value = def.catchValue({
				...payload,
				error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
				input: payload.value
			});
			payload.issues = [];
			payload.fallback = true;
		}
		return payload;
	};
});
const $ZodPipe = /*@__PURE__*/ $constructor("$ZodPipe", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "values", () => def.in._zod.values);
	defineLazy(inst._zod, "optin", () => def.in._zod.optin);
	defineLazy(inst._zod, "optout", () => def.out._zod.optout);
	defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") {
			const right = def.out._zod.run(payload, ctx);
			if (right instanceof Promise) return right.then((right) => handlePipeResult(right, def.in, ctx));
			return handlePipeResult(right, def.in, ctx);
		}
		const left = def.in._zod.run(payload, ctx);
		if (left instanceof Promise) return left.then((left) => handlePipeResult(left, def.out, ctx));
		return handlePipeResult(left, def.out, ctx);
	};
});
function handlePipeResult(left, next, ctx) {
	if (left.issues.length) {
		left.aborted = true;
		return left;
	}
	return next._zod.run({
		value: left.value,
		issues: left.issues,
		fallback: left.fallback
	}, ctx);
}
const $ZodReadonly = /*@__PURE__*/ $constructor("$ZodReadonly", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	defineLazy(inst._zod, "optin", () => def.innerType?._zod?.optin);
	defineLazy(inst._zod, "optout", () => def.innerType?._zod?.optout);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then(handleReadonlyResult);
		return handleReadonlyResult(result);
	};
});
function handleReadonlyResult(payload) {
	payload.value = Object.freeze(payload.value);
	return payload;
}
const $ZodLazy = /*@__PURE__*/ $constructor("$ZodLazy", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "innerType", () => {
		const d = def;
		if (!d._cachedInner) d._cachedInner = def.getter();
		return d._cachedInner;
	});
	defineLazy(inst._zod, "pattern", () => inst._zod.innerType?._zod?.pattern);
	defineLazy(inst._zod, "propValues", () => inst._zod.innerType?._zod?.propValues);
	defineLazy(inst._zod, "optin", () => inst._zod.innerType?._zod?.optin ?? void 0);
	defineLazy(inst._zod, "optout", () => inst._zod.innerType?._zod?.optout ?? void 0);
	inst._zod.parse = (payload, ctx) => {
		return inst._zod.innerType._zod.run(payload, ctx);
	};
});
const $ZodCustom = /*@__PURE__*/ $constructor("$ZodCustom", (inst, def) => {
	$ZodCheck.init(inst, def);
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, _) => {
		return payload;
	};
	inst._zod.check = (payload) => {
		const input = payload.value;
		const r = def.fn(input);
		if (r instanceof Promise) return r.then((r) => handleRefineResult(r, payload, input, inst));
		handleRefineResult(r, payload, input, inst);
	};
});
function handleRefineResult(result, payload, input, inst) {
	if (!result) {
		const _iss = {
			code: "custom",
			input,
			inst,
			path: [...inst._zod.def.path ?? []],
			continue: !inst._zod.def.abort
		};
		if (inst._zod.def.params) _iss.params = inst._zod.def.params;
		payload.issues.push(issue(_iss));
	}
}
//#endregion
//#region ../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/registries.js
var _a;
var $ZodRegistry = class {
	constructor() {
		this._map = /* @__PURE__ */ new WeakMap();
		this._idmap = /* @__PURE__ */ new Map();
	}
	add(schema, ..._meta) {
		const meta = _meta[0];
		this._map.set(schema, meta);
		if (meta && typeof meta === "object" && "id" in meta) this._idmap.set(meta.id, schema);
		return this;
	}
	clear() {
		this._map = /* @__PURE__ */ new WeakMap();
		this._idmap = /* @__PURE__ */ new Map();
		return this;
	}
	remove(schema) {
		const meta = this._map.get(schema);
		if (meta && typeof meta === "object" && "id" in meta) this._idmap.delete(meta.id);
		this._map.delete(schema);
		return this;
	}
	get(schema) {
		const p = schema._zod.parent;
		if (p) {
			const pm = { ...this.get(p) ?? {} };
			delete pm.id;
			const f = {
				...pm,
				...this._map.get(schema)
			};
			return Object.keys(f).length ? f : void 0;
		}
		return this._map.get(schema);
	}
	has(schema) {
		return this._map.has(schema);
	}
};
function registry() {
	return new $ZodRegistry();
}
(_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
const globalRegistry = globalThis.__zod_globalRegistry;
//#endregion
//#region ../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/api.js
// @__NO_SIDE_EFFECTS__
function _string(Class, params) {
	return new Class({
		type: "string",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _email(Class, params) {
	return new Class({
		type: "string",
		format: "email",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _guid(Class, params) {
	return new Class({
		type: "string",
		format: "guid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuid(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv4(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v4",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv6(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v6",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv7(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v7",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _url(Class, params) {
	return new Class({
		type: "string",
		format: "url",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _emoji(Class, params) {
	return new Class({
		type: "string",
		format: "emoji",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _nanoid(Class, params) {
	return new Class({
		type: "string",
		format: "nanoid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link _cuid2} instead.
* See https://github.com/paralleldrive/cuid.
*/
// @__NO_SIDE_EFFECTS__
function _cuid(Class, params) {
	return new Class({
		type: "string",
		format: "cuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cuid2(Class, params) {
	return new Class({
		type: "string",
		format: "cuid2",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ulid(Class, params) {
	return new Class({
		type: "string",
		format: "ulid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _xid(Class, params) {
	return new Class({
		type: "string",
		format: "xid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ksuid(Class, params) {
	return new Class({
		type: "string",
		format: "ksuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ipv4(Class, params) {
	return new Class({
		type: "string",
		format: "ipv4",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ipv6(Class, params) {
	return new Class({
		type: "string",
		format: "ipv6",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cidrv4(Class, params) {
	return new Class({
		type: "string",
		format: "cidrv4",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cidrv6(Class, params) {
	return new Class({
		type: "string",
		format: "cidrv6",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _base64(Class, params) {
	return new Class({
		type: "string",
		format: "base64",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _base64url(Class, params) {
	return new Class({
		type: "string",
		format: "base64url",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _e164(Class, params) {
	return new Class({
		type: "string",
		format: "e164",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _jwt(Class, params) {
	return new Class({
		type: "string",
		format: "jwt",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDateTime(Class, params) {
	return new Class({
		type: "string",
		format: "datetime",
		check: "string_format",
		offset: false,
		local: false,
		precision: null,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDate(Class, params) {
	return new Class({
		type: "string",
		format: "date",
		check: "string_format",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoTime(Class, params) {
	return new Class({
		type: "string",
		format: "time",
		check: "string_format",
		precision: null,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDuration(Class, params) {
	return new Class({
		type: "string",
		format: "duration",
		check: "string_format",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _number(Class, params) {
	return new Class({
		type: "number",
		checks: [],
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _int(Class, params) {
	return new Class({
		type: "number",
		check: "number_format",
		abort: false,
		format: "safeint",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _boolean(Class, params) {
	return new Class({
		type: "boolean",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _unknown(Class) {
	return new Class({ type: "unknown" });
}
// @__NO_SIDE_EFFECTS__
function _never(Class, params) {
	return new Class({
		type: "never",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _lt(value, params) {
	return new $ZodCheckLessThan({
		check: "less_than",
		...normalizeParams(params),
		value,
		inclusive: false
	});
}
// @__NO_SIDE_EFFECTS__
function _lte(value, params) {
	return new $ZodCheckLessThan({
		check: "less_than",
		...normalizeParams(params),
		value,
		inclusive: true
	});
}
// @__NO_SIDE_EFFECTS__
function _gt(value, params) {
	return new $ZodCheckGreaterThan({
		check: "greater_than",
		...normalizeParams(params),
		value,
		inclusive: false
	});
}
// @__NO_SIDE_EFFECTS__
function _gte(value, params) {
	return new $ZodCheckGreaterThan({
		check: "greater_than",
		...normalizeParams(params),
		value,
		inclusive: true
	});
}
// @__NO_SIDE_EFFECTS__
function _multipleOf(value, params) {
	return new $ZodCheckMultipleOf({
		check: "multiple_of",
		...normalizeParams(params),
		value
	});
}
// @__NO_SIDE_EFFECTS__
function _maxLength(maximum, params) {
	return new $ZodCheckMaxLength({
		check: "max_length",
		...normalizeParams(params),
		maximum
	});
}
// @__NO_SIDE_EFFECTS__
function _minLength(minimum, params) {
	return new $ZodCheckMinLength({
		check: "min_length",
		...normalizeParams(params),
		minimum
	});
}
// @__NO_SIDE_EFFECTS__
function _length(length, params) {
	return new $ZodCheckLengthEquals({
		check: "length_equals",
		...normalizeParams(params),
		length
	});
}
// @__NO_SIDE_EFFECTS__
function _regex(pattern, params) {
	return new $ZodCheckRegex({
		check: "string_format",
		format: "regex",
		...normalizeParams(params),
		pattern
	});
}
// @__NO_SIDE_EFFECTS__
function _lowercase(params) {
	return new $ZodCheckLowerCase({
		check: "string_format",
		format: "lowercase",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uppercase(params) {
	return new $ZodCheckUpperCase({
		check: "string_format",
		format: "uppercase",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _includes(includes, params) {
	return new $ZodCheckIncludes({
		check: "string_format",
		format: "includes",
		...normalizeParams(params),
		includes
	});
}
// @__NO_SIDE_EFFECTS__
function _startsWith(prefix, params) {
	return new $ZodCheckStartsWith({
		check: "string_format",
		format: "starts_with",
		...normalizeParams(params),
		prefix
	});
}
// @__NO_SIDE_EFFECTS__
function _endsWith(suffix, params) {
	return new $ZodCheckEndsWith({
		check: "string_format",
		format: "ends_with",
		...normalizeParams(params),
		suffix
	});
}
// @__NO_SIDE_EFFECTS__
function _overwrite(tx) {
	return new $ZodCheckOverwrite({
		check: "overwrite",
		tx
	});
}
// @__NO_SIDE_EFFECTS__
function _normalize(form) {
	return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
}
// @__NO_SIDE_EFFECTS__
function _trim() {
	return /* @__PURE__ */ _overwrite((input) => input.trim());
}
// @__NO_SIDE_EFFECTS__
function _toLowerCase() {
	return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function _toUpperCase() {
	return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function _slugify() {
	return /* @__PURE__ */ _overwrite((input) => slugify(input));
}
// @__NO_SIDE_EFFECTS__
function _array(Class, element, params) {
	return new Class({
		type: "array",
		element,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _refine(Class, fn, _params) {
	return new Class({
		type: "custom",
		check: "custom",
		fn,
		...normalizeParams(_params)
	});
}
// @__NO_SIDE_EFFECTS__
function _superRefine(fn, params) {
	const ch = /* @__PURE__ */ _check((payload) => {
		payload.addIssue = (issue$2) => {
			if (typeof issue$2 === "string") payload.issues.push(issue(issue$2, payload.value, ch._zod.def));
			else {
				const _issue = issue$2;
				if (_issue.fatal) _issue.continue = false;
				_issue.code ?? (_issue.code = "custom");
				_issue.input ?? (_issue.input = payload.value);
				_issue.inst ?? (_issue.inst = ch);
				_issue.continue ?? (_issue.continue = !ch._zod.def.abort);
				payload.issues.push(issue(_issue));
			}
		};
		return fn(payload.value, payload);
	}, params);
	return ch;
}
// @__NO_SIDE_EFFECTS__
function _check(fn, params) {
	const ch = new $ZodCheck({
		check: "custom",
		...normalizeParams(params)
	});
	ch._zod.check = fn;
	return ch;
}
//#endregion
//#region ../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/to-json-schema.js
function initializeContext(params) {
	let target = params?.target ?? "draft-2020-12";
	if (target === "draft-4") target = "draft-04";
	if (target === "draft-7") target = "draft-07";
	return {
		processors: params.processors ?? {},
		metadataRegistry: params?.metadata ?? globalRegistry,
		target,
		unrepresentable: params?.unrepresentable ?? "throw",
		override: params?.override ?? (() => {}),
		io: params?.io ?? "output",
		counter: 0,
		seen: /* @__PURE__ */ new Map(),
		cycles: params?.cycles ?? "ref",
		reused: params?.reused ?? "inline",
		external: params?.external ?? void 0
	};
}
function process$1(schema, ctx, _params = {
	path: [],
	schemaPath: []
}) {
	var _a;
	const def = schema._zod.def;
	const seen = ctx.seen.get(schema);
	if (seen) {
		seen.count++;
		if (_params.schemaPath.includes(schema)) seen.cycle = _params.path;
		return seen.schema;
	}
	const result = {
		schema: {},
		count: 1,
		cycle: void 0,
		path: _params.path
	};
	ctx.seen.set(schema, result);
	const overrideSchema = schema._zod.toJSONSchema?.();
	if (overrideSchema) result.schema = overrideSchema;
	else {
		const params = {
			..._params,
			schemaPath: [..._params.schemaPath, schema],
			path: _params.path
		};
		if (schema._zod.processJSONSchema) schema._zod.processJSONSchema(ctx, result.schema, params);
		else {
			const _json = result.schema;
			const processor = ctx.processors[def.type];
			if (!processor) throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
			processor(schema, ctx, _json, params);
		}
		const parent = schema._zod.parent;
		if (parent) {
			if (!result.ref) result.ref = parent;
			process$1(parent, ctx, params);
			ctx.seen.get(parent).isParent = true;
		}
	}
	const meta = ctx.metadataRegistry.get(schema);
	if (meta) Object.assign(result.schema, meta);
	if (ctx.io === "input" && isTransforming(schema)) {
		delete result.schema.examples;
		delete result.schema.default;
	}
	if (ctx.io === "input" && "_prefault" in result.schema) (_a = result.schema).default ?? (_a.default = result.schema._prefault);
	delete result.schema._prefault;
	return ctx.seen.get(schema).schema;
}
function extractDefs(ctx, schema) {
	const root = ctx.seen.get(schema);
	if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
	const idToSchema = /* @__PURE__ */ new Map();
	for (const entry of ctx.seen.entries()) {
		const id = ctx.metadataRegistry.get(entry[0])?.id;
		if (id) {
			const existing = idToSchema.get(id);
			if (existing && existing !== entry[0]) throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
			idToSchema.set(id, entry[0]);
		}
	}
	const makeURI = (entry) => {
		const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
		if (ctx.external) {
			const externalId = ctx.external.registry.get(entry[0])?.id;
			const uriGenerator = ctx.external.uri ?? ((id) => id);
			if (externalId) return { ref: uriGenerator(externalId) };
			const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
			entry[1].defId = id;
			return {
				defId: id,
				ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}`
			};
		}
		if (entry[1] === root) return { ref: "#" };
		const defUriPrefix = `#/${defsSegment}/`;
		const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
		return {
			defId,
			ref: defUriPrefix + defId
		};
	};
	const extractToDef = (entry) => {
		if (entry[1].schema.$ref) return;
		const seen = entry[1];
		const { ref, defId } = makeURI(entry);
		seen.def = { ...seen.schema };
		if (defId) seen.defId = defId;
		const schema = seen.schema;
		for (const key in schema) delete schema[key];
		schema.$ref = ref;
	};
	if (ctx.cycles === "throw") for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (seen.cycle) throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
	}
	for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (schema === entry[0]) {
			extractToDef(entry);
			continue;
		}
		if (ctx.external) {
			const ext = ctx.external.registry.get(entry[0])?.id;
			if (schema !== entry[0] && ext) {
				extractToDef(entry);
				continue;
			}
		}
		if (ctx.metadataRegistry.get(entry[0])?.id) {
			extractToDef(entry);
			continue;
		}
		if (seen.cycle) {
			extractToDef(entry);
			continue;
		}
		if (seen.count > 1) {
			if (ctx.reused === "ref") {
				extractToDef(entry);
				continue;
			}
		}
	}
}
function finalize(ctx, schema) {
	const root = ctx.seen.get(schema);
	if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
	const flattenRef = (zodSchema) => {
		const seen = ctx.seen.get(zodSchema);
		if (seen.ref === null) return;
		const schema = seen.def ?? seen.schema;
		const _cached = { ...schema };
		const ref = seen.ref;
		seen.ref = null;
		if (ref) {
			flattenRef(ref);
			const refSeen = ctx.seen.get(ref);
			const refSchema = refSeen.schema;
			if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
				schema.allOf = schema.allOf ?? [];
				schema.allOf.push(refSchema);
			} else Object.assign(schema, refSchema);
			Object.assign(schema, _cached);
			if (zodSchema._zod.parent === ref) for (const key in schema) {
				if (key === "$ref" || key === "allOf") continue;
				if (!(key in _cached)) delete schema[key];
			}
			if (refSchema.$ref && refSeen.def) for (const key in schema) {
				if (key === "$ref" || key === "allOf") continue;
				if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) delete schema[key];
			}
		}
		const parent = zodSchema._zod.parent;
		if (parent && parent !== ref) {
			flattenRef(parent);
			const parentSeen = ctx.seen.get(parent);
			if (parentSeen?.schema.$ref) {
				schema.$ref = parentSeen.schema.$ref;
				if (parentSeen.def) for (const key in schema) {
					if (key === "$ref" || key === "allOf") continue;
					if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) delete schema[key];
				}
			}
		}
		ctx.override({
			zodSchema,
			jsonSchema: schema,
			path: seen.path ?? []
		});
	};
	for (const entry of [...ctx.seen.entries()].reverse()) flattenRef(entry[0]);
	const result = {};
	if (ctx.target === "draft-2020-12") result.$schema = "https://json-schema.org/draft/2020-12/schema";
	else if (ctx.target === "draft-07") result.$schema = "http://json-schema.org/draft-07/schema#";
	else if (ctx.target === "draft-04") result.$schema = "http://json-schema.org/draft-04/schema#";
	else if (ctx.target === "openapi-3.0") {}
	if (ctx.external?.uri) {
		const id = ctx.external.registry.get(schema)?.id;
		if (!id) throw new Error("Schema is missing an `id` property");
		result.$id = ctx.external.uri(id);
	}
	Object.assign(result, root.def ?? root.schema);
	const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
	if (rootMetaId !== void 0 && result.id === rootMetaId) delete result.id;
	const defs = ctx.external?.defs ?? {};
	for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (seen.def && seen.defId) {
			if (seen.def.id === seen.defId) delete seen.def.id;
			defs[seen.defId] = seen.def;
		}
	}
	if (ctx.external) {} else if (Object.keys(defs).length > 0) if (ctx.target === "draft-2020-12") result.$defs = defs;
	else result.definitions = defs;
	try {
		const finalized = JSON.parse(JSON.stringify(result));
		Object.defineProperty(finalized, "~standard", {
			value: {
				...schema["~standard"],
				jsonSchema: {
					input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
					output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
				}
			},
			enumerable: false,
			writable: false
		});
		return finalized;
	} catch (_err) {
		throw new Error("Error converting schema to JSON.");
	}
}
function isTransforming(_schema, _ctx) {
	const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
	if (ctx.seen.has(_schema)) return false;
	ctx.seen.add(_schema);
	const def = _schema._zod.def;
	if (def.type === "transform") return true;
	if (def.type === "array") return isTransforming(def.element, ctx);
	if (def.type === "set") return isTransforming(def.valueType, ctx);
	if (def.type === "lazy") return isTransforming(def.getter(), ctx);
	if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault") return isTransforming(def.innerType, ctx);
	if (def.type === "intersection") return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
	if (def.type === "record" || def.type === "map") return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
	if (def.type === "pipe") {
		if (_schema._zod.traits.has("$ZodCodec")) return true;
		return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
	}
	if (def.type === "object") {
		for (const key in def.shape) if (isTransforming(def.shape[key], ctx)) return true;
		return false;
	}
	if (def.type === "union") {
		for (const option of def.options) if (isTransforming(option, ctx)) return true;
		return false;
	}
	if (def.type === "tuple") {
		for (const item of def.items) if (isTransforming(item, ctx)) return true;
		if (def.rest && isTransforming(def.rest, ctx)) return true;
		return false;
	}
	return false;
}
/**
* Creates a toJSONSchema method for a schema instance.
* This encapsulates the logic of initializing context, processing, extracting defs, and finalizing.
*/
const createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
	const ctx = initializeContext({
		...params,
		processors
	});
	process$1(schema, ctx);
	extractDefs(ctx, schema);
	return finalize(ctx, schema);
};
const createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
	const { libraryOptions, target } = params ?? {};
	const ctx = initializeContext({
		...libraryOptions ?? {},
		target,
		io,
		processors
	});
	process$1(schema, ctx);
	extractDefs(ctx, schema);
	return finalize(ctx, schema);
};
//#endregion
//#region ../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/json-schema-processors.js
const formatMap = {
	guid: "uuid",
	url: "uri",
	datetime: "date-time",
	json_string: "json-string",
	regex: ""
};
const stringProcessor = (schema, ctx, _json, _params) => {
	const json = _json;
	json.type = "string";
	const { minimum, maximum, format, patterns, contentEncoding } = schema._zod.bag;
	if (typeof minimum === "number") json.minLength = minimum;
	if (typeof maximum === "number") json.maxLength = maximum;
	if (format) {
		json.format = formatMap[format] ?? format;
		if (json.format === "") delete json.format;
		if (format === "time") delete json.format;
	}
	if (contentEncoding) json.contentEncoding = contentEncoding;
	if (patterns && patterns.size > 0) {
		const regexes = [...patterns];
		if (regexes.length === 1) json.pattern = regexes[0].source;
		else if (regexes.length > 1) json.allOf = [...regexes.map((regex) => ({
			...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
			pattern: regex.source
		}))];
	}
};
const numberProcessor = (schema, ctx, _json, _params) => {
	const json = _json;
	const { minimum, maximum, format, multipleOf, exclusiveMaximum, exclusiveMinimum } = schema._zod.bag;
	if (typeof format === "string" && format.includes("int")) json.type = "integer";
	else json.type = "number";
	const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
	const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
	const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
	if (exMin) if (legacy) {
		json.minimum = exclusiveMinimum;
		json.exclusiveMinimum = true;
	} else json.exclusiveMinimum = exclusiveMinimum;
	else if (typeof minimum === "number") json.minimum = minimum;
	if (exMax) if (legacy) {
		json.maximum = exclusiveMaximum;
		json.exclusiveMaximum = true;
	} else json.exclusiveMaximum = exclusiveMaximum;
	else if (typeof maximum === "number") json.maximum = maximum;
	if (typeof multipleOf === "number") json.multipleOf = multipleOf;
};
const booleanProcessor = (_schema, _ctx, json, _params) => {
	json.type = "boolean";
};
const neverProcessor = (_schema, _ctx, json, _params) => {
	json.not = {};
};
const enumProcessor = (schema, _ctx, json, _params) => {
	const def = schema._zod.def;
	const values = getEnumValues(def.entries);
	if (values.every((v) => typeof v === "number")) json.type = "number";
	if (values.every((v) => typeof v === "string")) json.type = "string";
	json.enum = values;
};
const literalProcessor = (schema, ctx, json, _params) => {
	const def = schema._zod.def;
	const vals = [];
	for (const val of def.values) if (val === void 0) {
		if (ctx.unrepresentable === "throw") throw new Error("Literal `undefined` cannot be represented in JSON Schema");
	} else if (typeof val === "bigint") if (ctx.unrepresentable === "throw") throw new Error("BigInt literals cannot be represented in JSON Schema");
	else vals.push(Number(val));
	else vals.push(val);
	if (vals.length === 0) {} else if (vals.length === 1) {
		const val = vals[0];
		json.type = val === null ? "null" : typeof val;
		if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") json.enum = [val];
		else json.const = val;
	} else {
		if (vals.every((v) => typeof v === "number")) json.type = "number";
		if (vals.every((v) => typeof v === "string")) json.type = "string";
		if (vals.every((v) => typeof v === "boolean")) json.type = "boolean";
		if (vals.every((v) => v === null)) json.type = "null";
		json.enum = vals;
	}
};
const customProcessor = (_schema, ctx, _json, _params) => {
	if (ctx.unrepresentable === "throw") throw new Error("Custom types cannot be represented in JSON Schema");
};
const transformProcessor = (_schema, ctx, _json, _params) => {
	if (ctx.unrepresentable === "throw") throw new Error("Transforms cannot be represented in JSON Schema");
};
const arrayProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	const { minimum, maximum } = schema._zod.bag;
	if (typeof minimum === "number") json.minItems = minimum;
	if (typeof maximum === "number") json.maxItems = maximum;
	json.type = "array";
	json.items = process$1(def.element, ctx, {
		...params,
		path: [...params.path, "items"]
	});
};
const objectProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	json.type = "object";
	json.properties = {};
	const shape = def.shape;
	for (const key in shape) json.properties[key] = process$1(shape[key], ctx, {
		...params,
		path: [
			...params.path,
			"properties",
			key
		]
	});
	const allKeys = new Set(Object.keys(shape));
	const requiredKeys = new Set([...allKeys].filter((key) => {
		const v = def.shape[key]._zod;
		if (ctx.io === "input") return v.optin === void 0;
		else return v.optout === void 0;
	}));
	if (requiredKeys.size > 0) json.required = Array.from(requiredKeys);
	if (def.catchall?._zod.def.type === "never") json.additionalProperties = false;
	else if (!def.catchall) {
		if (ctx.io === "output") json.additionalProperties = false;
	} else if (def.catchall) json.additionalProperties = process$1(def.catchall, ctx, {
		...params,
		path: [...params.path, "additionalProperties"]
	});
};
const unionProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const isExclusive = def.inclusive === false;
	const options = def.options.map((x, i) => process$1(x, ctx, {
		...params,
		path: [
			...params.path,
			isExclusive ? "oneOf" : "anyOf",
			i
		]
	}));
	if (isExclusive) json.oneOf = options;
	else json.anyOf = options;
};
const intersectionProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const a = process$1(def.left, ctx, {
		...params,
		path: [
			...params.path,
			"allOf",
			0
		]
	});
	const b = process$1(def.right, ctx, {
		...params,
		path: [
			...params.path,
			"allOf",
			1
		]
	});
	const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
	json.allOf = [...isSimpleIntersection(a) ? a.allOf : [a], ...isSimpleIntersection(b) ? b.allOf : [b]];
};
const nullableProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const inner = process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	if (ctx.target === "openapi-3.0") {
		seen.ref = def.innerType;
		json.nullable = true;
	} else json.anyOf = [inner, { type: "null" }];
};
const nonoptionalProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
};
const defaultProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	json.default = JSON.parse(JSON.stringify(def.defaultValue));
};
const prefaultProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	if (ctx.io === "input") json._prefault = JSON.parse(JSON.stringify(def.defaultValue));
};
const catchProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	let catchValue;
	try {
		catchValue = def.catchValue(void 0);
	} catch {
		throw new Error("Dynamic catch values are not supported in JSON Schema");
	}
	json.default = catchValue;
};
const pipeProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	const inIsTransform = def.in._zod.traits.has("$ZodTransform");
	const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
	process$1(innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = innerType;
};
const readonlyProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	json.readOnly = true;
};
const optionalProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
};
const lazyProcessor = (schema, ctx, _json, params) => {
	const innerType = schema._zod.innerType;
	process$1(innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = innerType;
};
//#endregion
//#region ../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/iso.js
const ZodISODateTime = /*@__PURE__*/ $constructor("ZodISODateTime", (inst, def) => {
	$ZodISODateTime.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function datetime(params) {
	return /* @__PURE__ */ _isoDateTime(ZodISODateTime, params);
}
const ZodISODate = /*@__PURE__*/ $constructor("ZodISODate", (inst, def) => {
	$ZodISODate.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function date(params) {
	return /* @__PURE__ */ _isoDate(ZodISODate, params);
}
const ZodISOTime = /*@__PURE__*/ $constructor("ZodISOTime", (inst, def) => {
	$ZodISOTime.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function time(params) {
	return /* @__PURE__ */ _isoTime(ZodISOTime, params);
}
const ZodISODuration = /*@__PURE__*/ $constructor("ZodISODuration", (inst, def) => {
	$ZodISODuration.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function duration(params) {
	return /* @__PURE__ */ _isoDuration(ZodISODuration, params);
}
//#endregion
//#region ../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/errors.js
const initializer = (inst, issues) => {
	$ZodError.init(inst, issues);
	inst.name = "ZodError";
	Object.defineProperties(inst, {
		format: { value: (mapper) => formatError(inst, mapper) },
		flatten: { value: (mapper) => flattenError(inst, mapper) },
		addIssue: { value: (issue) => {
			inst.issues.push(issue);
			inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
		} },
		addIssues: { value: (issues) => {
			inst.issues.push(...issues);
			inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
		} },
		isEmpty: { get() {
			return inst.issues.length === 0;
		} }
	});
};
const ZodRealError = /*@__PURE__*/ $constructor("ZodError", initializer, { Parent: Error });
//#endregion
//#region ../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/parse.js
const parse = /* @__PURE__ */ _parse(ZodRealError);
const parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
const safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
const safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
const encode = /* @__PURE__ */ _encode(ZodRealError);
const decode = /* @__PURE__ */ _decode(ZodRealError);
const encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
const decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
const safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
const safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
const safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
const safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);
//#endregion
//#region ../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/schemas.js
const _installedGroups = /* @__PURE__ */ new WeakMap();
function _installLazyMethods(inst, group, methods) {
	const proto = Object.getPrototypeOf(inst);
	let installed = _installedGroups.get(proto);
	if (!installed) {
		installed = /* @__PURE__ */ new Set();
		_installedGroups.set(proto, installed);
	}
	if (installed.has(group)) return;
	installed.add(group);
	for (const key in methods) {
		const fn = methods[key];
		Object.defineProperty(proto, key, {
			configurable: true,
			enumerable: false,
			get() {
				const bound = fn.bind(this);
				Object.defineProperty(this, key, {
					configurable: true,
					writable: true,
					enumerable: true,
					value: bound
				});
				return bound;
			},
			set(v) {
				Object.defineProperty(this, key, {
					configurable: true,
					writable: true,
					enumerable: true,
					value: v
				});
			}
		});
	}
}
const ZodType = /*@__PURE__*/ $constructor("ZodType", (inst, def) => {
	$ZodType.init(inst, def);
	Object.assign(inst["~standard"], { jsonSchema: {
		input: createStandardJSONSchemaMethod(inst, "input"),
		output: createStandardJSONSchemaMethod(inst, "output")
	} });
	inst.toJSONSchema = createToJSONSchemaMethod(inst, {});
	inst.def = def;
	inst.type = def.type;
	Object.defineProperty(inst, "_def", { value: def });
	inst.parse = (data, params) => parse(inst, data, params, { callee: inst.parse });
	inst.safeParse = (data, params) => safeParse(inst, data, params);
	inst.parseAsync = async (data, params) => parseAsync(inst, data, params, { callee: inst.parseAsync });
	inst.safeParseAsync = async (data, params) => safeParseAsync(inst, data, params);
	inst.spa = inst.safeParseAsync;
	inst.encode = (data, params) => encode(inst, data, params);
	inst.decode = (data, params) => decode(inst, data, params);
	inst.encodeAsync = async (data, params) => encodeAsync(inst, data, params);
	inst.decodeAsync = async (data, params) => decodeAsync(inst, data, params);
	inst.safeEncode = (data, params) => safeEncode(inst, data, params);
	inst.safeDecode = (data, params) => safeDecode(inst, data, params);
	inst.safeEncodeAsync = async (data, params) => safeEncodeAsync(inst, data, params);
	inst.safeDecodeAsync = async (data, params) => safeDecodeAsync(inst, data, params);
	_installLazyMethods(inst, "ZodType", {
		check(...chks) {
			const def = this.def;
			return this.clone(mergeDefs(def, { checks: [...def.checks ?? [], ...chks.map((ch) => typeof ch === "function" ? { _zod: {
				check: ch,
				def: { check: "custom" },
				onattach: []
			} } : ch)] }), { parent: true });
		},
		with(...chks) {
			return this.check(...chks);
		},
		clone(def, params) {
			return clone(this, def, params);
		},
		brand() {
			return this;
		},
		register(reg, meta) {
			reg.add(this, meta);
			return this;
		},
		refine(check, params) {
			return this.check(refine(check, params));
		},
		superRefine(refinement, params) {
			return this.check(superRefine(refinement, params));
		},
		overwrite(fn) {
			return this.check(/* @__PURE__ */ _overwrite(fn));
		},
		optional() {
			return optional(this);
		},
		exactOptional() {
			return exactOptional(this);
		},
		nullable() {
			return nullable(this);
		},
		nullish() {
			return optional(nullable(this));
		},
		nonoptional(params) {
			return nonoptional(this, params);
		},
		array() {
			return array(this);
		},
		or(arg) {
			return union([this, arg]);
		},
		and(arg) {
			return intersection(this, arg);
		},
		transform(tx) {
			return pipe(this, transform(tx));
		},
		default(d) {
			return _default(this, d);
		},
		prefault(d) {
			return prefault(this, d);
		},
		catch(params) {
			return _catch(this, params);
		},
		pipe(target) {
			return pipe(this, target);
		},
		readonly() {
			return readonly(this);
		},
		describe(description) {
			const cl = this.clone();
			globalRegistry.add(cl, { description });
			return cl;
		},
		meta(...args) {
			if (args.length === 0) return globalRegistry.get(this);
			const cl = this.clone();
			globalRegistry.add(cl, args[0]);
			return cl;
		},
		isOptional() {
			return this.safeParse(void 0).success;
		},
		isNullable() {
			return this.safeParse(null).success;
		},
		apply(fn) {
			return fn(this);
		}
	});
	Object.defineProperty(inst, "description", {
		get() {
			return globalRegistry.get(inst)?.description;
		},
		configurable: true
	});
	return inst;
});
/** @internal */
const _ZodString = /*@__PURE__*/ $constructor("_ZodString", (inst, def) => {
	$ZodString.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
	const bag = inst._zod.bag;
	inst.format = bag.format ?? null;
	inst.minLength = bag.minimum ?? null;
	inst.maxLength = bag.maximum ?? null;
	_installLazyMethods(inst, "_ZodString", {
		regex(...args) {
			return this.check(/* @__PURE__ */ _regex(...args));
		},
		includes(...args) {
			return this.check(/* @__PURE__ */ _includes(...args));
		},
		startsWith(...args) {
			return this.check(/* @__PURE__ */ _startsWith(...args));
		},
		endsWith(...args) {
			return this.check(/* @__PURE__ */ _endsWith(...args));
		},
		min(...args) {
			return this.check(/* @__PURE__ */ _minLength(...args));
		},
		max(...args) {
			return this.check(/* @__PURE__ */ _maxLength(...args));
		},
		length(...args) {
			return this.check(/* @__PURE__ */ _length(...args));
		},
		nonempty(...args) {
			return this.check(/* @__PURE__ */ _minLength(1, ...args));
		},
		lowercase(params) {
			return this.check(/* @__PURE__ */ _lowercase(params));
		},
		uppercase(params) {
			return this.check(/* @__PURE__ */ _uppercase(params));
		},
		trim() {
			return this.check(/* @__PURE__ */ _trim());
		},
		normalize(...args) {
			return this.check(/* @__PURE__ */ _normalize(...args));
		},
		toLowerCase() {
			return this.check(/* @__PURE__ */ _toLowerCase());
		},
		toUpperCase() {
			return this.check(/* @__PURE__ */ _toUpperCase());
		},
		slugify() {
			return this.check(/* @__PURE__ */ _slugify());
		}
	});
});
const ZodString = /*@__PURE__*/ $constructor("ZodString", (inst, def) => {
	$ZodString.init(inst, def);
	_ZodString.init(inst, def);
	inst.email = (params) => inst.check(/* @__PURE__ */ _email(ZodEmail, params));
	inst.url = (params) => inst.check(/* @__PURE__ */ _url(ZodURL, params));
	inst.jwt = (params) => inst.check(/* @__PURE__ */ _jwt(ZodJWT, params));
	inst.emoji = (params) => inst.check(/* @__PURE__ */ _emoji(ZodEmoji, params));
	inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
	inst.uuid = (params) => inst.check(/* @__PURE__ */ _uuid(ZodUUID, params));
	inst.uuidv4 = (params) => inst.check(/* @__PURE__ */ _uuidv4(ZodUUID, params));
	inst.uuidv6 = (params) => inst.check(/* @__PURE__ */ _uuidv6(ZodUUID, params));
	inst.uuidv7 = (params) => inst.check(/* @__PURE__ */ _uuidv7(ZodUUID, params));
	inst.nanoid = (params) => inst.check(/* @__PURE__ */ _nanoid(ZodNanoID, params));
	inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
	inst.cuid = (params) => inst.check(/* @__PURE__ */ _cuid(ZodCUID, params));
	inst.cuid2 = (params) => inst.check(/* @__PURE__ */ _cuid2(ZodCUID2, params));
	inst.ulid = (params) => inst.check(/* @__PURE__ */ _ulid(ZodULID, params));
	inst.base64 = (params) => inst.check(/* @__PURE__ */ _base64(ZodBase64, params));
	inst.base64url = (params) => inst.check(/* @__PURE__ */ _base64url(ZodBase64URL, params));
	inst.xid = (params) => inst.check(/* @__PURE__ */ _xid(ZodXID, params));
	inst.ksuid = (params) => inst.check(/* @__PURE__ */ _ksuid(ZodKSUID, params));
	inst.ipv4 = (params) => inst.check(/* @__PURE__ */ _ipv4(ZodIPv4, params));
	inst.ipv6 = (params) => inst.check(/* @__PURE__ */ _ipv6(ZodIPv6, params));
	inst.cidrv4 = (params) => inst.check(/* @__PURE__ */ _cidrv4(ZodCIDRv4, params));
	inst.cidrv6 = (params) => inst.check(/* @__PURE__ */ _cidrv6(ZodCIDRv6, params));
	inst.e164 = (params) => inst.check(/* @__PURE__ */ _e164(ZodE164, params));
	inst.datetime = (params) => inst.check(datetime(params));
	inst.date = (params) => inst.check(date(params));
	inst.time = (params) => inst.check(time(params));
	inst.duration = (params) => inst.check(duration(params));
});
function string(params) {
	return /* @__PURE__ */ _string(ZodString, params);
}
const ZodStringFormat = /*@__PURE__*/ $constructor("ZodStringFormat", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	_ZodString.init(inst, def);
});
const ZodEmail = /*@__PURE__*/ $constructor("ZodEmail", (inst, def) => {
	$ZodEmail.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodGUID = /*@__PURE__*/ $constructor("ZodGUID", (inst, def) => {
	$ZodGUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodUUID = /*@__PURE__*/ $constructor("ZodUUID", (inst, def) => {
	$ZodUUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodURL = /*@__PURE__*/ $constructor("ZodURL", (inst, def) => {
	$ZodURL.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodEmoji = /*@__PURE__*/ $constructor("ZodEmoji", (inst, def) => {
	$ZodEmoji.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodNanoID = /*@__PURE__*/ $constructor("ZodNanoID", (inst, def) => {
	$ZodNanoID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link ZodCUID2} instead.
* See https://github.com/paralleldrive/cuid.
*/
const ZodCUID = /*@__PURE__*/ $constructor("ZodCUID", (inst, def) => {
	$ZodCUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodCUID2 = /*@__PURE__*/ $constructor("ZodCUID2", (inst, def) => {
	$ZodCUID2.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodULID = /*@__PURE__*/ $constructor("ZodULID", (inst, def) => {
	$ZodULID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodXID = /*@__PURE__*/ $constructor("ZodXID", (inst, def) => {
	$ZodXID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodKSUID = /*@__PURE__*/ $constructor("ZodKSUID", (inst, def) => {
	$ZodKSUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodIPv4 = /*@__PURE__*/ $constructor("ZodIPv4", (inst, def) => {
	$ZodIPv4.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodIPv6 = /*@__PURE__*/ $constructor("ZodIPv6", (inst, def) => {
	$ZodIPv6.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodCIDRv4 = /*@__PURE__*/ $constructor("ZodCIDRv4", (inst, def) => {
	$ZodCIDRv4.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodCIDRv6 = /*@__PURE__*/ $constructor("ZodCIDRv6", (inst, def) => {
	$ZodCIDRv6.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodBase64 = /*@__PURE__*/ $constructor("ZodBase64", (inst, def) => {
	$ZodBase64.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodBase64URL = /*@__PURE__*/ $constructor("ZodBase64URL", (inst, def) => {
	$ZodBase64URL.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodE164 = /*@__PURE__*/ $constructor("ZodE164", (inst, def) => {
	$ZodE164.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodJWT = /*@__PURE__*/ $constructor("ZodJWT", (inst, def) => {
	$ZodJWT.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodNumber = /*@__PURE__*/ $constructor("ZodNumber", (inst, def) => {
	$ZodNumber.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
	_installLazyMethods(inst, "ZodNumber", {
		gt(value, params) {
			return this.check(/* @__PURE__ */ _gt(value, params));
		},
		gte(value, params) {
			return this.check(/* @__PURE__ */ _gte(value, params));
		},
		min(value, params) {
			return this.check(/* @__PURE__ */ _gte(value, params));
		},
		lt(value, params) {
			return this.check(/* @__PURE__ */ _lt(value, params));
		},
		lte(value, params) {
			return this.check(/* @__PURE__ */ _lte(value, params));
		},
		max(value, params) {
			return this.check(/* @__PURE__ */ _lte(value, params));
		},
		int(params) {
			return this.check(int(params));
		},
		safe(params) {
			return this.check(int(params));
		},
		positive(params) {
			return this.check(/* @__PURE__ */ _gt(0, params));
		},
		nonnegative(params) {
			return this.check(/* @__PURE__ */ _gte(0, params));
		},
		negative(params) {
			return this.check(/* @__PURE__ */ _lt(0, params));
		},
		nonpositive(params) {
			return this.check(/* @__PURE__ */ _lte(0, params));
		},
		multipleOf(value, params) {
			return this.check(/* @__PURE__ */ _multipleOf(value, params));
		},
		step(value, params) {
			return this.check(/* @__PURE__ */ _multipleOf(value, params));
		},
		finite() {
			return this;
		}
	});
	const bag = inst._zod.bag;
	inst.minValue = Math.max(bag.minimum ?? Number.NEGATIVE_INFINITY, bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null;
	inst.maxValue = Math.min(bag.maximum ?? Number.POSITIVE_INFINITY, bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null;
	inst.isInt = (bag.format ?? "").includes("int") || Number.isSafeInteger(bag.multipleOf ?? .5);
	inst.isFinite = true;
	inst.format = bag.format ?? null;
});
function number(params) {
	return /* @__PURE__ */ _number(ZodNumber, params);
}
const ZodNumberFormat = /*@__PURE__*/ $constructor("ZodNumberFormat", (inst, def) => {
	$ZodNumberFormat.init(inst, def);
	ZodNumber.init(inst, def);
});
function int(params) {
	return /* @__PURE__ */ _int(ZodNumberFormat, params);
}
const ZodBoolean = /*@__PURE__*/ $constructor("ZodBoolean", (inst, def) => {
	$ZodBoolean.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
});
function boolean(params) {
	return /* @__PURE__ */ _boolean(ZodBoolean, params);
}
const ZodUnknown = /*@__PURE__*/ $constructor("ZodUnknown", (inst, def) => {
	$ZodUnknown.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => void 0;
});
function unknown() {
	return /* @__PURE__ */ _unknown(ZodUnknown);
}
const ZodNever = /*@__PURE__*/ $constructor("ZodNever", (inst, def) => {
	$ZodNever.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
});
function never(params) {
	return /* @__PURE__ */ _never(ZodNever, params);
}
const ZodArray = /*@__PURE__*/ $constructor("ZodArray", (inst, def) => {
	$ZodArray.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
	inst.element = def.element;
	_installLazyMethods(inst, "ZodArray", {
		min(n, params) {
			return this.check(/* @__PURE__ */ _minLength(n, params));
		},
		nonempty(params) {
			return this.check(/* @__PURE__ */ _minLength(1, params));
		},
		max(n, params) {
			return this.check(/* @__PURE__ */ _maxLength(n, params));
		},
		length(n, params) {
			return this.check(/* @__PURE__ */ _length(n, params));
		},
		unwrap() {
			return this.element;
		}
	});
});
function array(element, params) {
	return /* @__PURE__ */ _array(ZodArray, element, params);
}
const ZodObject = /*@__PURE__*/ $constructor("ZodObject", (inst, def) => {
	$ZodObjectJIT.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
	defineLazy(inst, "shape", () => {
		return def.shape;
	});
	_installLazyMethods(inst, "ZodObject", {
		keyof() {
			return _enum(Object.keys(this._zod.def.shape));
		},
		catchall(catchall) {
			return this.clone({
				...this._zod.def,
				catchall
			});
		},
		passthrough() {
			return this.clone({
				...this._zod.def,
				catchall: unknown()
			});
		},
		loose() {
			return this.clone({
				...this._zod.def,
				catchall: unknown()
			});
		},
		strict() {
			return this.clone({
				...this._zod.def,
				catchall: never()
			});
		},
		strip() {
			return this.clone({
				...this._zod.def,
				catchall: void 0
			});
		},
		extend(incoming) {
			return extend(this, incoming);
		},
		safeExtend(incoming) {
			return safeExtend(this, incoming);
		},
		merge(other) {
			return merge(this, other);
		},
		pick(mask) {
			return pick(this, mask);
		},
		omit(mask) {
			return omit(this, mask);
		},
		partial(...args) {
			return partial(ZodOptional, this, args[0]);
		},
		required(...args) {
			return required(ZodNonOptional, this, args[0]);
		}
	});
});
function object$1(shape, params) {
	return new ZodObject({
		type: "object",
		shape: shape ?? {},
		...normalizeParams(params)
	});
}
const ZodUnion = /*@__PURE__*/ $constructor("ZodUnion", (inst, def) => {
	$ZodUnion.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
	inst.options = def.options;
});
function union(options, params) {
	return new ZodUnion({
		type: "union",
		options,
		...normalizeParams(params)
	});
}
const ZodDiscriminatedUnion = /*@__PURE__*/ $constructor("ZodDiscriminatedUnion", (inst, def) => {
	ZodUnion.init(inst, def);
	$ZodDiscriminatedUnion.init(inst, def);
});
function discriminatedUnion(discriminator, options, params) {
	return new ZodDiscriminatedUnion({
		type: "union",
		options,
		discriminator,
		...normalizeParams(params)
	});
}
const ZodIntersection = /*@__PURE__*/ $constructor("ZodIntersection", (inst, def) => {
	$ZodIntersection.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
});
function intersection(left, right) {
	return new ZodIntersection({
		type: "intersection",
		left,
		right
	});
}
const ZodEnum = /*@__PURE__*/ $constructor("ZodEnum", (inst, def) => {
	$ZodEnum.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
	inst.enum = def.entries;
	inst.options = Object.values(def.entries);
	const keys = new Set(Object.keys(def.entries));
	inst.extract = (values, params) => {
		const newEntries = {};
		for (const value of values) if (keys.has(value)) newEntries[value] = def.entries[value];
		else throw new Error(`Key ${value} not found in enum`);
		return new ZodEnum({
			...def,
			checks: [],
			...normalizeParams(params),
			entries: newEntries
		});
	};
	inst.exclude = (values, params) => {
		const newEntries = { ...def.entries };
		for (const value of values) if (keys.has(value)) delete newEntries[value];
		else throw new Error(`Key ${value} not found in enum`);
		return new ZodEnum({
			...def,
			checks: [],
			...normalizeParams(params),
			entries: newEntries
		});
	};
});
function _enum(values, params) {
	return new ZodEnum({
		type: "enum",
		entries: Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values,
		...normalizeParams(params)
	});
}
const ZodLiteral = /*@__PURE__*/ $constructor("ZodLiteral", (inst, def) => {
	$ZodLiteral.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
	inst.values = new Set(def.values);
	Object.defineProperty(inst, "value", { get() {
		if (def.values.length > 1) throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
		return def.values[0];
	} });
});
function literal(value, params) {
	return new ZodLiteral({
		type: "literal",
		values: Array.isArray(value) ? value : [value],
		...normalizeParams(params)
	});
}
const ZodTransform = /*@__PURE__*/ $constructor("ZodTransform", (inst, def) => {
	$ZodTransform.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
	inst._zod.parse = (payload, _ctx) => {
		if (_ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
		payload.addIssue = (issue$1) => {
			if (typeof issue$1 === "string") payload.issues.push(issue(issue$1, payload.value, def));
			else {
				const _issue = issue$1;
				if (_issue.fatal) _issue.continue = false;
				_issue.code ?? (_issue.code = "custom");
				_issue.input ?? (_issue.input = payload.value);
				_issue.inst ?? (_issue.inst = inst);
				payload.issues.push(issue(_issue));
			}
		};
		const output = def.transform(payload.value, payload);
		if (output instanceof Promise) return output.then((output) => {
			payload.value = output;
			payload.fallback = true;
			return payload;
		});
		payload.value = output;
		payload.fallback = true;
		return payload;
	};
});
function transform(fn) {
	return new ZodTransform({
		type: "transform",
		transform: fn
	});
}
const ZodOptional = /*@__PURE__*/ $constructor("ZodOptional", (inst, def) => {
	$ZodOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
	return new ZodOptional({
		type: "optional",
		innerType
	});
}
const ZodExactOptional = /*@__PURE__*/ $constructor("ZodExactOptional", (inst, def) => {
	$ZodExactOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
	return new ZodExactOptional({
		type: "optional",
		innerType
	});
}
const ZodNullable = /*@__PURE__*/ $constructor("ZodNullable", (inst, def) => {
	$ZodNullable.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
	return new ZodNullable({
		type: "nullable",
		innerType
	});
}
const ZodDefault = /*@__PURE__*/ $constructor("ZodDefault", (inst, def) => {
	$ZodDefault.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
	inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
	return new ZodDefault({
		type: "default",
		innerType,
		get defaultValue() {
			return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
		}
	});
}
const ZodPrefault = /*@__PURE__*/ $constructor("ZodPrefault", (inst, def) => {
	$ZodPrefault.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
	return new ZodPrefault({
		type: "prefault",
		innerType,
		get defaultValue() {
			return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
		}
	});
}
const ZodNonOptional = /*@__PURE__*/ $constructor("ZodNonOptional", (inst, def) => {
	$ZodNonOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
	return new ZodNonOptional({
		type: "nonoptional",
		innerType,
		...normalizeParams(params)
	});
}
const ZodCatch = /*@__PURE__*/ $constructor("ZodCatch", (inst, def) => {
	$ZodCatch.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
	inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
	return new ZodCatch({
		type: "catch",
		innerType,
		catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
	});
}
const ZodPipe = /*@__PURE__*/ $constructor("ZodPipe", (inst, def) => {
	$ZodPipe.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
	inst.in = def.in;
	inst.out = def.out;
});
function pipe(in_, out) {
	return new ZodPipe({
		type: "pipe",
		in: in_,
		out
	});
}
const ZodReadonly = /*@__PURE__*/ $constructor("ZodReadonly", (inst, def) => {
	$ZodReadonly.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
	return new ZodReadonly({
		type: "readonly",
		innerType
	});
}
const ZodLazy = /*@__PURE__*/ $constructor("ZodLazy", (inst, def) => {
	$ZodLazy.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => lazyProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.getter();
});
function lazy(getter) {
	return new ZodLazy({
		type: "lazy",
		getter
	});
}
const ZodCustom = /*@__PURE__*/ $constructor("ZodCustom", (inst, def) => {
	$ZodCustom.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
});
function refine(fn, _params = {}) {
	return /* @__PURE__ */ _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
	return /* @__PURE__ */ _superRefine(fn, params);
}
//#endregion
//#region ../subagent/src/error.ts
/**
* Typed failures shared by subagent service and provider operations.
*
* @module @deepseek-ai/dsh-subagent
*/
/** Typed failure for the subagent seam. */
var SubagentError = class extends HarnessError {
	constructor(message, code, options) {
		super(message, code, options);
		this.name = "SubagentError";
	}
};
//#endregion
//#region ../subagent/src/control.ts
const SESSION_ID_SCHEMA = string().min(1);
const CONTROL_ID_SCHEMAS = {
	"subagent.list": object$1({ parentSessionId: SESSION_ID_SCHEMA }),
	"subagent.prompt": object$1({
		parentSessionId: SESSION_ID_SCHEMA,
		childSessionId: SESSION_ID_SCHEMA,
		mode: literal("continuable"),
		delivery: _enum(["queue", "steer"])
	}),
	"subagent.interrupt": object$1({
		parentSessionId: SESSION_ID_SCHEMA,
		childSessionId: SESSION_ID_SCHEMA,
		mode: literal("continuable")
	})
};
/**
* Apply the subagent payload checks that are stricter than generated
* branded-string codecs.
* @param method - method name carried in the failure message.
* @param payload - decoded control fields to validate.
* @throws {RemoteError} `gateway/bad-request` with the original Zod issues.
*/
function validateControlRequest(method, payload) {
	const parsed = CONTROL_ID_SCHEMAS[method].safeParse(payload);
	if (!parsed.success) throw new RemoteError("gateway/bad-request", `invalid payload for ${method}`, { issues: parsed.error.issues });
}
/**
* Project one durable listing onto the catalog view, replacing each row's
* store-derived activity with the live Agent driver's status and reporting
* whether the exact parent Agent is live. Without an Agent registry no driver
* runs at all, so every row is inactive and the parent is unavailable.
* @param ctx - Host context that may carry the Agent registry.
* @param parentSessionId - the listed parent.
* @param entries - the durable direct-child listing.
* @returns the catalog view answered to one browser.
*/
function catalogView(ctx, parentSessionId, entries) {
	const agents = ctx.get("agents");
	return {
		entries: entries.map((entry) => entry.kind === "child" ? {
			...entry,
			activity: agents?.get(entry.id)?.status === "running" ? "running" : "inactive"
		} : entry),
		parentAvailable: agents?.get(parentSessionId) !== void 0
	};
}
/**
* Refuse one catalog read while preserving cancellation and a missing
* projections registry as distinct failures.
* @param error - the thrown value.
* @param signal - the caller's cancellation.
* @returns Never — the refusal is thrown.
* @throws {RemoteError} always.
*/
function rejectCatalogRead(error, signal) {
	if (isCancellation(error, signal)) throw new RemoteError("gateway/cancelled", "subagent catalog read was cancelled", {}, { cause: error });
	if (error instanceof SubagentError && error.code === "SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE") throw new RemoteError("subagent/projections-unavailable", "subagent catalog is unavailable: this deployment does not mount the sessionProjections registry (load @deepseek-ai/dsh-session-projection)", {}, { cause: error });
	throw new RemoteError("gateway/internal", "subagent catalog read failed", {}, { cause: error });
}
/**
* Refuse one continuation prompt without exposing provider detail: admission
* failures the caller can act on keep their own code, everything else is
* internal.
* @param error - the thrown value.
* @param childSessionId - the addressed child.
* @param signal - the caller's cancellation.
* @returns Never — the refusal is thrown.
* @throws {RemoteError} always.
*/
function rejectPrompt(error, childSessionId, signal) {
	if (isCancellation(error, signal)) throw new RemoteError("gateway/cancelled", "subagent prompt was cancelled", {}, { cause: error });
	if (error instanceof AttachmentError) throw new RemoteError("subagent/attachment-invalid", error.message, { reason: error.code }, { cause: error });
	if (error instanceof SubagentError) switch (error.code) {
		case "MODEL_DOES_NOT_SUPPORT_IMAGES": throw new RemoteError("subagent/attachment-invalid", error.message, { reason: error.code }, { cause: error });
		case "NOT_RESUMABLE": throw new RemoteError("subagent/not-resumable", "subagent cannot be resumed", { childSessionId }, { cause: error });
		case "UNAUTHORIZED": throw new RemoteError("subagent/unauthorized", "subagent does not belong to this parent", { childSessionId }, { cause: error });
		case "DRAINING":
		case "ACTIVATION_CLOSING":
		case "CONTINUATION_UNAVAILABLE":
		case "PERSISTENCE_UNAVAILABLE": throw new RemoteError("subagent/delivery-unavailable", "subagent follow-up is temporarily unavailable", { childSessionId }, { cause: error });
		default: break;
	}
	throw new RemoteError("gateway/internal", "subagent prompt failed", {}, { cause: error });
}
function isCancellation(error, signal) {
	return signal.aborted || error instanceof SubagentError && error.code === "CANCELLED";
}
//#endregion
//#region ../subagent/src/depth.ts
/**
* Read an agent's delegation depth, treating absence as top-level depth zero.
* The persisted session header is authoritative and monotone: runtime
* `AgentOptions.subagentDepth` may DEEPEN the count but can never lower it —
* a resumed child arrives with fresh options, and counting it from zero would
* let it delegate as if it were top-level.
* @param agent - the agent whose header and options carry the depth.
* @returns its non-negative safe-integer depth.
* @throws if the runtime `AgentOptions.subagentDepth` is not a non-negative safe integer.
*/
function delegationDepthOf(agent) {
	const runtime = agent.options.subagentDepth;
	if (runtime !== void 0 && (!Number.isSafeInteger(runtime) || runtime < 0 || Object.is(runtime, -0))) throw new TypeError("agent subagentDepth must be a non-negative safe integer");
	return Math.max(agent.session.header.delegationDepth ?? 0, runtime ?? 0);
}
/**
* Reject a recursion cap that cannot represent an exact delegation depth.
* @param maxDepth - the optional runtime value to validate.
*/
function assertSubagentMaxDepth(maxDepth) {
	if (maxDepth !== void 0 && (typeof maxDepth !== "number" || !Number.isSafeInteger(maxDepth) || maxDepth < 0 || Object.is(maxDepth, -0))) throw new TypeError("subagent maxDepth must be a non-negative safe integer");
}
//#endregion
//#region ../../core/native-agent/src/consumed-work.ts
/**
* Whether a turn that consumed input but never reached a step ends in a way
* that accounts for that input. Only a `completed` end does not: it had
* nothing left to run once its claim was rewritten away. A `blocked` end is
* that input's ending too — the pre-step rejection that produced it discarded
* the claimed messages, so the work it took will never run.
* @param reason - the turn's recorded ending.
* @returns whether the ending accounts for the input the turn took.
*/
function accountsForClaim(reason) {
	switch (reason.kind) {
		case "completed": return false;
		case "blocked":
		case "aborted":
		case "interrupted":
		case "error": return true;
		/* v8 ignore next 4 -- unreachable: the one unnamed built-in, `max-tokens`, requires a step,
		* so its turn short-circuits as stepped before this call, and `TurnEndReasonMap` is
		* merge-extensible, so a backend-added variant cannot be listed; an unnameable ending over
		* consumed input must not read as success. */
		default: return true;
	}
}
/**
* Fold one agent log, or an owned suffix of one, into its account of consumed
* work. Single pass, and every input is the log itself: no caller has to sample
* live state before cancelling, so a cancellation issued by anyone — the owner's
* teardown, an ancestor's interrupt, an unloading plugin — reads the same.
* @param events - the log, or an owned suffix, to fold.
* @returns the accounting turn when one closed, and whether work was dropped unrun after it.
*/
function foldConsumedWork(events) {
	const stepped = /* @__PURE__ */ new Set();
	const claimed = /* @__PURE__ */ new Set();
	let open;
	let end;
	let droppedUnrun = false;
	for (const event of events) switch (event.type) {
		case "turn/start":
			open = event.data.turn;
			break;
		case "step/start":
			stepped.add(event.data.turn);
			break;
		case "agent/inbox/spliced": {
			const { removedCount, outcome, inserted } = event.data;
			if (removedCount === void 0) break;
			if (outcome === "canceled") droppedUnrun ||= inserted.length === 0;
			else if (open !== void 0) claimed.add(open);
			break;
		}
		case "turn/end": {
			const { turn, reason } = event.data;
			open = void 0;
			if (stepped.delete(turn) || claimed.delete(turn) && accountsForClaim(reason)) {
				end = event;
				droppedUnrun = false;
			}
			break;
		}
		default: break;
	}
	return {
		...end === void 0 ? {} : { end },
		droppedUnrun
	};
}
const DESCRIPTOR_BASE_KEYS = [
	"version",
	"mode",
	"provider",
	"label"
];
const ONE_SHOT_DESCRIPTOR_KEYS = new Set(DESCRIPTOR_BASE_KEYS);
const CONTINUABLE_DESCRIPTOR_KEYS = new Set([
	...DESCRIPTOR_BASE_KEYS,
	"agentProvider",
	"agentModel",
	"agentReasoningEffort",
	"persona",
	"toolFilter"
]);
const TOOL_FILTER_KEYS = new Set(["allow", "deny"]);
/** Whether a persisted JSON value is an object record. */
function isRecord$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Reject fields outside one versioned record's declared schema. */
function assertKnownKeys(value, keys, path) {
	const unknown = Object.keys(value).find((key) => !keys.has(key));
	if (unknown !== void 0) throw new Error(`persisted subagent descriptor ${path} has unknown field "${unknown}"`);
}
/** Read one optional string field from a persisted descriptor record. */
function optionalString(value, key) {
	if (!Object.hasOwn(value, key)) return void 0;
	const field = value[key];
	if (typeof field !== "string") throw new Error(`persisted subagent descriptor ${key} must be a string`);
	return field;
}
/** Read one optional string-array field from a persisted tool restriction. */
function optionalStringArray(value, key) {
	if (!Object.hasOwn(value, key)) return void 0;
	const field = value[key];
	if (!Array.isArray(field)) throw new Error(`persisted subagent descriptor toolFilter.${key} must be an array of strings`);
	const items = field;
	if (items.some((item) => typeof item !== "string")) throw new Error(`persisted subagent descriptor toolFilter.${key} must be an array of strings`);
	return items;
}
/** Validate and reconstruct a persisted tool restriction. */
function parseToolFilter(value) {
	if (!isRecord$2(value)) throw new Error("persisted subagent descriptor toolFilter must be an object");
	assertKnownKeys(value, TOOL_FILTER_KEYS, "toolFilter");
	const allow = optionalStringArray(value, "allow");
	const deny = optionalStringArray(value, "deny");
	if (allow === void 0 && deny === void 0) throw new Error("persisted subagent descriptor toolFilter must declare allow and/or deny");
	return {
		...allow !== void 0 ? { allow } : {},
		...deny !== void 0 ? { deny } : {}
	};
}
/** Validate one persisted descriptor payload for the current runtime. */
function parseSubagentDescriptor(value) {
	if (!isRecord$2(value)) throw new Error("persisted subagent descriptor payload must be an object");
	const version = value["version"];
	if (typeof version !== "number") throw new Error("persisted subagent descriptor version must be a number");
	if (version !== 3) return void 0;
	const mode = value["mode"];
	if (mode !== "one-shot" && mode !== "continuable") throw new Error("persisted subagent descriptor mode must be \"one-shot\" or \"continuable\"");
	assertKnownKeys(value, mode === "one-shot" ? ONE_SHOT_DESCRIPTOR_KEYS : CONTINUABLE_DESCRIPTOR_KEYS, "payload");
	const provider = value["provider"];
	if (typeof provider !== "string") throw new Error("persisted subagent descriptor provider must be a string");
	if (mode === "one-shot") {
		const label = optionalString(value, "label");
		return {
			version: 3,
			mode,
			provider,
			...label !== void 0 ? { label } : {}
		};
	}
	const label = value["label"];
	if (typeof label !== "string") throw new Error("persisted subagent descriptor label must be a string");
	const agentProvider = optionalString(value, "agentProvider");
	const agentModel = optionalString(value, "agentModel");
	const agentReasoningEffort = optionalString(value, "agentReasoningEffort");
	const persona = optionalString(value, "persona");
	const toolFilter = Object.hasOwn(value, "toolFilter") ? parseToolFilter(value["toolFilter"]) : void 0;
	return {
		version: 3,
		mode,
		provider,
		label,
		...agentProvider !== void 0 ? { agentProvider } : {},
		...agentModel !== void 0 ? { agentModel } : {},
		...agentReasoningEffort !== void 0 ? { agentReasoningEffort } : {},
		...persona !== void 0 ? { persona } : {},
		...toolFilter !== void 0 ? { toolFilter } : {}
	};
}
function snapshotSubagentDescriptor(input) {
	const snapshot = snapshotJsonValue(input.mode === "one-shot" ? {
		version: 3,
		mode: input.mode,
		provider: input.provider,
		...input.label !== void 0 ? { label: input.label } : {}
	} : {
		version: 3,
		mode: input.mode,
		provider: input.provider,
		label: input.label,
		...input.agentProvider !== void 0 ? { agentProvider: input.agentProvider } : {},
		...input.agentModel !== void 0 ? { agentModel: input.agentModel } : {},
		...input.agentReasoningEffort !== void 0 ? { agentReasoningEffort: input.agentReasoningEffort } : {},
		...input.persona !== void 0 ? { persona: input.persona } : {},
		...input.toolFilter !== void 0 ? { toolFilter: input.toolFilter } : {}
	});
	if (snapshot === void 0) throw new Error("subagent descriptor is not losslessly JSON-serializable");
	return snapshot;
}
/**
* Fold a persisted child log to its supported descriptor. The first
* `subagent/descriptor` event is authoritative — the establishing provider
* appends exactly one, so a later same-type event cannot rewrite the declared
* composition.
* @param events - the loaded child session events.
* @returns the descriptor, or `undefined` when the log has none or its
*   version is not {@link SUBAGENT_DESCRIPTOR_VERSION} (the child cannot be
*   classified by this runtime).
* @throws when a current-version persisted payload does not match its complete
*   declared schema.
*/
function foldSubagentDescriptor(events) {
	const event = events.find((candidate) => candidate.type === "subagent/descriptor");
	if (event === void 0) return void 0;
	return parseSubagentDescriptor(event.data);
}
//#endregion
//#region ../subagent-protocol/src/assistant-output.ts
/**
* Canonical selection of a child's final assistant output. Backend run results
* and `subagent/end.lastAssistantMessage` apply the same rule: select the last
* non-empty assistant message. An empty-content message records usage only
* when the loop appends it after a max-tokens step with no executable blocks,
* so it does not replace earlier output. If no non-empty message exists,
* select the accumulated assistant text. Selection is independent of the
* run's stop reason.
*
* @module @deepseek-ai/dsh-subagent/assistant-output
*/
/**
* Incremental fold of the selection rule, for backends that observe a child's
* output as it streams: session-event backends {@link push} each event, and
* transports without session events (ACP content chunks) {@link pushText} raw
* text into the same streamed fallback.
*/
var AssistantOutputFold = class {
	message;
	partial = [];
	/**
	* Fold one session event: a non-empty assistant message becomes the
	* candidate final answer, while its embedded stream and any log-only attempt
	* extend the streamed fallback; every other event contributes nothing.
	* @param event - the next observed session event.
	*/
	push(event) {
		if (event.type === "assistant/message") {
			const content = event.data.message.content;
			if (content.length > 0) this.message = content;
		}
		if (event.type === "assistant/message" || event.type === "assistant/attempt") this.pushText(joinAssistantStreamText(event.data.stream));
	}
	/**
	* Extend the streamed fallback with text observed outside session events.
	* @param text - the next streamed text piece (an empty piece is a no-op).
	*/
	pushText(text) {
		if (text.length > 0) this.partial.push(text);
	}
	/**
	* Select the final output folded so far.
	* @returns the last non-empty assistant message, else the accumulated
	*   streamed text, or `undefined` when the child produced neither.
	*/
	collect() {
		if (this.message !== void 0) return this.message;
		const text = this.partial.join("");
		return text.length > 0 ? [{
			type: "text",
			text
		}] : void 0;
	}
};
/**
* Apply the selection rule to one complete child-owned event suffix.
* @param events - the child-owned events (after any seed or epoch boundary).
* @returns the selected output, or `undefined` when the child produced none.
*/
function finalAssistantOutput(events) {
	const message = events.findLast((event) => event.type === "assistant/message" && event.data.message.content.length > 0);
	if (message?.type === "assistant/message") return message.data.message.content;
	const fold = new AssistantOutputFold();
	for (const event of events) fold.push(event);
	return fold.collect();
}
//#endregion
//#region ../subagent-protocol/src/delegation-context.ts
/** Fixed permission-scope guidance shared by in-process Subagent Providers. */
const SUBAGENT_DELEGATION_CONTEXT = "You are a delegated subagent: your permission scope was fixed when you were started and cannot be widened from inside this session — operations that require approval are rejected automatically. When the task needs access beyond that scope, do not retry the denied operation; state the limitation in your reply so the delegating agent can handle it.";
//#endregion
//#region ../subagent-protocol/src/continuation-messages.ts
/** Durable adjacent-Agent attribution and continuation guidance shared by both runtimes. */
/** Build one durable model-authored input after the Provider has authorized sender adjacency.
* @param senderSessionId - exact live sender's durable identity.
* @param content - model-visible blocks supplied by that sender.
* @returns identified input with adjacent-Agent attribution and the existing relay prefix.
*/
function createAdjacentAgentMessage(senderSessionId, content) {
	return createUserMessage({
		content: [{
			type: "text",
			text: `Agent ${senderSessionId} sent a message: `
		}, ...content],
		source: {
			kind: "agent-message",
			form: "relay",
			senderSessionId
		}
	});
}
/**
* Append adjacent-Agent return guidance to a continuable child's initial task.
* @param parentId - durable parent session id named in the guidance.
* @param prompt - initial model-visible task blocks.
* @returns task blocks followed by the continuable return guidance.
*/
function withContinuableReturnGuidance(parentId, prompt) {
	const encodedParentId = JSON.stringify(parentId);
	return [...prompt, {
		type: "text",
		text: `Your parent agent id is ${encodedParentId}. Before you finish, send your result to that agent with send_message({ agent_id: ${encodedParentId}, message: "<self-contained result>" }). The parent shares your workspace but does not automatically receive your transcript, tool output, or reasoning. Send earlier messages as well when a finding changes what the parent should do next; sending a message does not end your turn.`
	}];
}
//#endregion
//#region ../subagent-protocol/src/settlement.ts
/** Durable runtime-owned notices shared by compatibility and native subagents. */
/**
* One line telling a parent that a background child is finished and why, in
* the parent's own task vocabulary.
* @param childId - the durable child the parent knows by id.
* @param stopReason - how the child's last ordinary turn ended.
* @returns the model-facing opening line of the settlement notice.
*/
function settlementSummary(childId, stopReason) {
	const subject = `Background subagent ${childId}`;
	switch (stopReason) {
		case "completed": return `${subject} finished and will do no further work unless you send it more.`;
		case "aborted": return `${subject} was stopped before it finished.`;
		case "max-tokens": return `${subject} ran out of room before it finished.`;
		case "refusal": return `${subject} declined the task.`;
		case "error": return `${subject} failed before it finished.`;
		/* v8 ignore next 4 -- the ending vocabulary is merge-extensible, so this arm
		* needs a backend that adds a variant; an unnameable ending is reported as unfinished
		* rather than silently as success. */
		default: return `${subject} ended abnormally (${stopReason}) before it finished.`;
	}
}
/**
* Build the runtime-owned settlement notice delivered to a child's parent.
* @param childId - durable child session id named in the notice.
* @param terminal - recorded terminal state for the settled Activation.
* @returns the durable user-message representation delivered to the parent.
*/
function createSettlementMessage(childId, terminal) {
	const summary = settlementSummary(childId, terminal.stopReason);
	return createUserMessage({
		content: [{
			type: "text",
			text: summary
		}, ...terminal.output === void 0 ? [{
			type: "text",
			text: "It left no closing message."
		}] : [{
			type: "text",
			text: "Its closing message:"
		}, ...terminal.output]],
		source: {
			kind: "subagent-settled",
			form: "notice",
			summary: boundContextSummary(summary),
			senderSessionId: childId
		}
	});
}
/** Select a child epoch's ending from its accepted-work accounting.
* @param work - the shared consumed-work fold of this epoch's own durable suffix.
* @returns the recorded ending, including accepted work dropped before it ran.
*/
function subagentEpochStopReason(work) {
	const { end, droppedUnrun } = work;
	switch (end?.data.reason.kind) {
		case "max-tokens": return "max-tokens";
		case "aborted":
		case "interrupted": return "aborted";
		case "error": return "error";
		case "blocked": return "refusal";
		case void 0:
		case "completed": return droppedUnrun ? "aborted" : "completed";
		/* v8 ignore next 3 -- `TurnEndReason` is merge-extensible, so this arm needs a
		* backend that adds a variant; treating an unnameable reason as success would
		* report failed work as completed. */
		default: return "error";
	}
}
//#endregion
//#region ../../core/session/src/types.ts
/**
* Admit a numeric value as an existing Session event position.
* @param value - non-negative safe integer admitted by the owning log operation.
* @returns the same number with the Session-sequence brand.
*/
function SessionSeq(value) {
	if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) throw new TypeError(`SessionSeq must be a non-negative safe integer, got ${String(value)}`);
	return brandNumber(value);
}
/**
* Admit a numeric value as a Session log offset.
* @param value - non-negative safe integer used as a gap or prefix length.
* @returns the same number with the Session-log-offset brand.
*/
function SessionLogOffset(value) {
	if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) throw new TypeError(`SessionLogOffset must be a non-negative safe integer, got ${String(value)}`);
	return brandNumber(value);
}
//#endregion
//#region ../subagent/src/types.ts
/**
* Brand a string as a {@link SubagentRunId}.
* @param id - the raw run id.
* @returns the same string, branded.
*/
function SubagentRunId(id) {
	return id;
}
//#endregion
//#region ../subagent/src/lifecycle.ts
/**
* Lifecycle-edge publication for both subagent shapes: the contained emitter,
* the one-shot run observer, and the continuable Activation observer.
*
* The public payload contracts ({@link SubagentRunInfo},
* {@link SubagentRunEndInfo}) live in `./types.ts` with the rest of the seam's
* consumer-facing types; this module owns only the implementation and the
* package-private {@link ActivationObserver} the continuation manager consumes.
* Keeping the internal control interface out of the published surface is
* deliberate: the observer's `start`/`capture`/`settle` ordering is a contract
* between this module and one in-package caller, not something a plugin may
* depend on.
*
* @module @deepseek-ai/dsh-subagent/lifecycle
*/
/**
* Build the contained lifecycle emitter this seam publishes every edge through.
* Every listener is independently contained: a synchronous throw or a rejected
* returned promise is logged without starving peer listeners, changing the run,
* or — for provider removal, which fires from a disposer — breaking teardown.
* @param ctx - the service's own context, owning dispatch and the logger.
* @param carrier - resolve the scoped dispatch carrier for one delegating parent.
* @returns the emitter both observers and the provider registry publish through.
*/
function createLifecycleEmitter(ctx, carrier) {
	return (name, info, parent) => {
		const dispatchArgs = parent === void 0 ? [name, info] : [
			carrier(parent),
			name,
			info
		];
		for (const callback of ctx.events.dispatch("emit", dispatchArgs)) try {
			const returned = callback(info);
			Promise.resolve(returned).catch((error) => {
				ctx.logger.warn(`subagent: ${name} listener rejected: ${renderThrown(error)}`);
			});
		} catch (error) {
			ctx.logger.warn(`subagent: ${name} listener threw: ${renderThrown(error)}`);
		}
	};
}
/**
* Emit the start/end lifecycle pair for one accepted one-shot run.
* @param emit - the contained lifecycle emitter.
* @param provider - the provider that established the run.
* @param parent - the delegating parent keying scoped dispatch.
* @param run - the published run whose settlement closes the pair.
* @returns the same run, unchanged.
*/
function observeRun(emit, provider, parent, run) {
	const identity = {
		runId: SubagentRunId(randomUUID()),
		provider,
		id: run.id,
		local: run.localAgent !== void 0
	};
	run.result.then((result) => {
		emit("subagent/end", {
			...identity,
			stopReason: result.stopReason,
			...result.output.length === 0 ? {} : { lastAssistantMessage: result.output }
		}, parent);
	}, () => {
		emit("subagent/end", {
			...identity,
			stopReason: "error"
		}, parent);
	});
	emit("subagent/start", identity, parent);
	return run;
}
/**
* Build the observer for one continuable Activation's residency epoch. Observers
* see the same vocabulary as a one-shot run, so a child's start and settlement
* remain observable without exposing whether the manager materialized, woke, or
* cold-resumed it. Creation failure before residency emits no lifecycle edge.
* @param emit - the contained lifecycle emitter.
* @param provider - the provider name recorded in the durable descriptor.
* @param childId - the durable child session id.
* @param parent - the exact live direct parent keying scoped dispatch.
* @returns the observer whose edges this epoch publishes.
*/
function createActivationObserver(emit, provider, childId, parent) {
	const identity = {
		runId: SubagentRunId(randomUUID()),
		provider,
		id: childId,
		local: true
	};
	let boundary = SessionLogOffset(0);
	let captured = { stopReason: "completed" };
	const terminal = (failure) => failure === void 0 ? captured : { stopReason: "error" };
	return {
		start: (child) => {
			boundary = child.session.seq;
			emit("subagent/start", identity, parent);
		},
		capture: (child) => {
			const own = child.session.snapshotEvents(boundary);
			const output = finalAssistantOutput(own);
			captured = {
				stopReason: epochStopReason(own),
				...output === void 0 ? {} : { output }
			};
		},
		terminal,
		settle: (failure) => {
			const { stopReason, output } = terminal(failure);
			emit("subagent/end", {
				...identity,
				stopReason,
				...output === void 0 ? {} : { lastAssistantMessage: output }
			}, parent);
		}
	};
}
/**
* Why this child's epoch ended, for the terminal lifecycle edge and the
* manager's own parent delivery. The child's own log is authoritative:
* teardown succeeding says nothing about whether the model errored, hit its
* token ceiling, or was cancelled, so deriving the reason from disposal would
* report failed work as completed.
*
* {@link foldConsumedWork} supplies both halves the raw turn sequence cannot:
* which turn accounts for the work this epoch consumed, and whether accepted
* work was cancelled after it without any turn opening over it. A recorded
* failure still wins over a cancellation — stopping a child that had already
* failed does not turn its failure into a cancellation.
* @param events - this epoch's own event suffix.
* @returns its terminal stop reason; `completed` only for an epoch that both
*   closed cleanly and had nothing left to run.
*/
function epochStopReason(events) {
	return subagentEpochStopReason(foldConsumedWork(events));
}
/** Render any listener-thrown value without letting coercion escape containment. */
function renderThrown(value) {
	try {
		return value instanceof Error ? `${value.name}: ${value.message}` : String(value);
	} catch {
		return "<unrenderable thrown value>";
	}
}
//#endregion
//#region ../subagent/src/child-agent.ts
/**
* Shared in-process child composition: the delegation-depth budget, the
* durable session metadata, the resolved child `AgentOptions`, the delegated
* policy seed, and the scoped setup a child agent needs. Both the one-shot
* provider driver and the continuation manager compose children this way, so
* depth accounting, lineage stamping, and delegation policy have one home.
*
* @module @deepseek-ai/dsh-subagent/child-agent
*/
/** Thrown when starting a child would exceed the requested depth cap. */
var SubagentDepthError = class extends Error {
	attemptedDepth;
	maxDepth;
	constructor(attemptedDepth, maxDepth) {
		super(`subagent depth ${attemptedDepth} exceeds maxDepth ${maxDepth}`);
		this.attemptedDepth = attemptedDepth;
		this.maxDepth = maxDepth;
		this.name = "SubagentDepthError";
	}
};
/**
* Resolve the child's delegation depth from its parent and enforce an optional
* cap. The persisted parent header is the monotone floor, so a resumed parent
* cannot delegate as if it were top-level.
* @param parent - the delegating parent agent.
* @param maxDepth - optional absolute cap the resolved depth must not exceed.
* @returns the child's non-negative safe-integer depth.
* @throws {SubagentDepthError} when the resolved depth exceeds `maxDepth`.
* @throws {RangeError} when the resolved depth leaves the safe-integer range.
*/
function resolveChildDepth(parent, maxDepth) {
	const childDepth = delegationDepthOf(parent) + 1;
	if (!Number.isSafeInteger(childDepth)) throw new RangeError("subagent child depth exceeds the safe-integer range");
	if (maxDepth !== void 0 && childDepth > maxDepth) throw new SubagentDepthError(childDepth, maxDepth);
	return childDepth;
}
/**
* Resolve the parent values inherited by a child. The latest request header
* owns provider, model, and reasoning effort after request-time selection;
* creation options remain the fallback before the first request and retain
* the configured output-token limit.
* @param parent - delegating parent Agent.
* @returns detached Agent options for child-option merging.
*/
function parentAgentOptionsForDelegation(parent) {
	const requestConfig = parent.session.requestHeader()?.config;
	if (requestConfig === void 0) return { ...parent.options };
	const { provider: _createdProvider, model: _createdModel, reasoningEffort: _createdReasoningEffort, ...createdOptions } = parent.options;
	return {
		...createdOptions,
		provider: requestConfig.provider,
		model: requestConfig.model,
		...requestConfig.reasoningEffort === void 0 ? {} : { reasoningEffort: requestConfig.reasoningEffort }
	};
}
/**
* Resolve the child's `AgentOptions`: the parent's provider/model,
* reasoning-effort, and maxTokens values unless the request overrides them,
* stamped with the child's own delegation depth. Changing the route without
* naming an effort clears the parent's route-owned effort so the selected
* model resolves its own default.
* @param parent - the delegating parent whose route the child inherits.
* @param requested - per-child overrides, if any.
* @param childDepth - the resolved delegation depth to stamp.
* @returns the resolved options for `ctx.agents.create()`.
*/
function resolveChildAgentOptions(parent, requested, childDepth) {
	const parentOptions = parentAgentOptionsForDelegation(parent);
	const parentProvider = parentOptions.provider;
	const parentModel = parentOptions.model;
	const parentReasoningEffort = parentOptions.reasoningEffort;
	const parentMaxTokens = parentOptions.maxTokens;
	const resolved = {
		...parentProvider !== void 0 ? { provider: parentProvider } : {},
		...parentModel !== void 0 ? { model: parentModel } : {},
		...parentReasoningEffort !== void 0 ? { reasoningEffort: parentReasoningEffort } : {},
		...parentMaxTokens !== void 0 ? { maxTokens: parentMaxTokens } : {},
		...requested,
		subagentDepth: childDepth
	};
	if ((resolved.provider !== parentProvider || resolved.model !== parentModel) && requested?.reasoningEffort === void 0) delete resolved.reasoningEffort;
	return resolved;
}
/**
* Build the child session's durable creation metadata: the parent's workspace,
* its direct lineage, coarse product origin, the recursion budget that must
* survive persistence, the seed boundary that separates inherited parent
* history from child work, and the composition the child runs under.
*
* The preset is read from the parent's LIVE scope chain rather than from its
* header, because a parent that switched preset while blank runs on the newer
* composition and its header still names the older one. Recording it is what
* makes a child's history reconstructable: without it a cold read of the child
* resolves the deployment default and rebuilds turns under a tool set the
* child never had.
* @param parent - the delegating parent agent.
* @param childDepth - the resolved delegation depth to persist.
* @param isSeeded - whether this child inherits a parent-log prefix, including an explicitly empty one.
* @returns the `meta` for `ctx.agents.create()`.
*/
function childSessionMeta(parent, childDepth, isSeeded) {
	const parentHeader = parent.session.header;
	const agentPreset = parent.ctx.get("agentPresets")?.composedPreset(parent.ctx);
	return {
		...parentHeader.cwd !== void 0 ? { cwd: parentHeader.cwd } : {},
		...agentPreset === void 0 ? {} : { agentPreset },
		parentSession: parentHeader.id,
		isSeeded,
		origin: "subagent",
		delegationDepth: childDepth
	};
}
/**
* Compose one child inside its creation window: join its parent's preset,
* register the fixed delegation-scope statement, then apply the child's own
* shadowing persona section and tool restriction, all owned by the child's
* scope and therefore invisible to its parent and siblings. Creation and cold
* resume both pass through here.
*
* The join comes first and the child's own registrations second, which is the
* order the layering already implies — the nearest scope wins a name, and a
* per-child restriction intersects with everything its chain admits — but
* stating it here keeps the two steps from being read as independent.
*
* The join and the per-child registrations live in ONE call because a child
* composed without the join is exactly the defect this function exists to
* prevent: with every model-facing row on the agent plane, a child that joins
* no preset sees an empty tool registry and none of its parent's prompt
* sections. Taking the parent as a parameter is what makes that omission
* unrepresentable at the call sites.
* @param childCtx - the child agent's scoped creation context.
* @param parent - the delegating parent whose composition the child joins.
* @param composition - the per-child persona and tool filter to install.
*/
function applyChildComposition(childCtx, parent, composition) {
	childCtx.get("agentPresets")?.composeFrom(childCtx, parent.ctx);
	childCtx.systemPrompt.context({
		name: "subagent:delegation",
		order: childCtx.systemPrompt.getContextOrder("SUBAGENT_DELEGATION"),
		text: SUBAGENT_DELEGATION_CONTEXT
	});
	if (composition.persona !== void 0) childCtx.systemPrompt.section({
		name: "deployment:persona-prefix",
		order: childCtx.systemPrompt.getSectionOrder("DEPLOYMENT_PERSONA_PREFIX"),
		text: composition.persona
	});
	if (composition.toolFilter !== void 0) childCtx.tools.restrict(composition.toolFilter);
}
/**
* Capture the policy to seed into one delegation. Call synchronously before
* the child start's first await: a later parent switch belongs to the
* parent's future, not to this child. Only the parent session's explicit
* sandbox override is captured — never deployment defaults or one-shot
* grants — and the approval policy is pinned to `'never'` regardless of the
* parent's own policy.
* @param parent - the delegating parent agent.
* @returns the sandbox override (or `undefined` without one) and the approval pin.
*/
function captureDelegatedPolicyOverrides(parent) {
	return {
		sandboxMode: parent.ctx.get("sandboxPolicy")?.overrideOf(parent.session),
		approvalPolicy: parent.ctx.get("approval") === void 0 ? void 0 : "never"
	};
}
/**
* Append the captured delegation policy onto the child's own log as
* `source: 'delegation'` events inside the unpublished creation window, so the
* child's effective policy is reconstructable from its log alone. Appends land
* after any fork seed, so fresh policy wins stale seed state; later child
* switches still win over these events.
* @param childSession - the unpublished child's session.
* @param overrides - the policy captured at delegation.
*/
function appendDelegatedPolicyOverrides(childSession, overrides) {
	if (overrides.sandboxMode !== void 0) childSession.append("sandbox/mode", {
		mode: overrides.sandboxMode,
		source: "delegation"
	});
	if (overrides.approvalPolicy !== void 0) childSession.append("approval/policy", {
		policy: overrides.approvalPolicy,
		source: "delegation"
	});
}
//#endregion
//#region ../subagent/src/continuation-messages.ts
/**
* Model-visible messages owned by continuable-subagent orchestration.
*
* @module @deepseek-ai/dsh-subagent/continuation-messages
*/
/**
* Build the model-visible and durable representation of one adjacent-Agent message.
* @param sender - exact live Agent that authored the message.
* @param content - model-visible message blocks supplied by the sender.
* @returns the durable user-message representation delivered to the recipient.
*/
function createAgentMessage(sender, content) {
	return createAdjacentAgentMessage(sender.id, content);
}
//#endregion
//#region ../subagent/src/inbox.ts
/** Delegate Queue and Steer to one live Agent until its Activation starts closing. */
var SubagentInbox = class {
	agent;
	closingPromise;
	/**
	* Wrap one live continuable Agent.
	* @param agent - the Agent whose inbox receives accepted deliveries.
	*/
	constructor(agent) {
		this.agent = agent;
	}
	/**
	* Read the Activation's close transaction.
	* @returns the memoized transaction, or `undefined` while delivery remains open.
	*/
	get closing() {
		return this.closingPromise;
	}
	/**
	* Read whether the underlying Agent still has accepted work to claim.
	* @returns whether either Agent inbox destination is non-empty.
	*/
	get hasPending() {
		return this.agent.inbox.nextTurn.length > 0 || this.agent.inbox.nextStep.length > 0;
	}
	/**
	* Submit through the Agent only while its Activation remains resident.
	* @param message - the accepted input to submit.
	* @param delivery - whether to queue a distinct turn or steer the nearest step.
	*/
	deliver(message, delivery) {
		if (this.closingPromise !== void 0) throw new SubagentError(`subagent "${this.agent.id}" activation is being disposed; the message was not accepted`, "ACTIVATION_CLOSING");
		if (delivery === "steer") this.agent.steer(message);
		else this.agent.followup(message);
	}
	/**
	* Close delivery synchronously and share one asynchronous release.
	* @param release - the one release operation to start after closing admission.
	* @returns the memoized release transaction.
	*/
	close(release) {
		const existing = this.closingPromise;
		if (existing !== void 0) return existing;
		const completion = Promise.withResolvers();
		this.closingPromise = completion.promise;
		release().then(completion.resolve, completion.reject);
		return completion.promise;
	}
};
//#endregion
//#region ../subagent/src/continuation-activation.ts
/** Serialize each durable child's delivery, release, and disposal. */
var ChildLock = class {
	tails = /* @__PURE__ */ new Map();
	/**
	* Run `operation` after every previously queued operation for `childId`.
	* @param childId - the durable child whose operations are linearized.
	* @param operation - the critical section to run in order.
	* @returns the operation's own settlement.
	*/
	run(childId, operation) {
		const result = (this.tails.get(childId) ?? Promise.resolve()).then(operation, operation);
		const tail = result.then(() => void 0, () => void 0);
		this.tails.set(childId, tail);
		tail.then(() => {
			if (this.tails.get(childId) === tail) this.tails.delete(childId);
		});
		return result;
	}
};
/** Own the complete process-local lifetime of continuable child Activations. */
var ContinuableActivationRegistry = class {
	ctx;
	observeActivation;
	/** Child session id → its live Activation. Process-local, never durable. */
	resident = /* @__PURE__ */ new Map();
	/** Materializations admitted before drain, tracked through publication or rollback. */
	materializations = /* @__PURE__ */ new Set();
	/** Per-child serializer shared by delivery, release, and disposal. */
	locks = new ChildLock();
	/** Structural Cordis owner of every Activation handle. */
	ownerCtx;
	/**
	* Exact roots whose host teardown has begun, with the live lineage members
	* observed under each root. Entries remain until that exact root leaves the
	* Agent registry, closing admission throughout its host's teardown without
	* poisoning a later same-id replacement.
	*/
	closingScopes = /* @__PURE__ */ new Map();
	draining = false;
	/**
	* Build one registry inside the service's Agent-injected context.
	* @param ctx - context providing Agents, Sessions, and teardown ownership.
	* @param observeActivation - build the lifecycle observer for one residency epoch.
	*/
	constructor(ctx, observeActivation) {
		this.ctx = ctx;
		this.observeActivation = observeActivation;
		const scope = ctx.plugin(function activationOwner() {});
		this.ownerCtx = scope.ctx;
		ctx.on("agent/disposed", ({ agent }) => {
			this.closingScopes.delete(agent);
		});
		ctx.effect(function* () {
			yield scope.dispose;
			yield () => this.drain();
		}.bind(this), "subagents.continuations()");
	}
	/**
	* Return the live Activation for a durable child id, if resident.
	* @param childId - durable child session id to look up.
	* @returns the process-local Activation, or `undefined` when it is not resident.
	*/
	get(childId) {
		return this.resident.get(childId);
	}
	/**
	* Reject one child identity already owned by a live Agent or Session.
	* @param childId - proposed durable child session id.
	*/
	assertChildIdAvailable(childId) {
		if (this.ctx.agents.get(childId) !== void 0 || this.ctx.get("sessions")?.get(childId) !== void 0) throw new SubagentError(`subagent "${childId}" already exists`, "DUPLICATE_CHILD");
	}
	/**
	* Pre-register `childId` in a continuation-managed parent's owned set so the
	* parent cannot settle while a caller is still establishing or resuming that
	* child. Returns a releaser for the failure path; it removes only a hold
	* this call added, and leaves ownership in place once a live Activation for
	* the child exists.
	* @param parent - the live direct parent the operation is admitted under.
	* @param childId - the durable child the operation addresses.
	* @returns the failure-path releaser; a no-op when nothing was added.
	*/
	holdOwnership(parent, childId) {
		const parentActivation = this.resident.get(parent.id);
		if (parentActivation === void 0 || parentActivation.handle.agent !== parent) return () => {};
		if (parentActivation.inbox.closing !== void 0) throw new SubagentError(`subagent parent "${parent.id}" is being disposed; the child was not established`, "ACTIVATION_CLOSING");
		if (parentActivation.ownedChildren.has(childId)) return () => {};
		parentActivation.ownedChildren.add(childId);
		return () => {
			const live = this.resident.get(childId);
			/* v8 ignore next 4 -- reaching this arm needs another delivery to establish the child
			* between this operation's failure and its releaser running, which no test can schedule
			* deterministically: the ownership edge then belongs to that live Activation, so the
			* conservative keep leaves it for finishDisposal's releaseOwnership. */
			if (live !== void 0 && live.inbox.closing === void 0) return;
			if (parentActivation.ownedChildren.delete(childId)) this.wake(parentActivation);
		};
	}
	/**
	* Interrupt one live continuable child's current turn under the supplied authority.
	* @param targetSessionId - the durable child session id to interrupt.
	* @param authority - the human parent address or exact live ancestor Agent.
	*/
	interrupt(targetSessionId, authority) {
		if (authority.kind === "ancestor") {
			const caller = authority.agent;
			if (this.ctx.agents.get(caller.id) !== caller) throw new SubagentError(`interrupting "${targetSessionId}" requires the exact live ancestor agent`, "UNAUTHORIZED");
			if (caller.id === targetSessionId) throw new SubagentError(`agent "${caller.id}" cannot interrupt itself`, "UNAUTHORIZED");
		}
		const activation = this.resident.get(targetSessionId);
		if (activation === void 0) return;
		if (authority.kind === "user") {
			if (activation.handle.agent.session.header.parentSession !== authority.parentSessionId) throw new SubagentError(`subagent "${targetSessionId}" belongs to another parent session`, "UNAUTHORIZED");
		} else if (!activation.ancestry.has(authority.agent)) throw new SubagentError(`subagent "${targetSessionId}" is not a live descendant of agent "${authority.agent.id}"`, "UNAUTHORIZED");
		if (activation.inbox.closing !== void 0) return;
		activation.handle.agent.cancel(authority.kind === "user" ? { kind: "user" } : { kind: "parent" }, { keepInbox: true });
	}
	/**
	* Send through a receiving parent's Activation inbox when it has one.
	* @param parent - exact live Agent receiving the message.
	* @param message - durable user message to deliver.
	* @param delivery - receiving inbox destination.
	*/
	sendWaking(parent, message, delivery) {
		const parentActivation = this.resident.get(parent.id);
		if (parentActivation !== void 0 && parentActivation.handle.agent === parent) {
			try {
				parentActivation.inbox.deliver(message, delivery);
			} finally {
				this.wake(parentActivation);
			}
			return;
		}
		if (delivery === "steer") parent.steer(message);
		else parent.followup(message);
	}
	/**
	* Close admission, await every already-admitted materialization through
	* publication or rollback, then dispose the stable live Activation graph
	* child-first.
	*/
	async drain() {
		this.draining = true;
		await Promise.all([...this.materializations].map((materialization) => materialization.settled));
		const owned = /* @__PURE__ */ new Set();
		for (const activation of this.resident.values()) for (const child of activation.ownedChildren) owned.add(child);
		const roots = [...this.resident.values()].filter((activation) => !owned.has(activation.childId));
		await this.disposeRoots(roots, "activation(s)");
	}
	/**
	* Stop only the continuable descendants of exact live host-owned parents.
	* @param parents - exact live roots whose continuable descendants must stop.
	*/
	async drainDescendants(parents) {
		const roots = new Set(parents.filter((parent) => this.ctx.agents.get(parent.id) === parent));
		if (roots.size === 0) return;
		for (const root of roots) this.closingMembers(root).add(root);
		const targets = [];
		for (const activation of this.resident.values()) {
			const lineage = this.liveLineage(activation.handle.agent);
			const owners = [...roots].filter((root) => activation.handle.agent !== root && activation.ancestry.has(root));
			if (owners.length === 0) continue;
			targets.push(activation);
			for (const owner of owners) {
				const members = this.closingMembers(owner);
				members.add(activation.handle.agent);
				for (const agent of lineage) members.add(agent);
			}
		}
		const materializations = [...this.materializations].filter((materialization) => {
			const owners = [...roots].filter((root) => materialization.lineage.includes(root));
			for (const owner of owners) {
				const members = this.closingMembers(owner);
				for (const agent of materialization.lineage) members.add(agent);
			}
			return owners.length > 0;
		});
		const ownedTargets = /* @__PURE__ */ new Set();
		for (const activation of targets) for (const child of activation.ownedChildren) ownedTargets.add(child);
		const targetRoots = targets.filter((activation) => !ownedTargets.has(activation.childId));
		for (const activation of targets) this.dispose(activation).catch(() => void 0);
		await Promise.all(materializations.map((materialization) => materialization.settled));
		await this.disposeRoots(targetRoots, "scoped activation(s)");
	}
	/**
	* Release selected resident direct children of one exact live parent.
	* @param parent - exact live direct parent authorizing the selected release.
	* @param childIds - durable direct-child ids to release when resident.
	*/
	async drainChildren(parent, childIds) {
		if (this.ctx.agents.get(parent.id) !== parent) throw new SubagentError("selected child teardown requires the exact live parent agent", "UNAUTHORIZED");
		const targets = [];
		for (const childId of new Set(childIds)) {
			const activation = this.resident.get(childId);
			if (activation === void 0) continue;
			if (activation.parentSession !== parent.id || !activation.ancestry.has(parent)) throw new SubagentError(`subagent "${childId}" is not a direct child of agent "${parent.id}"`, "UNAUTHORIZED");
			targets.push(activation);
		}
		for (const activation of targets) this.dispose(activation).catch(() => void 0);
		await this.disposeRoots(targets, "selected activation(s)");
	}
	/**
	* Reject new admission once the registry or this exact parent tree began draining.
	* @param agent - exact live Agent whose lineage determines admission.
	*/
	assertAdmitting(agent) {
		const closing = this.closingTeardownFor(agent);
		if (closing === void 0) return;
		throw new SubagentError(closing === "manager" ? "continuable subagents are draining; the operation was not admitted" : `continuable subagents below parent "${closing.id}" are draining; the operation was not admitted`, "DRAINING");
	}
	/**
	* Authorize one operation against the durable direct-parent lineage.
	* @param parent - exact live Agent claiming direct-parent authority.
	* @param childId - durable child session id addressed by the operation.
	* @param parentSession - durable direct-parent id recorded by the child.
	*/
	authorizeLineage(parent, childId, parentSession) {
		if (this.ctx.agents.get(parent.id) !== parent) throw new SubagentError(`subagent "${childId}" delivery requires the exact live parent agent`, "UNAUTHORIZED");
		if (parentSession !== parent.id) throw new SubagentError(`subagent "${childId}" belongs to another parent session`, "UNAUTHORIZED");
	}
	/**
	* Create or resume one child Agent and publish its Activation.
	* @param inputs - reconstruction and admission inputs for the residency epoch.
	* @returns the published process-local Activation.
	*/
	materialize(inputs) {
		this.assertAdmitting(inputs.parent);
		const settled = Promise.withResolvers();
		const lineage = this.liveLineage(inputs.parent);
		const materialization = {
			lineage,
			settled: settled.promise
		};
		this.materializations.add(materialization);
		return this.materializeTracked(inputs, lineage).finally(() => {
			this.materializations.delete(materialization);
			settled.resolve();
		});
	}
	/**
	* Cross the final admission cutoff and submit without yielding.
	* @param activation - the exact resident child receiving the message.
	* @param message - the already-built durable user message.
	* @param delivery - the Agent inbox destination.
	* @param parent - exact live direct parent authorizing admission.
	* @param signal - caller cancellation before inbox acceptance.
	* @returns the accepted durable message id.
	*/
	submitAdmitted(activation, message, delivery, parent, signal) {
		signal.throwIfAborted();
		this.assertAdmitting(parent);
		this.authorizeLineage(parent, activation.childId, activation.handle.agent.session.header.parentSession);
		this.acquireOwnership(parent, activation.childId);
		try {
			activation.inbox.deliver(message, delivery);
		} finally {
			this.wake(activation);
		}
		return message.id;
	}
	/**
	* Stop and release one Activation through its memoized close transaction.
	* @param activation - exact residency epoch to close.
	* @param finalStateFlushed - whether natural settlement already flushed final state.
	* @returns the shared close transaction.
	*/
	dispose(activation, finalStateFlushed = false) {
		return activation.inbox.close(() => this.finishDisposal(activation, finalStateFlushed));
	}
	/** Dispose independent roots and report every branch failure after all settle. */
	async disposeRoots(roots, failureSubject) {
		const reasons = (await Promise.all(roots.map(async (activation) => {
			try {
				await this.dispose(activation);
				return;
			} catch (error) {
				return error;
			}
		}))).filter((failure) => failure !== void 0);
		if (reasons.length > 0) throw new SubagentError(`continuable subagent teardown failed for ${reasons.length} ${failureSubject}: ` + reasons.map((reason) => errorChain(reason)).join("; "), "ACTIVATION_TEARDOWN_FAILED");
	}
	/** Return the retained member set for one exact scoped-teardown root. */
	closingMembers(root) {
		const existing = this.closingScopes.get(root);
		if (existing !== void 0) return existing;
		const members = /* @__PURE__ */ new Set();
		this.closingScopes.set(root, members);
		return members;
	}
	/** Return the exact currently resolvable ancestry from `agent` upward. */
	liveLineage(agent) {
		const lineage = [agent];
		const seen = new Set([agent.id]);
		let parentSession = agent.session.header.parentSession;
		while (parentSession !== void 0) {
			const parent = this.ctx.agents.get(parentSession);
			if (parent === void 0 || seen.has(parent.id)) break;
			lineage.push(parent);
			seen.add(parent.id);
			parentSession = parent.session.header.parentSession;
		}
		return lineage;
	}
	/** Return the teardown that closed continuable admission for this agent's lineage. */
	closingTeardownFor(agent) {
		if (this.draining) return "manager";
		const lineage = this.liveLineage(agent);
		for (const [root, members] of this.closingScopes) if (members.has(agent) || lineage.includes(root)) return root;
	}
	/** Perform one tracked materialization through publication or rollback. */
	async materializeTracked(inputs, parentLineage) {
		const { childId, provider, parent, create } = inputs;
		inputs.signal.throwIfAborted();
		const setup = (childCtx, child) => {
			if (create !== void 0) {
				child.session.append("subagent/descriptor", create.descriptor);
				appendDelegatedPolicyOverrides(child.session, create.delegatedPolicies);
			}
			applyChildComposition(childCtx, parent, inputs.composition);
		};
		const observer = this.observeActivation(provider, childId, parent);
		const handle = create === void 0 ? await this.ownerCtx.agents.resume({
			resumeSessionId: childId,
			parentAgent: parent,
			agentOptions: inputs.agentOptions,
			signal: inputs.signal,
			setup
		}) : await this.ownerCtx.agents.create({
			sessionId: childId,
			parentAgent: parent,
			meta: create.meta,
			...create.seed === void 0 ? {} : { seed: create.seed },
			inheritedEventCount: create.inheritedEventCount,
			agentOptions: inputs.agentOptions,
			signal: inputs.signal,
			setup
		});
		const activation = {
			childId,
			parentSession: parent.id,
			provider,
			handle,
			inbox: new SubagentInbox(handle.agent),
			ancestry: new WeakSet([handle.agent, ...parentLineage]),
			ownedChildren: /* @__PURE__ */ new Set(),
			observer,
			announced: false,
			poke: Promise.withResolvers()
		};
		this.resident.set(childId, activation);
		try {
			inputs.signal.throwIfAborted();
			this.assertAdmitting(parent);
			this.acquireOwnership(parent, childId);
			const wakeOnInboxRemoval = () => {
				this.wake(activation);
			};
			handle.agent.ctx.on("agent/inbox/claimed", wakeOnInboxRemoval);
			handle.agent.ctx.on("agent/inbox/discarded", wakeOnInboxRemoval);
			observer.start(handle.agent);
		} catch (error) {
			/* v8 ignore next -- rollback failure must not mask the admission failure
			* that prevented this operation from returning an accepted message id. */
			await this.rollbackUnpublished(activation).catch(() => void 0);
			throw error;
		}
		this.watchSettlement(activation);
		return activation;
	}
	/** Release an Activation whose start edge was not published. */
	rollbackUnpublished(activation) {
		return activation.inbox.close(async () => {
			try {
				await activation.handle.dispose();
			} finally {
				this.resident.delete(activation.childId);
				this.releaseOwnership(activation.childId);
			}
		});
	}
	/** Register the child in a continuation-managed parent's owned set. */
	acquireOwnership(parent, childId) {
		const parentActivation = this.resident.get(parent.id);
		if (parentActivation === void 0) return;
		if (parentActivation.inbox.closing !== void 0) throw new SubagentError(`subagent parent "${parent.id}" is being disposed; the child was not established`, "ACTIVATION_CLOSING");
		parentActivation.ownedChildren.add(childId);
	}
	/** Remove one child from its live owner's set and let that owner re-check settlement. */
	releaseOwnership(childId) {
		for (const candidate of this.resident.values()) if (candidate.ownedChildren.delete(childId)) this.wake(candidate);
	}
	/** Let a settlement watcher re-check residency after relevant state changes. */
	wake(activation) {
		activation.poke.resolve();
		activation.poke = Promise.withResolvers();
	}
	/** Follow one Activation to natural settlement. */
	watchSettlement(activation) {
		(async () => {
			while (true) {
				const idleObservation = activation.poke;
				await activation.handle.agent.whenIdle();
				if (activation.inbox.closing !== void 0) return;
				const readiness = await this.locks.run(activation.childId, () => Promise.resolve(this.settlementState(activation, idleObservation)));
				if (readiness === "closed") return;
				if (readiness === "retry") continue;
				if (readiness === "wait") {
					await idleObservation.promise;
					continue;
				}
				const finalSeq = activation.handle.agent.session.seq;
				await this.flushFinalState(activation);
				const attempt = await this.locks.run(activation.childId, () => {
					const state = this.settlementState(activation, idleObservation);
					if (state !== "ready") return Promise.resolve(state);
					if (activation.handle.agent.session.seq !== finalSeq) return Promise.resolve("retry");
					let done;
					try {
						activation.handle.agent.runMaintenance(() => {
							done = this.dispose(activation, true);
							return Promise.resolve();
						});
					} catch {
						return Promise.resolve("retry");
					}
					return Promise.resolve({ done });
				});
				if (attempt === "closed") return;
				if (attempt === "retry") continue;
				if (attempt === "wait") {
					await idleObservation.promise;
					continue;
				}
				try {
					await attempt.done;
				} catch (error) {
					this.ctx.logger.warn(`subagent "${activation.childId}" activation teardown failed: ${errorChain(error)}`);
				}
				return;
			}
		})();
	}
	/** Classify one Inbox and owned-child observation without reading Agent execution state. */
	settlementState(activation, observation) {
		if (activation.inbox.closing !== void 0) return "closed";
		if (activation.poke !== observation) return "retry";
		if (activation.inbox.hasPending || activation.ownedChildren.size > 0) return "wait";
		return "ready";
	}
	/** Propagate stop synchronously, then finish the child-first release. */
	async finishDisposal(activation, finalStateFlushed) {
		this.wake(activation);
		const { childId } = activation;
		const failures = [];
		if (finalStateFlushed) try {
			activation.observer.capture(activation.handle.agent);
		} catch (error) {
			failures.push(new SubagentError(`subagent "${childId}" activation teardown failed: ${errorChain(error)}`, "ACTIVATION_TEARDOWN_FAILED", { cause: error }));
		}
		else {
			activation.handle.agent.cancel({ kind: "parent" });
			const idle = activation.handle.agent.whenIdle();
			const childDisposals = [...activation.ownedChildren].map((child) => this.resident.get(child)).filter((child) => child !== void 0).map((child) => this.dispose(child));
			try {
				const reasons = (await Promise.all(childDisposals.map(async (disposal) => {
					try {
						await disposal;
						return;
					} catch (error) {
						return error;
					}
				}))).filter((reason) => reason !== void 0);
				if (reasons.length > 0) failures.push(new SubagentError(`subagent "${childId}" child teardown failed: ${reasons.map((reason) => errorChain(reason)).join("; ")}`, "ACTIVATION_TEARDOWN_FAILED"));
				await idle;
				await this.flushFinalState(activation);
				activation.observer.capture(activation.handle.agent);
			} catch (error) {
				failures.push(new SubagentError(`subagent "${childId}" activation teardown failed: ${errorChain(error)}`, "ACTIVATION_TEARDOWN_FAILED", { cause: error }));
			}
		}
		try {
			await activation.handle.dispose();
		} catch (error) {
			failures.push(new SubagentError(`subagent "${childId}" activation handle disposal failed: ${errorChain(error)}`, "ACTIVATION_TEARDOWN_FAILED", { cause: error }));
		}
		let failure;
		if (failures.length === 1) failure = failures[0];
		else if (failures.length > 1) failure = new SubagentError(`subagent "${childId}" activation teardown failed at ${failures.length} boundaries: ` + failures.map((item) => errorChain(item)).join("; "), "ACTIVATION_TEARDOWN_FAILED", { cause: new AggregateError(failures) });
		this.resident.delete(childId);
		this.notifySettlement(activation, activation.observer.terminal(failure));
		this.releaseOwnership(childId);
		activation.observer.settle(failure);
		if (failure !== void 0) throw failure;
	}
	/** Tell the durable direct parent how this Activation ended. */
	notifySettlement(activation, terminal) {
		if (!activation.announced) return;
		try {
			const parent = this.ctx.agents.get(activation.parentSession);
			if (parent === void 0) return;
			const message = createSettlementMessage(activation.childId, terminal);
			if (this.closingTeardownFor(parent) !== void 0) {
				parent.inject(message);
				return;
			}
			this.sendWaking(parent, message, parent.status === "idle" ? "queue" : "steer");
		} catch (error) {
			this.ctx.logger.warn(`subagent "${activation.childId}" settlement notice was not delivered to its parent: ` + errorChain(error));
		}
	}
	/** Request a best-effort final session flush before closing natural-settlement admission. */
	async flushFinalState(activation) {
		const child = activation.handle.agent;
		try {
			await child.ctx.sessions.flush(child.session);
		} catch (error) {
			this.ctx.logger.warn(`subagent "${activation.childId}" best-effort final session flush failed; the persisted state may be unavailable or stale on resume: ${errorChain(error)}`);
		}
	}
};
//#endregion
//#region ../../../Core/util/chunked-list/src/index.ts
/**
* Persistent append-only lists with bounded copying and JSON checkpoint validation.
* @module @deepseek-ai/dsh-chunked-list
*/
const CHUNK_CAPACITY = 64;
/**
* Append without modifying the input, copying at most one 64-value chunk.
* @param head - current list, or `undefined` for an empty list.
* @param value - value to retain by reference.
* @returns new list sharing the unchanged older chunks.
*/
function appendChunkedList(head, value) {
	if (head === void 0 || head.values.length === CHUNK_CAPACITY) return {
		values: [value],
		...head === void 0 ? {} : { previous: head }
	};
	return {
		values: [...head.values, value],
		...head.previous === void 0 ? {} : { previous: head.previous }
	};
}
/**
* Visit all values in insertion order, with O(N) time and O(N / 64) scratch space.
* @param head - current list, or `undefined` for an empty list.
* @returns iterator yielding the stored values by reference, without truncation.
*/
function* iterateChunkedList(head) {
	const chunks = [];
	for (let chunk = head; chunk !== void 0; chunk = chunk.previous) chunks.push(chunk);
	for (const chunk of chunks.reverse()) yield* chunk.values;
}
/**
* Validate nonempty list checkpoints, including every stored value and chunk size.
* @param valueSchema - caller-owned validation for each stored value.
* @returns recursive Zod schema rejecting empty or oversized chunks and unknown fields.
*/
function chunkedListSchema(valueSchema) {
	const schema = lazy(() => object$1({
		values: array(valueSchema).min(1).max(CHUNK_CAPACITY),
		previous: schema.optional()
	}).strict());
	return schema;
}
const sessionIdSchema = string();
const oneShotCatalogSchema = object$1({
	version: literal(0),
	childId: sessionIdSchema,
	childCreatedAt: number().int().nonnegative(),
	mode: literal("one-shot"),
	label: string().optional()
}).strict();
const continuableCatalogSchema = object$1({
	version: literal(0),
	childId: sessionIdSchema,
	childCreatedAt: number().int().nonnegative(),
	mode: literal("continuable"),
	label: string()
}).strict();
const eventDataSchema = union([oneShotCatalogSchema, continuableCatalogSchema]);
const viewSchema = array(union([oneShotCatalogSchema.omit({
	version: true,
	childId: true,
	childCreatedAt: true
}).extend({
	id: sessionIdSchema,
	createdAt: oneShotCatalogSchema.shape.childCreatedAt
}), continuableCatalogSchema.omit({
	version: true,
	childId: true,
	childCreatedAt: true
}).extend({
	id: sessionIdSchema,
	createdAt: continuableCatalogSchema.shape.childCreatedAt
})]));
const stateSchema = object$1({
	inheritedEventCount: number().int().nonnegative(),
	head: chunkedListSchema(eventDataSchema).optional()
}).strict();
/**
* Materialize direct children from their parent's successful creation facts.
* @param state - parent catalog fold state.
* @returns current direct-child rows in parent catalog event order.
*/
function subagentCatalogEntries(state) {
	const entries = [];
	for (const data of iterateChunkedList(state.head)) entries.push(data.mode === "one-shot" ? {
		id: data.childId,
		createdAt: data.childCreatedAt,
		mode: data.mode,
		...data.label === void 0 ? {} : { label: data.label }
	} : {
		id: data.childId,
		createdAt: data.childCreatedAt,
		mode: data.mode,
		label: data.label
	});
	return entries;
}
/** Parent-owned direct-child catalog projection; invalid own facts reject restoration. */
const subagentCatalogProjectionDefinition = {
	key: "subagentCatalog",
	stateSchema,
	init: (_header, inheritedEventCount) => ({ inheritedEventCount }),
	apply: (state, event) => {
		if (event.type !== "subagent/catalog" || event.seq < state.inheritedEventCount) return state;
		return {
			...state,
			head: appendChunkedList(state.head, eventDataSchema.parse(event.data))
		};
	},
	stateVersion: 2,
	wire: {
		viewSchema,
		view: subagentCatalogEntries
	}
};
/**
* Append a complete direct-child discovery fact to its parent Session.
* @param parent - durable direct parent receiving the discovery fact.
* @param child - established child's immutable Session metadata.
* @param descriptor - mode-discriminated creation label frozen with the child.
*/
function establishCatalogChild(parent, child, descriptor) {
	parent.append("subagent/catalog", descriptor.mode === "one-shot" ? {
		version: 0,
		childId: child.id,
		childCreatedAt: child.createdAt,
		mode: descriptor.mode,
		...descriptor.label === void 0 ? {} : { label: descriptor.label }
	} : {
		version: 0,
		childId: child.id,
		childCreatedAt: child.createdAt,
		mode: descriptor.mode,
		label: descriptor.label
	});
}
//#endregion
//#region ../subagent/src/internal.ts
/** Process-stable identity carried only by the standard adjacent-Agent messaging tool. */
const adjacentAgentSendMessageTool = Symbol.for("dsh.subagent.adjacentAgentSendMessageTool");
/**
* Test whether one visible definition is the standard adjacent-Agent messaging tool.
* @param definition - the scope-resolved `send_message` candidate.
* @returns whether the definition carries the internal standard-tool identity.
*/
function isAdjacentAgentSendMessageTool(definition) {
	return definition !== void 0 && definition[adjacentAgentSendMessageTool] === true;
}
/**
* Process-stable symbol-keyed host delivery shared by the bundled runtime
* entry and this unbundled internal subpath.
* @internal
*/
const deliverSubagentPrompt = Symbol.for("dsh.subagent.deliverPrompt");
//#endregion
//#region \0@oxc-project+runtime@0.135.0/helpers/esm/usingCtx.js
function _usingCtx() {
	var r = "function" == typeof SuppressedError ? SuppressedError : function(r, e) {
		var n = Error();
		return n.name = "SuppressedError", n.error = r, n.suppressed = e, n;
	}, e = {}, n = [];
	function using(r, e) {
		if (null != e) {
			if (Object(e) !== e) throw new TypeError("using declarations can only be used with objects, functions, null, or undefined.");
			if (r) var o = e[Symbol.asyncDispose || Symbol["for"]("Symbol.asyncDispose")];
			if (void 0 === o && (o = e[Symbol.dispose || Symbol["for"]("Symbol.dispose")], r)) var t = o;
			if ("function" != typeof o) throw new TypeError("Object is not disposable.");
			t && (o = function o() {
				try {
					t.call(e);
				} catch (r) {
					return Promise.reject(r);
				}
			}), n.push({
				v: e,
				d: o,
				a: r
			});
		} else r && n.push({
			d: e,
			a: r
		});
		return e;
	}
	return {
		e,
		u: using.bind(null, !1),
		a: using.bind(null, !0),
		d: function d() {
			var o, t = this.e, s = 0;
			function next() {
				for (; o = n.pop();) try {
					if (!o.a && 1 === s) return s = 0, n.push(o), Promise.resolve().then(next);
					if (o.d) {
						var r = o.d.call(o.v);
						if (o.a) return s |= 2, Promise.resolve(r).then(next, err);
					} else s |= 1;
				} catch (r) {
					return err(r);
				}
				if (1 === s) return t !== e ? Promise.reject(t) : Promise.resolve();
				if (t !== e) throw t;
			}
			function err(n) {
				return t = t !== e ? new r(n, t) : n, next();
			}
			return next();
		}
	};
}
//#endregion
//#region ../subagent/src/continuation.ts
/**
* Continuable-subagent orchestration behind `ctx.subagents`: stable child ids,
* descriptor persistence, provider preparation, cold resume, authorization,
* and message routing. {@link ContinuableActivationRegistry} owns the mutable
* process-local Activation graph and its settlement and disposal lifecycle.
*
* A continuable child has one durable Session and at most one process-local
* Activation. The Agent inbox is the only turn queue, so this manager owns
* durable orchestration while the Agent loop owns all turn ordering and
* execution. No continuable path creates a Task or an intermediate
* result-bearing wrapper.
*
* @module @deepseek-ai/dsh-subagent
*/
/**
* The continuable-subagent orchestration service behind `ctx.subagents`. Tool
* schema and host adapters are consumers of this one contract; foreground
* one-shot delegation keeps calling `ctx.subagents.start()` and never enters
* this lifecycle.
*/
var SubagentContinuationManager = class {
	ctx;
	host;
	activations;
	constructor(ctx, host) {
		this.ctx = ctx;
		this.host = host;
		this.activations = new ContinuableActivationRegistry(ctx, (provider, childId, parent) => host.observeActivation(provider, childId, parent));
	}
	/**
	* Start one continuable background child and resolve at initial inbox acceptance.
	* Every earlier failure disposes any created handle and rolls back Activation
	* and parent ownership without returning either id.
	* @param spec - provider, delegation request, and caller cancellation.
	* @returns the durable child id and accepted initial prompt message id.
	*/
	async startContinuable(spec) {
		const request = spec.request;
		const parent = request.parent;
		this.activations.assertAdmitting(parent);
		const persistence = this.requirePersistence();
		assertSubagentMaxDepth(request.maxDepth);
		const childId = spec.childId ?? brandString(randomUUID());
		this.activations.assertChildIdAvailable(childId);
		const childDepth = resolveChildDepth(parent, request.maxDepth);
		const agentOptions = resolveChildAgentOptions(parent, request.agentOptions, childDepth);
		const agentProvider = agentOptions.provider;
		const agentModel = agentOptions.model;
		const agentReasoningEffort = agentOptions.reasoningEffort;
		const descriptor = snapshotSubagentDescriptor({
			mode: "continuable",
			provider: spec.provider,
			label: spec.label,
			...agentProvider !== void 0 ? { agentProvider } : {},
			...agentModel !== void 0 ? { agentModel } : {},
			...agentReasoningEffort !== void 0 ? { agentReasoningEffort } : {},
			...request.persona !== void 0 ? { persona: request.persona } : {},
			...request.toolFilter !== void 0 ? { toolFilter: request.toolFilter } : {}
		});
		const delegatedPolicies = captureDelegatedPolicyOverrides(parent);
		const releaseHold = this.activations.holdOwnership(parent, childId);
		try {
			const prepared = await this.host.prepareContinuable(spec.provider, {
				sessionId: childId,
				parent,
				signal: spec.signal
			});
			spec.signal.throwIfAborted();
			this.activations.assertAdmitting(parent);
			const inheritedEventCount = SessionLogOffset(prepared.seed?.length ?? 0);
			const seed = prepared.seed;
			return {
				childId,
				messageId: await this.activations.locks.run(childId, async () => {
					spec.signal.throwIfAborted();
					this.activations.assertAdmitting(parent);
					this.activations.assertChildIdAvailable(childId);
					if (spec.childId !== void 0) {
						const persisted = await persistence.stat(childId, { signal: spec.signal });
						spec.signal.throwIfAborted();
						this.activations.assertAdmitting(parent);
						this.activations.assertChildIdAvailable(childId);
						if (persisted !== void 0) throw new SubagentError(`subagent "${childId}" already exists`, "DUPLICATE_CHILD");
					}
					const activation = await this.activations.materialize({
						childId,
						provider: spec.provider,
						parent,
						create: {
							seed,
							meta: childSessionMeta(parent, childDepth, prepared.seed !== void 0),
							inheritedEventCount,
							delegatedPolicies,
							descriptor
						},
						agentOptions,
						composition: {
							persona: request.persona,
							toolFilter: request.toolFilter
						},
						signal: spec.signal
					});
					const childHeader = activation.handle.agent.session.header;
					return await this.submitMaterialized(activation, isAdjacentAgentSendMessageTool(this.ctx.get("tools")?.get("send_message", activation.handle.agent)) ? withContinuableReturnGuidance(parent.id, request.prompt) : request.prompt, {
						source: { kind: "user" },
						signal: spec.signal,
						delivery: "queue"
					}, parent, () => {
						establishCatalogChild(parent.session, childHeader, descriptor);
					});
				})
			};
		} catch (error) {
			releaseHold();
			throw error;
		}
	}
	/**
	* Deliver one model-authored message to a direct continuable child or to the
	* sender's direct parent. A missing direct child cold-resumes through the
	* ordinary continuation lifecycle.
	* @param sender - exact live Agent authorizing and originating the message.
	* @param targetId - durable direct-parent or direct-child session id.
	* @param content - model-authored content to deliver.
	* @param options - caller cancellation before acceptance.
	* @returns the accepted message's inbox id.
	*/
	async sendMessage(sender, targetId, content, options) {
		if (this.ctx.agents.get(sender.id) !== sender) throw new SubagentError("message delivery requires the exact live sender agent", "UNAUTHORIZED");
		this.activations.assertAdmitting(sender);
		const senderActivation = this.activations.get(sender.id);
		if (senderActivation !== void 0 && senderActivation.handle.agent === sender && senderActivation.parentSession === targetId) {
			options.signal.throwIfAborted();
			return this.sendToParent(senderActivation, sender, content);
		}
		if (sender.session.header.parentSession === targetId) throw new SubagentError(`agent "${sender.id}" is not a resident continuable child and cannot send to parent "${targetId}"`, "UNAUTHORIZED");
		return this.deliverToChild(sender, targetId, content, {
			signal: options.signal,
			delivery: "steer"
		});
	}
	/**
	* Queue one human-authored prompt as a distinct direct-child turn.
	* @param parent - exact live direct parent authorizing delivery.
	* @param childId - durable direct-child session id.
	* @param content - model-visible prompt blocks.
	* @param source - durable attribution for the human prompt.
	* @param signal - caller cancellation before inbox acceptance.
	* @returns the accepted durable message id.
	*/
	async queuePrompt(parent, childId, content, source, signal) {
		return this.deliverToChild(parent, childId, content, {
			source,
			signal,
			delivery: "queue"
		});
	}
	/**
	* Steer one host-authored prompt to a direct continuable child.
	* @param parent - exact live direct parent authorizing delivery.
	* @param childId - durable direct-child session id.
	* @param content - model-visible prompt blocks.
	* @param source - durable attribution for the host prompt.
	* @param signal - caller cancellation before inbox acceptance.
	* @returns the accepted durable message id.
	*/
	async steerPrompt(parent, childId, content, source, signal) {
		return this.deliverToChild(parent, childId, content, {
			source,
			signal,
			delivery: "steer"
		});
	}
	/** Route one parent-originated delivery through residency and cold resume. */
	async deliverToChild(parent, childId, content, options) {
		this.activations.assertAdmitting(parent);
		const releaseHold = this.activations.holdOwnership(parent, childId);
		try {
			return await this.deliverFollowup(parent, childId, content, options);
		} catch (error) {
			releaseHold();
			throw error;
		}
	}
	/** The delivery loop behind {@link deliverToChild}, run under the parent hold. */
	async deliverFollowup(parent, childId, content, options) {
		while (true) {
			const live = await this.activations.locks.run(childId, async () => {
				const activation = this.activations.get(childId);
				if (activation === void 0) return this.coldResume(parent, childId, content, options);
				const disposal = activation.inbox.closing;
				/* v8 ignore next 3 -- the send-versus-dispose cutoff needs a delivery to
				* observe the transaction inside the same critical section that opened it. */
				if (disposal !== void 0) return disposal.then(() => void 0, () => void 0);
				if (contentHasImage(content)) {
					await this.assertImageCapable(activation.handle.agent, options.signal);
					if (activation.inbox.closing !== void 0) {
						await Promise.allSettled([activation.inbox.closing]);
						return;
					}
				}
				const messageId = this.submitAdmitted(activation, content, options, parent);
				activation.announced = true;
				return messageId;
			});
			/* v8 ignore start -- only a delivery that lost the disposal cutoff retries. */
			if (live !== void 0) return live;
			this.activations.assertAdmitting(parent);
			options.signal.throwIfAborted();
		}
	}
	/**
	* Interrupt one live continuable child's current turn. Admission is
	* synchronous and the cancellation effect is asynchronous. An absent or
	* already-closing target is an accepted no-op after authority checks.
	* @param targetSessionId - the durable child session id to interrupt.
	* @param authority - the human parent address or exact live ancestor Agent.
	*/
	interrupt(targetSessionId, authority) {
		this.activations.interrupt(targetSessionId, authority);
	}
	/** Deliver one resident continuable child's message to its live direct parent. */
	sendToParent(activation, sender, content) {
		/* v8 ignore next 6 -- only synchronous re-entrant teardown can open this
		* transaction between exact-agent authorization and this no-await span. */
		if (activation.inbox.closing !== void 0) throw new SubagentError(`subagent "${sender.id}" activation is being disposed; the message was not delivered`, "ACTIVATION_CLOSING");
		const parent = this.ctx.agents.get(activation.parentSession);
		if (parent === void 0) throw new SubagentError("direct parent is not live; the message was not delivered", "PARENT_UNAVAILABLE");
		const message = createAgentMessage(sender, content);
		this.sendAgentMessage(parent, message);
		return message.id;
	}
	/** Send one Agent message while translating only the target's own rejection. */
	sendAgentMessage(parent, message) {
		try {
			this.activations.sendWaking(parent, message, "steer");
		} catch (error) {
			throw new SubagentError("direct parent is not live; the message was not delivered", "PARENT_UNAVAILABLE", { cause: error });
		}
	}
	/** Close manager-wide admission and release every live Activation. */
	async drain() {
		await this.activations.drain();
	}
	/**
	* Stop only the continuable descendants of exact live host-owned parents.
	* @param parents - exact live roots whose continuable descendants must stop.
	*/
	async drainDescendants(parents) {
		await this.activations.drainDescendants(parents);
	}
	/**
	* Release selected resident direct children of one exact live parent.
	* @param parent - exact live direct parent authorizing the selected release.
	* @param childIds - durable direct-child ids to release when resident.
	*/
	async drainChildren(parent, childIds) {
		await this.activations.drainChildren(parent, childIds);
	}
	/**
	* Cold-resume a persisted child and submit the waiting turn. The descriptor
	* supplies every reconstruction input; no subagent provider is dispatched.
	*/
	async coldResume(parent, childId, content, options) {
		try {
			var _usingCtx$2 = _usingCtx();
			const query = this.requireSessionQuery();
			let observation;
			try {
				observation = await query.observeSession(childId, { signal: options.signal });
			} catch (error) {
				options.signal.throwIfAborted();
				throw new SubagentError(`subagent "${childId}" is unavailable`, "NOT_RESUMABLE", { cause: error });
			}
			const source = _usingCtx$2.u(observation);
			this.activations.assertAdmitting(parent);
			this.activations.authorizeLineage(parent, childId, source.header.parentSession);
			const descriptor = foldSubagentDescriptor(source.events.slice(source.inheritedEventCount));
			if (descriptor === void 0 || descriptor.mode !== "continuable") throw new SubagentError(`subagent "${childId}" has no supported continuation state and cannot be resumed; choose a different target`, "NOT_RESUMABLE");
			let activation;
			try {
				activation = await this.activations.materialize({
					childId,
					provider: descriptor.provider,
					parent,
					agentOptions: {
						...descriptor.agentProvider !== void 0 ? { provider: descriptor.agentProvider } : {},
						...descriptor.agentModel !== void 0 ? { model: descriptor.agentModel } : {},
						...descriptor.agentReasoningEffort !== void 0 ? { reasoningEffort: ReasoningEffortId(descriptor.agentReasoningEffort) } : {}
					},
					composition: {
						persona: descriptor.persona,
						toolFilter: descriptor.toolFilter
					},
					signal: options.signal
				});
			} catch (error) {
				options.signal.throwIfAborted();
				if (error instanceof SubagentError) throw error;
				throw new SubagentError(`subagent "${childId}" is unavailable`, "NOT_RESUMABLE", { cause: error });
			}
			return await this.submitMaterialized(activation, content, options, parent);
		} catch (_) {
			_usingCtx$2.e = _;
		} finally {
			_usingCtx$2.d();
		}
	}
	/** Admit a materialized child, commit its creation fact, and release it on failure. */
	async submitMaterialized(activation, content, options, parent, commit) {
		try {
			if (contentHasImage(content)) {
				await this.assertImageCapable(activation.handle.agent, options.signal);
				if (activation.inbox.closing !== void 0) throw new SubagentError(`subagent "${activation.childId}" is closing`, "ACTIVATION_CLOSING");
			}
			const messageId = this.submitAdmitted(activation, content, options, parent);
			commit?.();
			activation.announced = true;
			return messageId;
		} catch (error) {
			try {
				await this.activations.dispose(activation);
			} catch (cleanupError) {
				this.ctx.logger.warn(`subagent continuation: disposal after admission or catalog append failure also failed: ${String(cleanupError)}`);
			}
			throw error;
		}
	}
	/** Build and submit one message across the final synchronous admission cutoff. */
	submitAdmitted(activation, content, options, parent) {
		const message = options.source === void 0 ? createAgentMessage(parent, content) : createUserMessage({
			content,
			source: options.source
		});
		return this.activations.submitAdmitted(activation, message, options.delivery, parent, options.signal);
	}
	/** Refuse image content for a child whose fixed model accepts text only. */
	async assertImageCapable(agent, signal) {
		const { provider, model } = agent.options;
		if (provider === void 0 || model === void 0) return;
		const llm = this.ctx.get("llm");
		/* v8 ignore next -- without an LLM registry, delivery defers to projection. */
		if (llm === void 0) return;
		const info = await llm.resolveModelInfo(provider, model, signal);
		if (info.inputModalities !== void 0 && !info.inputModalities.includes("image")) throw new SubagentError(`Model "${model}" does not support image input.`, "MODEL_DOES_NOT_SUPPORT_IMAGES");
	}
	/** Resolve the persistence service continuable children require, or fail loud. */
	requirePersistence() {
		const persistence = this.ctx.get("sessionPersistence");
		if (persistence === void 0) throw new SubagentError("continuable subagents require session persistence (load a dsh-session-persistence backend)", "PERSISTENCE_UNAVAILABLE");
		return persistence;
	}
	/** Resolve the Session query service used for cold child observations. */
	requireSessionQuery() {
		const query = this.ctx.get("sessionQuery");
		if (query === void 0) throw new SubagentError("continuable subagents require session query (load @deepseek-ai/dsh-session-query)", "CONTINUATION_UNAVAILABLE");
		return query;
	}
};
//#endregion
//#region ../subagent/src/list-children.ts
/**
* Concurrent cold observations per explicit catalog listing. Current Session
* persistence providers are local; a networked provider must promote this to
* a validated deployment setting.
*/
const COLD_READ_CONCURRENCY = 4;
/**
* Enumerate one parent's origin-classified direct children from the
* live-preferred merge of `ctx.sessions` and optional session persistence,
* serving each identity from the `subagent` projection unit: the registry's
* watermark snapshot for a live child; for a cold one, a durable
* projection-cache read for an unseeded lifecycle, else one bounded-concurrency
* shared Session observation carrying the exact inherited cut.
* @see SubagentRuntime.listChildren for the public cancellation and failure contract.
* @param ctx - context carrying the session store, the projection registry,
*   optional persistence, and the optional projection cache.
* @param parentSessionId - parent session whose direct children are listed.
* @param signal - caller-owned cancellation observed around every persistence read.
* @returns children and per-child diagnostics ordered by `createdAt`, then id.
* @throws {@link SubagentError} when the projection registry or the session
*   store is not mounted, or the caller cancels the listing.
*/
async function listChildren(ctx, parentSessionId, signal) {
	const listing = await prepareListing(ctx, signal);
	return (await resolveCandidateRows([...listing.corpus.values()].filter((record) => record.header.parentSession === parentSessionId && record.header.origin === "subagent").sort(compareCorpusRecords), listing, signal)).filter((row) => row !== void 0);
}
/**
* Enumerate every session-backed subagent below one root in stable pre-order.
* Ordinary sessions and one-shot children remain traversal nodes, so a
* continuable child below either is still discovered. Classification uses the
* same projection-backed runtime as {@link listChildren}; no Agent is loaded or
* resumed.
* @see SubagentRuntime.listDescendants for the public cancellation and failure contract.
* @param ctx - context carrying the session store, projection registry, and optional persistence/cache.
* @param rootSessionId - session whose complete descendant tree is listed.
* @param signal - caller-owned cancellation observed around every persistence read.
* @returns interpreted subagents with durable direct-parent and root-relative depth.
* @throws {@link SubagentError} under the same conditions as {@link listChildren}.
*/
async function listDescendants(ctx, rootSessionId, signal) {
	const listing = await prepareListing(ctx, signal);
	const positioned = descendantCandidates(listing.corpus, rootSessionId);
	const rows = await resolveCandidateRows(positioned.map((candidate) => candidate.record), listing, signal);
	const entries = [];
	positioned.forEach((position, index) => {
		const row = rows[index];
		if (row !== void 0) entries.push({
			...row,
			parentId: position.parentId,
			depth: position.depth
		});
	});
	return entries;
}
/** Resolve listing services once and build one live-preferred session corpus. */
async function prepareListing(ctx, signal) {
	const projections = ctx.get("sessionProjections");
	if (projections === void 0) throw new SubagentError("listing subagents requires the sessionProjections registry (load @deepseek-ai/dsh-session-projection)", "SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE");
	const sessions = ctx.get("sessions");
	if (sessions === void 0) throw new SubagentError("listing subagents requires the session store (load @deepseek-ai/dsh-session)", "SUBAGENT_CONTROL_SESSION_STORE_UNAVAILABLE");
	assertListingNotCancelled(signal);
	const query = ctx.get("sessionQuery");
	if (query === void 0) throw new SubagentError("listing subagents requires the sessionQuery service (load @deepseek-ai/dsh-session-query)", "SUBAGENT_CONTROL_QUERY_UNAVAILABLE");
	const cache = ctx.get("sessionProjectionCache");
	let records;
	try {
		records = await query.listSessions(signal);
	} catch (error) {
		assertListingNotCancelled(signal);
		throw error;
	}
	assertListingNotCancelled(signal);
	const corpus = /* @__PURE__ */ new Map();
	for (const record of records) {
		const live = sessions.get(record.header.id);
		corpus.set(record.header.id, {
			header: live?.header ?? record.header,
			live
		});
	}
	const subagentParents = /* @__PURE__ */ new Set();
	for (const record of corpus.values()) if (record.header.origin === "subagent" && record.header.parentSession !== void 0) subagentParents.add(record.header.parentSession);
	return {
		projections,
		query,
		cache,
		corpus,
		subagentParents
	};
}
/** Resolve projection-backed rows for aligned candidates with bounded cold reads. */
async function resolveCandidateRows(candidates, listing, signal) {
	const { projections, query, cache, subagentParents } = listing;
	const rows = Array.from({ length: candidates.length });
	const coldReads = [];
	candidates.forEach((candidate, index) => {
		const childId = candidate.header.id;
		if (candidate.live === void 0) {
			coldReads.push({
				index,
				header: candidate.header
			});
			return;
		}
		let identity;
		try {
			identity = projections.snapshot(candidate.live, ["subagent"]).values.subagent;
		} catch {
			rows[index] = {
				kind: "diagnostic",
				id: childId,
				reason: "corrupt"
			};
			return;
		}
		if (identity === void 0 || identity === null || !candidate.live.isOwnSeq(identity.seq)) return;
		rows[index] = childRow(childId, identity, "running", subagentParents.has(childId));
	});
	if (coldReads.length > 0) {
		const queue = [...coldReads];
		await Promise.all(Array.from({ length: Math.min(COLD_READ_CONCURRENCY, queue.length) }, async () => {
			for (let job = queue.shift(); job !== void 0; job = queue.shift()) rows[job.index] = await resolveColdIdentity(query, cache, job.header, subagentParents.has(job.header.id), signal);
		}));
	}
	assertListingNotCancelled(signal);
	return rows;
}
/** Build origin-classified candidates from the complete tree without recursion. */
function descendantCandidates(corpus, rootSessionId) {
	const children = /* @__PURE__ */ new Map();
	for (const record of corpus.values()) {
		const parentId = record.header.parentSession;
		if (parentId === void 0) continue;
		const siblings = children.get(parentId);
		if (siblings === void 0) children.set(parentId, [record]);
		else siblings.push(record);
	}
	for (const siblings of children.values()) siblings.sort(compareCorpusRecords);
	const positioned = [];
	const stack = (children.get(rootSessionId) ?? []).map((record) => ({
		record,
		parentId: rootSessionId,
		depth: 1
	})).reverse();
	const visited = new Set([rootSessionId]);
	while (stack.length > 0) {
		const position = stack.pop();
		const id = position.record.header.id;
		if (visited.has(id)) continue;
		visited.add(id);
		if (position.record.header.origin === "subagent") positioned.push(position);
		const descendants = children.get(id) ?? [];
		for (const record of [...descendants].reverse()) stack.push({
			record,
			parentId: id,
			depth: position.depth + 1
		});
	}
	return positioned;
}
/** Compare siblings by durable creation time, then id. */
function compareCorpusRecords(a, b) {
	return a.header.createdAt - b.header.createdAt || a.header.id.localeCompare(b.header.id);
}
/**
* Resolve one cold candidate down the remaining ladder: an unseeded durable
* projection-cache row, otherwise one shared Session observation. An absent or transiently failed
* observation is one `unavailable` row retried on the next listing; an observation
* source naming another lifecycle, and a
* settled log the fold cannot identify — or that makes any registered unit
* throw — are final, so they report `corrupt`.
*/
async function resolveColdIdentity(query, cache, header, hasChildren, signal) {
	try {
		var _usingCtx$1 = _usingCtx();
		const childId = header.id;
		if (cache !== void 0 && !header.isSeeded) {
			let cached;
			try {
				cached = cache.cachedSnapshot(header, SessionLogOffset(0), ["subagent"])?.values.subagent;
			} catch {
				cached = void 0;
			}
			if (cached !== void 0 && cached !== null) return childRow(childId, cached, "inactive", hasChildren);
		}
		assertListingNotCancelled(signal);
		let observation;
		try {
			observation = await query.observeSession(childId, { ...signal === void 0 ? {} : { signal } });
		} catch (error) {
			assertListingNotCancelled(signal);
			return {
				kind: "diagnostic",
				id: childId,
				reason: sessionQueryCode(error) === "SESSION_QUERY_CORRUPT_SESSION" || sessionQueryCode(error) === "SESSION_QUERY_SOURCE_CONFLICT" ? "corrupt" : "unavailable"
			};
		}
		const ownedObservation = _usingCtx$1.u(observation);
		assertListingNotCancelled(signal);
		if (!sameLifecycle(ownedObservation.header, header)) return {
			kind: "diagnostic",
			id: childId,
			reason: "corrupt"
		};
		const identity = ownedObservation.projections?.values.subagent;
		if (identity === void 0 || identity === null || identity.seq < ownedObservation.inheritedEventCount) return {
			kind: "diagnostic",
			id: childId,
			reason: "corrupt"
		};
		return childRow(childId, identity, "inactive", hasChildren);
	} catch (_) {
		_usingCtx$1.e = _;
	} finally {
		_usingCtx$1.d();
	}
}
/** Materialize one served identity as its child row. */
function childRow(id, identity, activity, hasChildren) {
	return identity.mode === "one-shot" ? {
		kind: "child",
		id,
		mode: "one-shot",
		...identity.label !== void 0 ? { label: identity.label } : {},
		activity,
		hasChildren
	} : {
		kind: "child",
		id,
		mode: "continuable",
		label: identity.label,
		activity,
		hasChildren
	};
}
/** Immutable header fields that distinguish one session lifecycle from another under the same id. */
const LIFECYCLE_WITNESS_KEYS = [
	"version",
	"id",
	"createdAt",
	"cwd",
	"parentSession",
	"isSeeded",
	"delegationDepth",
	"origin",
	"agentPreset"
];
/** Whether an inspected log still belongs to the enumerated lifecycle. */
function sameLifecycle(meta, expected) {
	return LIFECYCLE_WITNESS_KEYS.every((key) => meta[key] === expected[key]);
}
/** Stop a listing at its next cancellation checkpoint. */
function assertListingNotCancelled(signal) {
	if (signal?.aborted) throw new SubagentError("subagent listing was cancelled", "CANCELLED");
}
function sessionQueryCode(error) {
	return error instanceof Error && "code" in error ? error.code : void 0;
}
//#endregion
//#region ../subagent/src/projection.ts
/**
* Pure session projections for subagent identity (mode/label) and active-turn
* duration.
*
* @module @deepseek-ai/dsh-subagent/projection
*/
const activeIntervalSchema = object$1({
	since: number().int().nonnegative(),
	through: number().int().nonnegative()
}).strict();
const projectionSchema = object$1({
	settledMs: number().int().nonnegative(),
	active: activeIntervalSchema.optional()
}).strict().transform(({ settledMs, active }) => ({
	settledMs,
	...active === void 0 ? {} : { active }
}));
/**
* Fold turn boundaries around the child's own durable descriptor.
*
* A fork seed may contain an ancestor descriptor and completed turns. Every
* descriptor therefore resets the accumulated state; the healthy catalog
* admits only a child with exactly one descriptor in its own suffix, making
* the final reset the child's authoritative timing origin.
*/
const subagentTimingProjectionDefinition = {
	key: "subagentTiming",
	stateSchema: object$1({
		settledMs: number().int().nonnegative(),
		active: activeIntervalSchema.optional(),
		pendingTurnStart: number().int().nonnegative().optional(),
		descriptorSeen: boolean()
	}).strict(),
	init: () => ({
		descriptorSeen: false,
		settledMs: 0
	}),
	apply: (state, event) => {
		if (event.type === "turn/start") return state.descriptorSeen ? {
			...state,
			active: {
				since: event.time,
				through: event.time
			}
		} : {
			...state,
			pendingTurnStart: event.time
		};
		if (event.type === "subagent/descriptor") {
			const activeSince = state.active?.since ?? state.pendingTurnStart;
			return {
				descriptorSeen: true,
				settledMs: 0,
				...activeSince === void 0 ? {} : { active: {
					since: activeSince,
					through: event.time
				} }
			};
		}
		if (event.type === "turn/end") {
			if (!state.descriptorSeen) {
				if (state.pendingTurnStart === void 0) return state;
				const { pendingTurnStart: _closed, ...next } = state;
				return next;
			}
			if (state.active === void 0) return state;
			const { active, ...rest } = state;
			return {
				...rest,
				settledMs: state.settledMs + Math.max(0, event.time - active.since)
			};
		}
		if (state.active === void 0) return state;
		return {
			...state,
			active: {
				...state.active,
				through: event.time
			}
		};
	},
	wire: {
		viewSchema: projectionSchema,
		view: (state) => ({
			settledMs: state.settledMs,
			...state.active === void 0 ? {} : { active: state.active }
		})
	},
	stateVersion: 2
};
const identityValueSchema = discriminatedUnion("mode", [object$1({
	mode: literal("one-shot"),
	label: string().optional(),
	seq: number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).transform(SessionSeq)
}).strict(), object$1({
	mode: literal("continuable"),
	label: string(),
	seq: number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).transform(SessionSeq)
}).strict()]);
const identitySchema = identityValueSchema.nullable();
const identityStateSchema = object$1({ identity: identityValueSchema.optional() }).strict();
/** Interpret one `subagent/descriptor` event's identity; no value when the payload cannot be trusted. */
function descriptorIdentity(event) {
	let descriptor;
	try {
		descriptor = foldSubagentDescriptor([event]);
	} catch {
		descriptor = void 0;
	}
	if (descriptor === void 0) return void 0;
	return descriptor.mode === "one-shot" ? {
		mode: "one-shot",
		...descriptor.label !== void 0 ? { label: descriptor.label } : {},
		seq: event.seq
	} : {
		mode: "continuable",
		label: descriptor.label,
		seq: event.seq
	};
}
/**
* Fold the durable mode/label identity from `subagent/descriptor` events,
* last-wins: a fork seed may replay an ancestor's descriptor, and the child's
* own descriptor must override it — the same reset discipline as
* {@link subagentTimingProjectionDefinition}. A malformed or unknown-version
* payload resets to the `null` sentinel instead of throwing, so a fork of a
* healthy ancestor never inherits an identity its own descriptor failed to
* establish — and the reset survives every JSON push frame, so a consumer
* holding the earlier identity replaces it instead of keeping it stale;
* `null` ⟺ no valid descriptor, with the causes deliberately undistinguished.
*/
const subagentIdentityProjectionDefinition = {
	key: "subagent",
	stateSchema: identityStateSchema,
	init: () => ({}),
	apply: (state, event) => {
		if (event.type !== "subagent/descriptor") return state;
		const identity = descriptorIdentity(event);
		return identity === void 0 ? {} : { identity };
	},
	wire: {
		viewSchema: identitySchema,
		view: (state) => state.identity ?? null
	},
	stateVersion: 2
};
//#endregion
//#region ../subagent/src/out-of-process.ts
/**
* Provider-side vocabulary for OUT-OF-PROCESS subagent backends — the pieces
* that enforce this seam's own contracts around a child in another process:
* the no-capabilities advertisement, timing-bound validation, child
* working-directory resolution (config override, else the delegating parent
* session's workspace), the never-reject result settlement, and the standard
* run-handle publication. Backends compose these with their own wire drivers;
* the process machinery itself (spawn, env scrub, managed-range teardown)
* belongs to the `dsh-subprocess` seam.
*
* @module @deepseek-ai/dsh-subagent/out-of-process
*/
/** Maximum UTF-8 size of {@link SubagentResult.diagnostic}. */
const MAX_SUBAGENT_DIAGNOSTIC_BYTES = 4096;
const DIAGNOSTIC_TRUNCATION_SUFFIX = "\n[diagnostic truncated]";
const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();
/**
* Limit provider-authored failure detail without splitting a UTF-8 sequence.
* @param diagnostic - safe diagnostic text produced by the provider.
* @returns the original text, or a visibly truncated value within the limit.
*/
function limitSubagentDiagnostic(diagnostic) {
	const bytes = utf8Encoder.encode(diagnostic);
	if (bytes.byteLength <= MAX_SUBAGENT_DIAGNOSTIC_BYTES) return diagnostic;
	let prefixBytes = MAX_SUBAGENT_DIAGNOSTIC_BYTES - utf8Encoder.encode(DIAGNOSTIC_TRUNCATION_SUFFIX).byteLength;
	while ((bytes[prefixBytes] & 192) === 128) prefixBytes -= 1;
	return utf8Decoder.decode(bytes.subarray(0, prefixBytes)) + DIAGNOSTIC_TRUNCATION_SUFFIX;
}
/** Enforce the byte limit on a provider-returned diagnostic. */
function normalizeSubagentDiagnostic(result) {
	return result.diagnostic === void 0 ? result : {
		...result,
		diagnostic: limitSubagentDiagnostic(result.diagnostic)
	};
}
/**
* The capability advertisement of an out-of-process backend: NONE. A child in
* another process cannot honor parent-enforced start features
* (`agentOptions`/`outputSchema`/`maxDepth`/`toolFilter`/`persona`), so the service rejects a
* request needing any of them before `start` runs — never accepted-then-ignored.
*/
const NO_START_CAPABILITIES = Object.freeze({
	agentOptions: false,
	outputSchema: false,
	depthLimit: false,
	toolFilter: false,
	persona: false
});
/**
* Assert a configured timing bound is a positive finite number (it bounds a
* teardown or shutdown wait; zero, negative, or NaN would skip or wedge it).
* @param prefix - the consuming plugin's diagnostic prefix (e.g. `subagent-acp`).
* @param name - the config field name, for the diagnostic.
* @param value - the configured value.
*/
function assertPositiveFinite(prefix, name, value) {
	if (!Number.isFinite(value) || value <= 0) throw new Error(`${prefix}: ${name} must be a positive finite number`);
}
/**
* Whether `path` names an existing directory the harness can ENTER. The
* search-permission probe matters: `statSync().isDirectory()` is true for a
* mode-600 directory, but a subprocess cwd needs `X_OK` or spawn fails EACCES.
*/
function isEnterableDirectory(path) {
	try {
		if (!statSync(path).isDirectory()) return false;
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}
/**
* Assert `cwd` can actually host the child: absolute (it doubles as the
* child's workspace identity, and a relative path would be re-anchored to the
* server process's launch directory) and an existing directory (fail here,
* before the process boundary, instead of as an ambiguous spawn ENOENT).
* @param prefix - the consuming plugin's diagnostic prefix.
* @param label - which source supplied the value, for the diagnostic.
* @param cwd - the candidate working directory.
* @returns `cwd`, validated.
*/
function assertUsableCwd(prefix, label, cwd) {
	if (!isAbsolute(cwd)) throw new Error(`${prefix}: ${label} must be an absolute path: ${cwd}`);
	if (!isEnterableDirectory(cwd)) throw new Error(`${prefix}: ${label} is not an accessible directory: ${cwd}`);
	return cwd;
}
/**
* Validate a configured `cwd` override ONCE, at plugin load: reject the empty
* string (`path.resolve('')` is the process cwd — it would silently
* reintroduce the launch-directory fallback this resolution removes),
* interpret a relative path against the harness launch directory, and require
* an enterable directory.
* @param prefix - the consuming plugin's diagnostic prefix.
* @param cwd - the configured override, or `undefined` when the config omits it.
* @returns the validated absolute override, or `undefined` when omitted.
*/
function validateConfiguredCwd(prefix, cwd) {
	if (cwd === void 0) return void 0;
	if (cwd === "") throw new Error(`${prefix}: config cwd must not be empty — omit the key to inherit the parent session cwd`);
	return assertUsableCwd(prefix, "config cwd", resolve(cwd));
}
/**
* Resolve the child's working directory at start: the deployment override
* when configured (already validated at load), else the parent session's
* workspace cwd (validated here, its earliest resolvable point). Fails loud
* when neither exists — falling back to the harness process cwd would
* silently bind the child to the server's launch directory instead of the
* delegating session's workspace (one server process serves many sessions,
* each with its own cwd).
* @param prefix - the consuming plugin's diagnostic prefix.
* @param configured - the load-validated override, or `undefined`.
* @param parentCwd - the delegating parent session's workspace cwd, if any.
* @returns the absolute child working directory.
*/
function resolveChildCwd(prefix, configured, parentCwd) {
	if (configured !== void 0) return configured;
	if (parentCwd === void 0) throw new Error(`${prefix}: no working directory for the child — configure \`cwd\` or delegate from a parent session that has one`);
	return assertUsableCwd(prefix, "parent session cwd", parentCwd);
}
/** Normalize an unknown thrown value to an Error (the catch binding is `unknown`). */
function toError$1(value) {
	/* v8 ignore next */
	return value instanceof Error ? value : new Error(String(value));
}
/**
* Settle an out-of-process run result under the seam contract: `result` never
* rejects after publication. A normally completed or rejected attempt resolves
* as `aborted` when cancellation already settled locally; another rejection is
* flattened to `stopReason: 'error'` through the contained diagnostic sink.
* Provider-returned diagnostics use the same byte limit. The abort listener is
* removed on every path.
* @param parts - the attempt, output snapshot, cancellation state, sink, and signal wiring.
* @returns the terminal result (never a rejection).
*/
async function settleRunResult(parts) {
	try {
		const result = await parts.attempt();
		return parts.cancelled() ? {
			output: parts.collectOutput(),
			stopReason: "aborted"
		} : normalizeSubagentDiagnostic(result);
	} catch (error) {
		if (parts.cancelled()) return {
			output: parts.collectOutput(),
			stopReason: "aborted"
		};
		try {
			parts.onError?.(toError$1(error), "error");
		} catch {}
		const collected = parts.collectDiagnostic?.();
		const diagnostic = collected === void 0 ? void 0 : limitSubagentDiagnostic(collected);
		return {
			output: parts.collectOutput(),
			...diagnostic === void 0 ? {} : { diagnostic },
			stopReason: "error"
		};
	} finally {
		parts.signal.removeEventListener("abort", parts.onAbort);
	}
}
/**
* Publish the seam run handle for an out-of-process child. `dispose()` is
* idempotent (one memoized teardown): it removes the abort listener, settles
* local cancellation — there is no assumption the child cooperates — and then
* awaits the backend's teardown to actual exit.
* @param parts - the run identity, result, cancellation wiring, and teardown.
* @returns the seam run handle (`localAgent` is `undefined` for remote runs).
*/
function subprocessRunHandle(parts) {
	let disposal;
	return {
		id: parts.id,
		localAgent: void 0,
		result: parts.result,
		dispose() {
			if (disposal !== void 0) return disposal;
			parts.signal.removeEventListener("abort", parts.onAbort);
			parts.requestCancel();
			disposal = parts.teardown();
			return disposal;
		}
	};
}
//#endregion
//#region ../subagent/src/index.ts
/**
* Service Definition for the subagent capability seam (`ctx.subagents`): a named-provider registry plus a
* capability-validating asynchronous start API. Providers establish a
* child before returning its run, so fulfillment is the single publication and
* ownership-transfer boundary.
*
* Multiple providers coexist: each registers under a unique name and callers
* select one by name.
*
* This package owns the Service Definition role of the capability seam. Service Providers
* (`@deepseek-ai/dsh-subagent-spawn-in-process`, `-fork`, `-acp`) and the model-facing
* consumer (`@deepseek-ai/dsh-tool-subagent`) are separate packages.
*
* Public operations express caller intent: `start` returns one published owned
* one-shot run, `startContinuable` establishes a durable continuable child, and
* `sendMessage` steers between adjacent Agents without exposing whether a child
* is resident. Continuable children never become a {@link SubagentRun}: the
* continuation manager holds their `AgentHandle` directly and orders every turn
* through the child's own inbox, so providers contribute only the detached
* creation spec and see no handle, turn, or teardown. Child and descendant
* discovery read the live session store and optional session persistence
* directly and do not require that continuation runtime.
*
* Same-process providers are trusted typed collaborators. Requests, provider
* descriptors, results, and lifecycle payloads are borrowed immutable values;
* serialization and hostile-input validation belong at real process, worker,
* persistence, and model boundaries.
*
* @module @deepseek-ai/dsh-subagent
*/
var __runInitializers = function(thisArg, initializers, value) {
	var useValue = arguments.length > 2;
	for (var i = 0; i < initializers.length; i++) value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
	return useValue ? value : void 0;
};
var __esDecorate = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
	function accept(f) {
		if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
		return f;
	}
	var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
	var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
	var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
	var _, done = false;
	for (var i = decorators.length - 1; i >= 0; i--) {
		var context = {};
		for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
		for (var p in contextIn.access) context.access[p] = contextIn.access[p];
		context.addInitializer = function(f) {
			if (done) throw new TypeError("Cannot add initializers after decoration has completed");
			extraInitializers.push(accept(f || null));
		};
		var result = (0, decorators[i])(kind === "accessor" ? {
			get: descriptor.get,
			set: descriptor.set
		} : descriptor[key], context);
		if (kind === "accessor") {
			if (result === void 0) continue;
			if (result === null || typeof result !== "object") throw new TypeError("Object expected");
			if (_ = accept(result.get)) descriptor.get = _;
			if (_ = accept(result.set)) descriptor.set = _;
			if (_ = accept(result.init)) initializers.unshift(_);
		} else if (_ = accept(result)) if (kind === "field") initializers.unshift(_);
		else descriptor[key] = _;
	}
	if (target) Object.defineProperty(target, contextIn.name, descriptor);
	done = true;
};
(() => {
	let _classSuper = TypertRemoteService;
	let _instanceExtraInitializers = [];
	let _remoteExportList_decorators;
	let _prompt_decorators;
	let _interruptByParent_decorators;
	return class SubagentRuntime extends _classSuper {
		static {
			const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
			_remoteExportList_decorators = [Remote("list")];
			_prompt_decorators = [Remote("prompt")];
			_interruptByParent_decorators = [Remote("interruptByParent")];
			__esDecorate(this, null, _remoteExportList_decorators, {
				kind: "method",
				name: "remoteExportList",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteExportList" in obj,
					get: (obj) => obj.remoteExportList
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _prompt_decorators, {
				kind: "method",
				name: "prompt",
				static: false,
				private: false,
				access: {
					has: (obj) => "prompt" in obj,
					get: (obj) => obj.prompt
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _interruptByParent_decorators, {
				kind: "method",
				name: "interruptByParent",
				static: false,
				private: false,
				access: {
					has: (obj) => "interruptByParent" in obj,
					get: (obj) => obj.interruptByParent
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			if (_metadata) Object.defineProperty(this, Symbol.metadata, {
				enumerable: true,
				configurable: true,
				writable: true,
				value: _metadata
			});
		}
		providers = (__runInitializers(this, _instanceExtraInitializers), /* @__PURE__ */ new Map());
		continuations;
		/**
		* The contained lifecycle-edge publisher. Built here because scoped dispatch
		* keys its carrier by this exact service instance, whose own context filter
		* composes into the carrier.
		*/
		emitLifecycle;
		constructor(ctx) {
			super(ctx, "subagents");
			this.emitLifecycle = createLifecycleEmitter(this.ctx, (parent) => scopeTarget(this, parent));
			ctx.inject(["agents"], (childCtx) => {
				const manager = new SubagentContinuationManager(childCtx, {
					prepareContinuable: (name, request) => this.prepareContinuable(name, request),
					observeActivation: (provider, childId, parent) => this.observeActivation(provider, childId, parent)
				});
				this.continuations = manager;
				childCtx.effect(() => () => {
					/* v8 ignore else -- one injected binding owns the slot until its fiber disposes. */
					if (this.continuations === manager) this.continuations = void 0;
				}, "subagents.continuationBinding()");
			});
			ctx.inject(["sessionProjections"], (projectionCtx) => {
				projectionCtx.sessionProjections.register(subagentCatalogProjectionDefinition);
				projectionCtx.sessionProjections.register(subagentTimingProjectionDefinition);
				projectionCtx.sessionProjections.register(subagentIdentityProjectionDefinition);
			});
		}
		/**
		* Establish one durable continuable child and deliver its initial prompt.
		* Resolves when the child's inbox accepts that prompt, without waiting for the
		* turn to start or for the message to reach the Session log; any earlier
		* failure rejects with no ids and rolls back the child entirely.
		* @param spec - provider, delegation request, and caller cancellation.
		* @returns the durable child id and the accepted prompt's message id.
		* @throws when continuation services are unavailable or materialization fails.
		*/
		async startContinuable(spec) {
			return this.requireContinuations().startContinuable(spec);
		}
		/**
		* Steer one model-authored message to the sender's direct parent or direct
		* continuable child. A running target admits it at the nearest step boundary;
		* an idle target starts a turn, and an absent direct child cold-resumes from
		* persistence. The service derives durable sender attribution from the exact
		* live sender. Caller cancellation stops only pre-acceptance work.
		* @param sender - exact live Agent authorizing and originating the message.
		* @param targetId - durable direct-parent or direct-child session id.
		* @param content - model-authored content to deliver.
		* @param options - caller cancellation before inbox acceptance.
		* @returns the accepted message's inbox id.
		* @throws when continuation services are unavailable, adjacency is rejected,
		*   or the message was not admitted.
		*/
		async sendMessage(sender, targetId, content, options) {
			return this.requireContinuations().sendMessage(sender, targetId, content, options);
		}
		/**
		* Deliver one host-protocol message to a direct continuable child.
		* Symbol-keyed so host adapters can preserve their own provenance without
		* widening the public Service Definition or impersonating an Agent sender.
		* @param parent - exact live direct parent authorizing delivery.
		* @param childId - durable direct-child session id.
		* @param content - host-authored content to deliver.
		* @param source - durable host-protocol provenance.
		* @param signal - caller cancellation before inbox acceptance.
		* @param delivery - Queue as a distinct turn or Steer at the nearest step.
		* @returns the accepted message's inbox id.
		*/
		[deliverSubagentPrompt](parent, childId, content, source, signal, delivery) {
			return delivery === "steer" ? this.requireContinuations().steerPrompt(parent, childId, content, source, signal) : this.requireContinuations().queuePrompt(parent, childId, content, source, signal);
		}
		/**
		* Interrupt one live continuable child's current turn under a human parent
		* address or an exact live ancestor Agent. Fire-and-return: the cancel
		* signal is issued before this returns, but the target may keep running
		* until it observes the signal. Unclaimed pending inbox work, the Activation,
		* and published descendants are preserved; claimed work is not requeued.
		* Once the interrupted driver is idle, a waking send resumes the parked FIFO
		* queue. An absent target — including a one-shot or unknown id —
		* is an accepted no-op, as is a manager-less composition, which cannot own a
		* live Activation.
		* @param targetSessionId - the durable child session id to interrupt.
		* @param authority - the human parent address or exact live ancestor Agent.
		* @throws {SubagentError} `UNAUTHORIZED` when the authority does not own the
		*   live target.
		*/
		interrupt(targetSessionId, authority) {
			this.continuations?.interrupt(targetSessionId, authority);
		}
		/**
		* Close continuable admission below exact live parent Agents, stop only their
		* visible descendant Activations synchronously, then await admitted scoped
		* materializations and release those forests child-first. The scoped cutoff
		* lasts until each exact parent leaves the registry; unrelated parent trees
		* remain live.
		* @param parents - exact host-owned parent Agents entering teardown.
		* @returns once every retained descendant Activation released its `AgentHandle`.
		* @throws an aggregate error after all branches settle when any failed.
		*/
		async drainContinuableDescendants(parents) {
			const manager = this.continuations;
			if (manager === void 0) return;
			await manager.drainDescendants(parents);
		}
		/**
		* Release selected resident continuable direct children of one exact live
		* parent. Other children of the same parent remain admitted and resident.
		* Absent targets and a manager-less composition are accepted no-ops.
		* @param parent - exact live direct parent authorizing the selected release.
		* @param childIds - durable direct-child ids to release when resident.
		* @returns once every selected Activation released its `AgentHandle`.
		* @throws {SubagentError} `UNAUTHORIZED` when a resident target belongs to a
		*   different parent or the supplied parent identity is stale.
		*/
		async drainContinuableChildren(parent, childIds) {
			const manager = this.continuations;
			if (manager === void 0) return;
			await manager.drainChildren(parent, childIds);
		}
		/**
		* Enumerate the parent's direct session-backed subagents without loading or
		* resuming an Agent. The Session query service supplies one live-preferred
		* corpus and shared point observations; the projection cache supplies
		* immutable descriptor hits without opening cold logs. The registered
		* `subagent` projection remains the sole mode/label classifier.
		*
		* Every query receives `signal`, and the listing rechecks cancellation
		* around each await. Read rejections that settle
		* after an abort become a stable `SubagentError` with code `CANCELLED`.
		* @param parentSessionId - parent session whose direct children are listed.
		* @param signal - caller-owned cancellation forwarded to Session queries
		*   and observed around every read await.
		* @returns children and per-child diagnostics ordered by `createdAt`, then id.
		* @throws {@link SubagentError} when the projection registry or the session
		*   store is not mounted, or the caller cancels the listing.
		*/
		listChildren(parentSessionId, signal) {
			return listChildren(this.ctx, parentSessionId, signal);
		}
		/**
		* Enumerate the root's complete session-backed subagent tree in stable
		* pre-order from one live-preferred corpus, without loading or resuming an
		* Agent. Ordinary sessions and one-shot children remain traversal nodes so
		* continuable descendants below them are discovered; each returned entry
		* adds its durable `parentId` and root-relative `depth`. Identity resolution,
		* diagnostics, optional persistence, and cancellation follow the same
		* projection-backed contract as {@link listChildren}.
		* @param rootSessionId - session whose complete descendant tree is listed.
		* @param signal - caller-owned cancellation forwarded to persistence reads
		*   and observed around every read await.
		* @returns children and per-candidate diagnostics with tree position, in
		*   stable pre-order.
		* @throws {@link SubagentError} under the same conditions as {@link listChildren}.
		*/
		listDescendants(rootSessionId, signal) {
			return listDescendants(this.ctx, rootSessionId, signal);
		}
		/**
		* Remote face of {@link listChildren} for one browser: the durable listing
		* plus live Agent activity and the delivery-time parent availability hint.
		* Parent availability is a hint; {@link prompt} performs the authoritative
		* check. Named apart from the provider-name {@link list}, which owns the
		* member.
		* @param parentSessionId - parent session whose direct children are listed.
		* @param signal - carrier cancellation forwarded to Session queries.
		* @returns the catalog view for that parent.
		* @throws {RemoteError} `gateway/bad-request` for an empty parent id,
		*   `gateway/cancelled` for an aborted read, `subagent/projections-unavailable` when
		*   the deployment has no projection registry, otherwise `gateway/internal`.
		*/
		async remoteExportList(parentSessionId, signal) {
			validateControlRequest("subagent.list", { parentSessionId });
			try {
				return catalogView(this.ctx, parentSessionId, await this.listChildren(parentSessionId, signal));
			} catch (error) {
				return rejectCatalogRead(error, signal);
			}
		}
		/**
		* Deliver one browser-authored message to a continuable child through the
		* exact live direct parent, retaining the caller-minted request identity and
		* validated browser zone on the accepted message. Success identifies the
		* message the child's inbox accepted; later execution is independent of this
		* call. Queue delivery targets a later turn; steer delivery targets the
		* nearest step and retains the Agent loop's best-effort fallback semantics.
		* Image parts are admitted and persisted through the attachment store
		* before delivery, and the child's model must accept image input.
		* @param request - durable address, delivery, minted identity, content, and optional browser zone.
		* @param signal - carrier cancellation, owning the call until inbox acceptance.
		* @returns the accepted message's inbox identity.
		* @throws {RemoteError} `gateway/bad-request`, `subagent/attachment-invalid`,
		*   `subagent/invalid-time-zone`, `subagent/parent-unavailable`,
		*   `subagent/not-resumable`, `subagent/unauthorized`,
		*   `subagent/delivery-unavailable`, `gateway/cancelled`, or `gateway/internal`.
		*/
		async prompt(request, signal) {
			const { parentSessionId, childSessionId, clientTimeZone, delivery } = request;
			validateControlRequest("subagent.prompt", request);
			const canonicalTimeZone = clientTimeZone === void 0 ? void 0 : canonicalClientTimeZone(clientTimeZone);
			if (clientTimeZone !== void 0 && canonicalTimeZone === void 0) throw new RemoteError("subagent/invalid-time-zone", "clientTimeZone must be UTC or a valid IANA Area/Location name", { value: clientTimeZone });
			const parent = this.ctx.get("agents")?.get(parentSessionId);
			if (parent === void 0) throw new RemoteError("subagent/parent-unavailable", `parent session "${parentSessionId}" is not live`, { parentSessionId });
			const source = {
				kind: "user",
				rpcId: request.requestId,
				...canonicalTimeZone === void 0 ? {} : { clientTimeZone: canonicalTimeZone }
			};
			try {
				let content;
				if (request.content.every((part) => part.type === "text")) content = request.content.map((part) => ({
					type: "text",
					text: part.text
				}));
				else {
					const attachments = this.ctx.get("attachments");
					if (attachments === void 0) throw new Error("subagent image prompt requires an attachment store");
					content = await attachments.admitPromptContent(request.content);
				}
				return { messageId: await this[deliverSubagentPrompt](parent, childSessionId, content, source, signal, delivery) };
			} catch (error) {
				return rejectPrompt(error, childSessionId, signal);
			}
		}
		/**
		* Remote face of {@link interrupt} under one durable parent address. No
		* catalog, history, persistence, or parent Agent lookup runs: the core
		* primitive alone authorizes the address against the live Activation, which
		* is what keeps a live child interruptible while its parent Agent is offline.
		* Absent, idle, and already-completed targets are accepted no-ops there.
		* @param childSessionId - durable child session id to interrupt.
		* @param parentSessionId - durable direct parent whose authority is claimed.
		* @param mode - required continuable-address discriminator.
		* @returns acknowledgement that the cancel signal was admitted, not that the target is quiescent.
		* @throws {RemoteError} `gateway/bad-request` for an empty id,
		*   `subagent/unauthorized` when the address does not own the live target,
		*   otherwise `gateway/internal`.
		*/
		interruptByParent(childSessionId, parentSessionId, mode) {
			validateControlRequest("subagent.interrupt", {
				childSessionId,
				parentSessionId,
				mode
			});
			try {
				this.interrupt(childSessionId, {
					kind: "user",
					parentSessionId
				});
			} catch (error) {
				if (error instanceof SubagentError && error.code === "UNAUTHORIZED") throw new RemoteError("subagent/unauthorized", "subagent does not belong to this parent", { childSessionId }, { cause: error });
				throw new RemoteError("gateway/internal", "subagent interrupt failed", {}, { cause: error });
			}
			return { accepted: true };
		}
		/**
		* Register a provider under its name. Registration is effect-scoped and HMR
		* safe; removing a provider blocks new starts but does not revoke runs that
		* were already returned to their holders.
		* @param provider - the trusted provider implementation.
		* @returns the exact Cordis effect disposer.
		*/
		registerProvider(provider) {
			const name = provider.name;
			return this.ctx.effect(function* () {
				if (this.providers.has(name)) throw new SubagentError(`a subagent provider named "${name}" is already registered`, "DUPLICATE_PROVIDER");
				this.providers.set(name, provider);
				yield () => {
					this.providers.delete(name);
					this.emitLifecycle("subagent/provider-removed", name);
				};
				this.ctx.emit("subagent/provider-added", provider);
			}.bind(this), "subagents.registerProvider()");
		}
		/**
		* Look up a provider by name.
		* @param name - the provider name.
		* @returns the provider, or undefined when absent.
		*/
		getProvider(name) {
			return this.providers.get(name);
		}
		/**
		* List registered provider names in insertion order.
		* @returns the registered names.
		*/
		list() {
			return [...this.providers.keys()];
		}
		/**
		* Establish a published child on the named provider. Capability and semantic
		* checks run before delegation. Provider ownership lasts until its promise
		* fulfills; a rejection therefore has no run for the caller to dispose and
		* emits no run lifecycle events. Post-publication turn and infrastructure
		* failures settle through the returned run.
		* A catalog append failure disposes the run and handles its result rejection;
		* the caller receives the catalog error even if disposal also fails.
		* @param name - the provider to use.
		* @param request - child label, prompt, parent, signal, and optional capabilities.
		* @returns the published holder-owned run.
		*/
		async start(name, request) {
			const provider = this.expectProvider(name);
			this.assertCapabilities(provider, request);
			assertSubagentMaxDepth(request.maxDepth);
			if (request.outputSchema !== void 0) assertObjectJsonSchema(request.outputSchema);
			const descriptor = snapshotSubagentDescriptor({
				mode: "one-shot",
				provider: name,
				...request.label !== void 0 ? { label: request.label } : {}
			});
			const resolved = {
				...request,
				descriptor
			};
			const run = await provider.start(resolved);
			const child = run.localAgent?.session;
			if (child !== void 0) try {
				establishCatalogChild(request.parent.session, child.header, descriptor);
			} catch (error) {
				run.result.catch(() => void 0);
				try {
					await run.dispose();
				} catch (cleanupError) {
					this.ctx.logger.warn(`subagent: disposal after catalog append failure also failed: ${String(cleanupError)}`);
				}
				throw error;
			}
			return observeRun(this.emitLifecycle, name, request.parent, run);
		}
		/**
		* Resolve one provider's detached continuable-creation contribution. Method
		* presence on the provider IS the capability, so a provider without it is
		* rejected before the manager reserves any child resources.
		*/
		async prepareContinuable(name, request) {
			const provider = this.expectProvider(name);
			if (provider.prepareContinuable === void 0) throw new SubagentError(`subagent provider "${provider.name}" does not support continuable children (no prepareContinuable capability)`, "UNSUPPORTED_CAPABILITY");
			return provider.prepareContinuable(request);
		}
		/** Look up a provider for dispatch or fail loud. */
		expectProvider(name) {
			const provider = this.providers.get(name);
			if (provider === void 0) throw new SubagentError(`no subagent provider registered for "${name}"`, "NO_PROVIDER");
			return provider;
		}
		/** Resolve the optional continuable-subagent manager or fail loud. */
		requireContinuations() {
			if (this.continuations === void 0) throw new SubagentError("continuable subagents require the agents service", "CONTINUATION_UNAVAILABLE");
			return this.continuations;
		}
		/**
		* Build the lifecycle observer for one continuable Activation's residency
		* epoch, so the manager publishes its edges without owning event dispatch.
		*/
		observeActivation(provider, childId, parent) {
			return createActivationObserver(this.emitLifecycle, provider, childId, parent);
		}
		/** Reject the first requested capability that the provider lacks. */
		assertCapabilities(provider, request) {
			const needs = [
				{
					when: request.agentOptions !== void 0,
					cap: "agentOptions"
				},
				{
					when: request.outputSchema !== void 0,
					cap: "outputSchema"
				},
				{
					when: request.maxDepth !== void 0,
					cap: "depthLimit"
				},
				{
					when: request.toolFilter !== void 0,
					cap: "toolFilter"
				},
				{
					when: request.persona !== void 0,
					cap: "persona"
				}
			];
			for (const { when, cap } of needs) if (when && !provider.capabilities[cap]) throw new SubagentError(`subagent provider "${provider.name}" does not support the "${cap}" capability`, "UNSUPPORTED_CAPABILITY");
		}
	};
})();
//#endregion
//#region ../../../Core/subprocess/subprocess/src/connection.ts
/**
* Close child stdin, allow the peer to flush, then terminate and await its
* complete managed range. The Provider owns the platform-specific TERM/KILL
* sequence; this caller owns the EOF and final observation deadlines.
* @param connection - owned child process and raw stdio streams.
* @param graces - EOF window and Provider termination grace in milliseconds.
* @throws when the Provider cannot confirm the managed range is empty.
*/
async function disposeChildConnection(connection, graces) {
	connection.stdin.end();
	if (await waitForExitWithin(connection, graces.eofGraceMs)) return;
	connection.terminate();
	const exitWaitMs = graces.terminationGraceMs * 2;
	if (!await waitForExitWithin(connection, exitWaitMs)) throw new Error(`managed subprocess range did not exit within ${exitWaitMs}ms after termination`);
}
/** Bound a managed-range wait without cancelling the Provider's shared observation. */
function waitForExitWithin(connection, ms) {
	const timeout = new AbortController();
	const timer = setTimeout(() => {
		timeout.abort();
	}, ms);
	return connection.waitForExit(timeout.signal).finally(() => {
		clearTimeout(timer);
	});
}
[...Object.values({
	httpProxy: ["http_proxy", "HTTP_PROXY"],
	httpsProxy: ["https_proxy", "HTTPS_PROXY"],
	noProxy: ["no_proxy", "NO_PROXY"]
}).flat()];
new Set(["http:", "https:"]);
/** One IPv4 octet, so a loopback match cannot accept `127.999.1.1`. */
const OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
new RegExp(`^127\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);
/**
* The proxy environment a spawned child needs.
*
* A child inherits the parent environment, which this process rewrote to its own resolved policy.
* Handing that normalization straight through would replace values the user set for other tools, so
* each proxy name the user exported is restored to what they wrote: a SOCKS proxy `curl` uses is
* not swapped for the HTTP one this package fell back to for that scheme.
*
* A scheme the user named in neither casing carries the resolved value instead of being removed.
* Without that the child's routing silently diverges from its parent's: `NODE_USE_ENV_PROXY` does
* not read `ALL_PROXY`, so a child of a parent that resolved its proxy from that name would connect
* directly while the parent proxies.
*
* The bypass list is always the resolved one. It only ever adds the loopback entries to what
* the user wrote, so nothing is lost, and the child stops sending its own localhost traffic to a
* proxy that cannot route it.
*
* The flag reaches only Node 22.21+ and 24+; an older runtime keeps that child direct. Such a child
* also matches bypass entries with Node's own `NO_PROXY` rules, which differ from this package's in
* their separators and IPv4-range support. Non-Node children (curl, git, pnpm) ignore the flag and
* read the variables themselves.
*
* The flag is withheld when a proxy value the child receives is one this package refused. Node
* parses `HTTP_PROXY` and `HTTPS_PROXY` under that flag before running the program, and exits on a
* scheme other than `http:` or `https:` — so a SOCKS value kept for `curl` would stop every Node
* child from starting. Without the flag such a child connects directly, as this process already
* reported for that scheme, and `curl` still reads the value it was kept for.
*
* A worker thread is deliberately NOT served here — see the workflow engine, which runs
* model-authored scripts and must not receive a proxy URL that may carry credentials.
*
* @returns names to apply to the child environment, where `undefined` means remove, or an empty
*   object when no proxy is active.
*/
function proxyEnvironmentForChild() {
	return {};
}
//#endregion
//#region ../../../Core/subprocess/subprocess/src/environment.ts
/** Shared child-process environment policy for legacy and native subprocess Providers. */
/** Credential-shaped environment names never forwarded to children implicitly. */
const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i;
/**
* Build the ambient child environment without credentials or inherited DSH identities.
* Explicit spawn-spec values merge after this result and can deliberately restore a key.
* @returns a fresh environment that preserves executable paths, locale, and active proxy routing.
*/
function scrubbedParentEnv() {
	const env = {};
	for (const [key, value] of Object.entries(process.env)) if (value !== void 0 && !SENSITIVE_ENV_PATTERN.test(key) && !key.toUpperCase().startsWith("DSH_")) env[key] = value;
	for (const [name, value] of Object.entries(proxyEnvironmentForChild())) if (value === void 0) Reflect.deleteProperty(env, name);
	else env[name] = value;
	return env;
}
//#endregion
//#region ../../../../node_modules/.pnpm/node-pty@1.2.0-beta.15_patc_746f94784a9f92509fd9652247742bc3/node_modules/node-pty/lib/utils.js
var require_utils = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Copyright (c) 2017, Daniel Imms (MIT License).
	* Copyright (c) 2018, Microsoft Corporation (MIT License).
	*/
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.assign = assign;
	exports.loadNativeModule = loadNativeModule;
	function assign(target) {
		var sources = [];
		for (var _i = 1; _i < arguments.length; _i++) sources[_i - 1] = arguments[_i];
		sources.forEach(function(source) {
			return Object.keys(source).forEach(function(key) {
				return target[key] = source[key];
			});
		});
		return target;
	}
	function loadNativeModule(name) {
		var dirs = [
			"build/Release",
			"build/Debug",
			"prebuilds/".concat(process.platform, "-").concat(process.arch)
		];
		var relative = ["..", "."];
		var lastError;
		for (var _i = 0, dirs_1 = dirs; _i < dirs_1.length; _i++) {
			var d = dirs_1[_i];
			for (var _a = 0, relative_1 = relative; _a < relative_1.length; _a++) {
				var r = relative_1[_a];
				var dir = "".concat(r, "/").concat(d);
				try {
					return {
						dir,
						module: __require("".concat(dir, "/").concat(name, ".node"))
					};
				} catch (e) {
					lastError = e;
				}
			}
		}
		throw new Error("Failed to load native module: ".concat(name, ".node, checked: ").concat(dirs.join(", "), ": ").concat(lastError));
	}
}));
//#endregion
//#region ../../../../node_modules/.pnpm/node-pty@1.2.0-beta.15_patc_746f94784a9f92509fd9652247742bc3/node_modules/node-pty/lib/eventEmitter2.js
var require_eventEmitter2 = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Copyright (c) 2019, Microsoft Corporation (MIT License).
	*/
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.EventEmitter2 = void 0;
	exports.EventEmitter2 = function() {
		function EventEmitter2() {
			this._listeners = [];
		}
		Object.defineProperty(EventEmitter2.prototype, "event", {
			get: function() {
				var _this = this;
				if (!this._event) this._event = function(listener) {
					_this._listeners.push(listener);
					return { dispose: function() {
						for (var i = 0; i < _this._listeners.length; i++) if (_this._listeners[i] === listener) {
							_this._listeners.splice(i, 1);
							return;
						}
					} };
				};
				return this._event;
			},
			enumerable: false,
			configurable: true
		});
		EventEmitter2.prototype.fire = function(data) {
			var queue = [];
			for (var i = 0; i < this._listeners.length; i++) queue.push(this._listeners[i]);
			for (var i = 0; i < queue.length; i++) queue[i].call(void 0, data);
		};
		return EventEmitter2;
	}();
}));
//#endregion
//#region ../../../../node_modules/.pnpm/node-pty@1.2.0-beta.15_patc_746f94784a9f92509fd9652247742bc3/node_modules/node-pty/lib/terminal.js
var require_terminal = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Copyright (c) 2012-2015, Christopher Jeffrey (MIT License)
	* Copyright (c) 2016, Daniel Imms (MIT License).
	* Copyright (c) 2018, Microsoft Corporation (MIT License).
	*/
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.Terminal = exports.DEFAULT_ROWS = exports.DEFAULT_COLS = void 0;
	var events_1 = __require("events");
	var eventEmitter2_1 = require_eventEmitter2();
	exports.DEFAULT_COLS = 80;
	exports.DEFAULT_ROWS = 24;
	/**
	* Default messages to indicate PAUSE/RESUME for automatic flow control.
	* To avoid conflicts with rebound XON/XOFF control codes (such as on-my-zsh),
	* the sequences can be customized in `IPtyForkOptions`.
	*/
	var FLOW_CONTROL_PAUSE = "";
	var FLOW_CONTROL_RESUME = "";
	exports.Terminal = function() {
		function Terminal(opt) {
			this._pid = 0;
			this._fd = 0;
			this._cols = 0;
			this._rows = 0;
			this._readable = false;
			this._writable = false;
			this._onData = new eventEmitter2_1.EventEmitter2();
			this._onExit = new eventEmitter2_1.EventEmitter2();
			this._internalee = new events_1.EventEmitter();
			this.handleFlowControl = !!(opt === null || opt === void 0 ? void 0 : opt.handleFlowControl);
			this._flowControlPause = (opt === null || opt === void 0 ? void 0 : opt.flowControlPause) || FLOW_CONTROL_PAUSE;
			this._flowControlResume = (opt === null || opt === void 0 ? void 0 : opt.flowControlResume) || FLOW_CONTROL_RESUME;
			if (!opt) return;
			this._checkType("name", opt.name ? opt.name : void 0, "string");
			this._checkType("cols", opt.cols ? opt.cols : void 0, "number");
			this._checkType("rows", opt.rows ? opt.rows : void 0, "number");
			this._checkType("cwd", opt.cwd ? opt.cwd : void 0, "string");
			this._checkType("env", opt.env ? opt.env : void 0, "object");
			this._checkType("uid", opt.uid ? opt.uid : void 0, "number");
			this._checkType("gid", opt.gid ? opt.gid : void 0, "number");
			this._checkType("encoding", opt.encoding ? opt.encoding : void 0, "string");
		}
		Object.defineProperty(Terminal.prototype, "onData", {
			get: function() {
				return this._onData.event;
			},
			enumerable: false,
			configurable: true
		});
		Object.defineProperty(Terminal.prototype, "onExit", {
			get: function() {
				return this._onExit.event;
			},
			enumerable: false,
			configurable: true
		});
		Object.defineProperty(Terminal.prototype, "pid", {
			get: function() {
				return this._pid;
			},
			enumerable: false,
			configurable: true
		});
		Object.defineProperty(Terminal.prototype, "cols", {
			get: function() {
				return this._cols;
			},
			enumerable: false,
			configurable: true
		});
		Object.defineProperty(Terminal.prototype, "rows", {
			get: function() {
				return this._rows;
			},
			enumerable: false,
			configurable: true
		});
		Terminal.prototype.write = function(data) {
			if (this.handleFlowControl) {
				if (data === this._flowControlPause) {
					this.pause();
					return;
				}
				if (data === this._flowControlResume) {
					this.resume();
					return;
				}
			}
			this._write(data);
		};
		Terminal.prototype._forwardEvents = function() {
			var _this = this;
			this.on("data", function(e) {
				return _this._onData.fire(e);
			});
			this.on("exit", function(exitCode, signal) {
				return _this._onExit.fire({
					exitCode,
					signal
				});
			});
		};
		Terminal.prototype._checkType = function(name, value, type, allowArray) {
			if (allowArray === void 0) allowArray = false;
			if (value === void 0) return;
			if (allowArray) {
				if (Array.isArray(value)) {
					value.forEach(function(v, i) {
						if (typeof v !== type) throw new Error("".concat(name, "[").concat(i, "] must be a ").concat(type, " (not a ").concat(typeof v[i], ")"));
					});
					return;
				}
			}
			if (typeof value !== type) throw new Error("".concat(name, " must be a ").concat(type, " (not a ").concat(typeof value, ")"));
		};
		/** See net.Socket.end */
		Terminal.prototype.end = function(data) {
			this._socket.end(data);
		};
		/** See stream.Readable.pipe */
		Terminal.prototype.pipe = function(dest, options) {
			return this._socket.pipe(dest, options);
		};
		/** See net.Socket.pause */
		Terminal.prototype.pause = function() {
			return this._socket.pause();
		};
		/** See net.Socket.resume */
		Terminal.prototype.resume = function() {
			return this._socket.resume();
		};
		/** See net.Socket.setEncoding */
		Terminal.prototype.setEncoding = function(encoding) {
			if (this._socket._decoder) delete this._socket._decoder;
			if (encoding) this._socket.setEncoding(encoding);
		};
		Terminal.prototype.addListener = function(eventName, listener) {
			this.on(eventName, listener);
		};
		Terminal.prototype.on = function(eventName, listener) {
			if (eventName === "close") {
				this._internalee.on("close", listener);
				return;
			}
			this._socket.on(eventName, listener);
		};
		Terminal.prototype.emit = function(eventName) {
			var args = [];
			for (var _i = 1; _i < arguments.length; _i++) args[_i - 1] = arguments[_i];
			if (eventName === "close") return this._internalee.emit.apply(this._internalee, arguments);
			return this._socket.emit.apply(this._socket, arguments);
		};
		Terminal.prototype.listeners = function(eventName) {
			return this._socket.listeners(eventName);
		};
		Terminal.prototype.removeListener = function(eventName, listener) {
			this._socket.removeListener(eventName, listener);
		};
		Terminal.prototype.removeAllListeners = function(eventName) {
			this._socket.removeAllListeners(eventName);
		};
		Terminal.prototype.once = function(eventName, listener) {
			this._socket.once(eventName, listener);
		};
		Terminal.prototype._close = function() {
			this._socket.readable = false;
			this.write = function() {};
			this.end = function() {};
			this._writable = false;
			this._readable = false;
		};
		Terminal.prototype._parseEnv = function(env) {
			var keys = Object.keys(env || {});
			var pairs = [];
			for (var i = 0; i < keys.length; i++) {
				if (keys[i] === void 0) continue;
				pairs.push(keys[i] + "=" + env[keys[i]]);
			}
			return pairs;
		};
		return Terminal;
	}();
}));
//#endregion
//#region ../../../../node_modules/.pnpm/node-pty@1.2.0-beta.15_patc_746f94784a9f92509fd9652247742bc3/node_modules/node-pty/lib/shared/conout.js
var require_conout = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Copyright (c) 2020, Microsoft Corporation (MIT License).
	*/
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.getWorkerPipeName = getWorkerPipeName;
	function getWorkerPipeName(conoutPipeName) {
		return "".concat(conoutPipeName, "-worker");
	}
}));
//#endregion
//#region ../../../../node_modules/.pnpm/node-pty@1.2.0-beta.15_patc_746f94784a9f92509fd9652247742bc3/node_modules/node-pty/lib/windowsConoutConnection.js
var require_windowsConoutConnection = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Copyright (c) 2020, Microsoft Corporation (MIT License).
	*/
	var __awaiter = exports && exports.__awaiter || function(thisArg, _arguments, P, generator) {
		function adopt(value) {
			return value instanceof P ? value : new P(function(resolve) {
				resolve(value);
			});
		}
		return new (P || (P = Promise))(function(resolve, reject) {
			function fulfilled(value) {
				try {
					step(generator.next(value));
				} catch (e) {
					reject(e);
				}
			}
			function rejected(value) {
				try {
					step(generator["throw"](value));
				} catch (e) {
					reject(e);
				}
			}
			function step(result) {
				result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
			}
			step((generator = generator.apply(thisArg, _arguments || [])).next());
		});
	};
	var __generator = exports && exports.__generator || function(thisArg, body) {
		var _ = {
			label: 0,
			sent: function() {
				if (t[0] & 1) throw t[1];
				return t[1];
			},
			trys: [],
			ops: []
		}, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
		return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() {
			return this;
		}), g;
		function verb(n) {
			return function(v) {
				return step([n, v]);
			};
		}
		function step(op) {
			if (f) throw new TypeError("Generator is already executing.");
			while (g && (g = 0, op[0] && (_ = 0)), _) try {
				if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
				if (y = 0, t) op = [op[0] & 2, t.value];
				switch (op[0]) {
					case 0:
					case 1:
						t = op;
						break;
					case 4:
						_.label++;
						return {
							value: op[1],
							done: false
						};
					case 5:
						_.label++;
						y = op[1];
						op = [0];
						continue;
					case 7:
						op = _.ops.pop();
						_.trys.pop();
						continue;
					default:
						if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) {
							_ = 0;
							continue;
						}
						if (op[0] === 3 && (!t || op[1] > t[0] && op[1] < t[3])) {
							_.label = op[1];
							break;
						}
						if (op[0] === 6 && _.label < t[1]) {
							_.label = t[1];
							t = op;
							break;
						}
						if (t && _.label < t[2]) {
							_.label = t[2];
							_.ops.push(op);
							break;
						}
						if (t[2]) _.ops.pop();
						_.trys.pop();
						continue;
				}
				op = body.call(thisArg, _);
			} catch (e) {
				op = [6, e];
				y = 0;
			} finally {
				f = t = 0;
			}
			if (op[0] & 5) throw op[1];
			return {
				value: op[0] ? op[1] : void 0,
				done: true
			};
		}
	};
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.ConoutConnection = void 0;
	var worker_threads_1 = __require("worker_threads");
	var conout_1 = require_conout();
	var path_1 = __require("path");
	var eventEmitter2_1 = require_eventEmitter2();
	/**
	* The amount of time to wait for additional data after the conpty shell process has exited before
	* shutting down the worker and sockets. The timer will be reset if a new data event comes in after
	* the timer has started.
	*/
	var FLUSH_DATA_INTERVAL = 1e3;
	exports.ConoutConnection = function() {
		function ConoutConnection(_conoutPipeName, _useConptyDll) {
			var _this = this;
			this._conoutPipeName = _conoutPipeName;
			this._useConptyDll = _useConptyDll;
			this._isDisposed = false;
			this._isReady = false;
			this._onReady = new eventEmitter2_1.EventEmitter2();
			this._onError = new eventEmitter2_1.EventEmitter2();
			var workerData = { conoutPipeName: _conoutPipeName };
			var scriptPath = __dirname.replace("node_modules.asar", "node_modules.asar.unpacked");
			this._worker = new worker_threads_1.Worker((0, path_1.join)(scriptPath, "worker/conoutSocketWorker.js"), { workerData });
			this._worker.on("message", function(message) {
				switch (message) {
					case 1:
						_this._isReady = true;
						_this._onReady.fire();
						return;
					default: console.warn("Unexpected ConoutWorkerMessage", message);
				}
			});
			this._worker.on("error", function(error) {
				if (!_this._isDisposed && !_this._isReady) _this._onError.fire(error);
			});
			this._worker.on("exit", function(code) {
				if (!_this._isDisposed && !_this._isReady) _this._onError.fire(new Error("Conout worker exited before connecting (code ".concat(code, ")")));
			});
		}
		Object.defineProperty(ConoutConnection.prototype, "onReady", {
			get: function() {
				return this._onReady.event;
			},
			enumerable: false,
			configurable: true
		});
		Object.defineProperty(ConoutConnection.prototype, "onError", {
			get: function() {
				return this._onError.event;
			},
			enumerable: false,
			configurable: true
		});
		ConoutConnection.prototype.dispose = function() {
			if (!this._useConptyDll && this._isDisposed) return;
			this._isDisposed = true;
			this._drainDataAndClose();
		};
		ConoutConnection.prototype.connectSocket = function(socket) {
			socket.connect((0, conout_1.getWorkerPipeName)(this._conoutPipeName));
		};
		ConoutConnection.prototype._drainDataAndClose = function() {
			var _this = this;
			if (this._drainTimeout) clearTimeout(this._drainTimeout);
			this._drainTimeout = setTimeout(function() {
				return _this._destroySocket();
			}, FLUSH_DATA_INTERVAL);
		};
		ConoutConnection.prototype._destroySocket = function() {
			return __awaiter(this, void 0, void 0, function() {
				return __generator(this, function(_a) {
					switch (_a.label) {
						case 0: return [4, this._worker.terminate()];
						case 1:
							_a.sent();
							return [2];
					}
				});
			});
		};
		return ConoutConnection;
	}();
}));
//#endregion
//#region ../../../../node_modules/.pnpm/node-pty@1.2.0-beta.15_patc_746f94784a9f92509fd9652247742bc3/node_modules/node-pty/lib/windowsPtyAgent.js
var require_windowsPtyAgent = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Copyright (c) 2012-2015, Christopher Jeffrey, Peter Sunde (MIT License)
	* Copyright (c) 2016, Daniel Imms (MIT License).
	* Copyright (c) 2018, Microsoft Corporation (MIT License).
	*/
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.WindowsPtyAgent = void 0;
	exports.argsToCommandLine = argsToCommandLine;
	var fs$1 = __require("fs");
	var path$1 = __require("path");
	var child_process_1 = __require("child_process");
	var net_1 = __require("net");
	var windowsConoutConnection_1 = require_windowsConoutConnection();
	var eventEmitter2_1 = require_eventEmitter2();
	var utils_1 = require_utils();
	var conptyNative;
	/**
	* The amount of time to wait for additional data after the conpty shell process has exited before
	* shutting down the socket. The timer will be reset if a new data event comes in after the timer
	* has started.
	*/
	var FLUSH_DATA_INTERVAL = 1e3;
	var defaultWindowsPtyAgentOptions = {
		connectionTimeout: 5e3,
		conoutConnectionFactory: function(conoutPipeName, useConptyDll) {
			return new windowsConoutConnection_1.ConoutConnection(conoutPipeName, useConptyDll);
		}
	};
	exports.WindowsPtyAgent = function() {
		function WindowsPtyAgent(file, args, env, cwd, cols, rows, debug, _useConptyDll, conptyInheritCursor, options) {
			if (_useConptyDll === void 0) _useConptyDll = false;
			if (conptyInheritCursor === void 0) conptyInheritCursor = false;
			if (options === void 0) options = defaultWindowsPtyAgentOptions;
			var _this = this;
			this._useConptyDll = _useConptyDll;
			this._innerPid = 0;
			this._onError = new eventEmitter2_1.EventEmitter2();
			if (!conptyNative) conptyNative = (0, utils_1.loadNativeModule)("conpty").module;
			this._ptyNative = conptyNative;
			cwd = path$1.resolve(cwd);
			var commandLine = argsToCommandLine(file, args);
			var term = conptyNative.startProcess(file, cols, rows, debug, this._generatePipeName(), conptyInheritCursor, this._useConptyDll);
			this._fd = term.fd;
			this._pty = term.pty;
			this._outSocket = new net_1.Socket();
			this._outSocket.setEncoding("utf8");
			this._conoutSocketWorker = options.conoutConnectionFactory(term.conout, this._useConptyDll);
			this._pendingPtyInfo = {
				pty: this._pty,
				commandLine,
				cwd,
				env
			};
			this._connectionTimeout = setTimeout(function() {
				_this._failPtyConnection(/* @__PURE__ */ new Error("Timed out waiting for ConPTY output worker"));
			}, options.connectionTimeout);
			this._conoutSocketWorker.onReady(function() {
				if (!_this._pendingPtyInfo) return;
				_this._clearConnectionTimeout();
				_this._conoutSocketWorker.connectSocket(_this._outSocket);
				_this._completePtyConnection();
			});
			this._conoutSocketWorker.onError(function(error) {
				return _this._failPtyConnection(error);
			});
			this._outSocket.on("connect", function() {
				_this._outSocket.emit("ready_datapipe");
			});
			var inSocketFD = fs$1.openSync(term.conin, "w");
			this._inSocket = new net_1.Socket({
				fd: inSocketFD,
				readable: false,
				writable: true
			});
			this._inSocket.setEncoding("utf8");
		}
		Object.defineProperty(WindowsPtyAgent.prototype, "onError", {
			get: function() {
				return this._onError.event;
			},
			enumerable: false,
			configurable: true
		});
		Object.defineProperty(WindowsPtyAgent.prototype, "inSocket", {
			get: function() {
				return this._inSocket;
			},
			enumerable: false,
			configurable: true
		});
		Object.defineProperty(WindowsPtyAgent.prototype, "outSocket", {
			get: function() {
				return this._outSocket;
			},
			enumerable: false,
			configurable: true
		});
		Object.defineProperty(WindowsPtyAgent.prototype, "fd", {
			get: function() {
				return this._fd;
			},
			enumerable: false,
			configurable: true
		});
		Object.defineProperty(WindowsPtyAgent.prototype, "innerPid", {
			get: function() {
				return this._innerPid;
			},
			enumerable: false,
			configurable: true
		});
		Object.defineProperty(WindowsPtyAgent.prototype, "pty", {
			get: function() {
				return this._pty;
			},
			enumerable: false,
			configurable: true
		});
		WindowsPtyAgent.prototype._completePtyConnection = function() {
			var _this = this;
			var _a;
			if (!this._pendingPtyInfo) return;
			this._clearConnectionTimeout();
			var _b = this._pendingPtyInfo, pty = _b.pty, commandLine = _b.commandLine, cwd = _b.cwd, env = _b.env;
			this._pendingPtyInfo = void 0;
			try {
				var connect = conptyNative.connect(pty, commandLine, cwd, env, this._useConptyDll, function(c) {
					return _this._$onProcessExit(c);
				});
				this._innerPid = connect.pid;
			} catch (err) {
				var code = (_a = /error code: (\d+)/.exec(err.message)) === null || _a === void 0 ? void 0 : _a[1];
				this._exitCode = code ? parseInt(code, 10) : -1;
				try {
					this._ptyNative.kill(this._pty, this._useConptyDll);
				} catch (_c) {}
				this._conoutSocketWorker.dispose();
				this._inSocket.destroy();
				this._outSocket.destroy();
				this._onError.fire(err);
			}
		};
		WindowsPtyAgent.prototype._failPtyConnection = function(error) {
			if (!this._pendingPtyInfo) return;
			this._clearConnectionTimeout();
			this._pendingPtyInfo = void 0;
			this._exitCode = -1;
			try {
				this._ptyNative.kill(this._pty, this._useConptyDll);
			} catch (_a) {}
			this._conoutSocketWorker.dispose();
			this._inSocket.destroy();
			this._outSocket.destroy();
			this._onError.fire(error);
		};
		WindowsPtyAgent.prototype._clearConnectionTimeout = function() {
			if (this._connectionTimeout) {
				clearTimeout(this._connectionTimeout);
				this._connectionTimeout = void 0;
			}
		};
		WindowsPtyAgent.prototype.resize = function(cols, rows) {
			if (this._exitCode !== void 0) throw new Error("Cannot resize a pty that has already exited");
			this._ptyNative.resize(this._pty, cols, rows, this._useConptyDll);
		};
		WindowsPtyAgent.prototype.clear = function() {
			this._ptyNative.clear(this._pty, this._useConptyDll);
		};
		WindowsPtyAgent.prototype.kill = function() {
			var _this = this;
			this._clearConnectionTimeout();
			this._pendingPtyInfo = void 0;
			if (!this._useConptyDll) {
				this._inSocket.readable = false;
				this._outSocket.readable = false;
				this._getConsoleProcessList().then(function(consoleProcessList) {
					consoleProcessList.forEach(function(pid) {
						try {
							process.kill(pid);
						} catch (e) {}
					});
				});
				this._ptyNative.kill(this._pty, this._useConptyDll);
				this._conoutSocketWorker.dispose();
			} else {
				this._inSocket.destroy();
				this._ptyNative.kill(this._pty, this._useConptyDll);
				this._outSocket.on("data", function() {
					_this._conoutSocketWorker.dispose();
				});
			}
		};
		WindowsPtyAgent.prototype._getConsoleProcessList = function() {
			var _this = this;
			if (this._innerPid <= 0) return Promise.resolve([]);
			return new Promise(function(resolve) {
				var agent = (0, child_process_1.fork)(path$1.join(__dirname, "conpty_console_list_agent"), [_this._innerPid.toString()]);
				agent.on("message", function(message) {
					clearTimeout(timeout);
					resolve(message.consoleProcessList);
				});
				var timeout = setTimeout(function() {
					agent.kill();
					resolve([_this._innerPid]);
				}, 5e3);
			});
		};
		Object.defineProperty(WindowsPtyAgent.prototype, "exitCode", {
			get: function() {
				return this._exitCode;
			},
			enumerable: false,
			configurable: true
		});
		WindowsPtyAgent.prototype._generatePipeName = function() {
			return "conpty-".concat(Math.random() * 1e7);
		};
		/**
		* Triggered from the native side when a contpy process exits.
		*/
		WindowsPtyAgent.prototype._$onProcessExit = function(exitCode) {
			var _this = this;
			this._exitCode = exitCode;
			if (!this._useConptyDll) {
				this._flushDataAndCleanUp();
				this._outSocket.on("data", function() {
					return _this._flushDataAndCleanUp();
				});
			}
		};
		WindowsPtyAgent.prototype._flushDataAndCleanUp = function() {
			var _this = this;
			if (this._useConptyDll) return;
			if (this._closeTimeout) clearTimeout(this._closeTimeout);
			this._closeTimeout = setTimeout(function() {
				return _this._cleanUpProcess();
			}, FLUSH_DATA_INTERVAL);
		};
		WindowsPtyAgent.prototype._cleanUpProcess = function() {
			if (this._useConptyDll) return;
			this._inSocket.readable = false;
			this._outSocket.readable = false;
			this._outSocket.destroy();
			this._inSocket.destroy();
			this._conoutSocketWorker.dispose();
		};
		return WindowsPtyAgent;
	}();
	function argsToCommandLine(file, args) {
		if (isCommandLine(args)) {
			if (args.length === 0) return file;
			return "".concat(argsToCommandLine(file, []), " ").concat(args);
		}
		var argv = [file];
		Array.prototype.push.apply(argv, args);
		var result = "";
		for (var argIndex = 0; argIndex < argv.length; argIndex++) {
			if (argIndex > 0) result += " ";
			var arg = argv[argIndex];
			var hasLopsidedEnclosingQuote = xOr(arg[0] !== "\"", arg[arg.length - 1] !== "\"");
			var hasNoEnclosingQuotes = arg[0] !== "\"" && arg[arg.length - 1] !== "\"";
			var quote = arg === "" || (arg.indexOf(" ") !== -1 || arg.indexOf("	") !== -1) && arg.length > 1 && (hasLopsidedEnclosingQuote || hasNoEnclosingQuotes);
			if (quote) result += "\"";
			var bsCount = 0;
			for (var i = 0; i < arg.length; i++) {
				var p = arg[i];
				if (p === "\\") bsCount++;
				else if (p === "\"") {
					result += repeatText("\\", bsCount * 2 + 1);
					result += "\"";
					bsCount = 0;
				} else {
					result += repeatText("\\", bsCount);
					bsCount = 0;
					result += p;
				}
			}
			if (quote) {
				result += repeatText("\\", bsCount * 2);
				result += "\"";
			} else result += repeatText("\\", bsCount);
		}
		return result;
	}
	function isCommandLine(args) {
		return typeof args === "string";
	}
	function repeatText(text, count) {
		var result = "";
		for (var i = 0; i < count; i++) result += text;
		return result;
	}
	function xOr(arg1, arg2) {
		return arg1 && !arg2 || !arg1 && arg2;
	}
}));
//#endregion
//#region ../../../../node_modules/.pnpm/node-pty@1.2.0-beta.15_patc_746f94784a9f92509fd9652247742bc3/node_modules/node-pty/lib/windowsTerminal.js
var require_windowsTerminal = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Copyright (c) 2012-2015, Christopher Jeffrey, Peter Sunde (MIT License)
	* Copyright (c) 2016, Daniel Imms (MIT License).
	* Copyright (c) 2018, Microsoft Corporation (MIT License).
	*/
	var __extends = exports && exports.__extends || (function() {
		var extendStatics = function(d, b) {
			extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d, b) {
				d.__proto__ = b;
			} || function(d, b) {
				for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p];
			};
			return extendStatics(d, b);
		};
		return function(d, b) {
			if (typeof b !== "function" && b !== null) throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
			extendStatics(d, b);
			function __() {
				this.constructor = d;
			}
			d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
		};
	})();
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.WindowsTerminal = void 0;
	var terminal_1 = require_terminal();
	var windowsPtyAgent_1 = require_windowsPtyAgent();
	var utils_1 = require_utils();
	var DEFAULT_FILE = "cmd.exe";
	var DEFAULT_NAME = "Windows Shell";
	exports.WindowsTerminal = function(_super) {
		__extends(WindowsTerminal, _super);
		function WindowsTerminal(file, args, opt) {
			var _this = _super.call(this, opt) || this;
			_this._checkType("args", args, "string", true);
			args = args || [];
			file = file || DEFAULT_FILE;
			opt = opt || {};
			opt.env = opt.env || process.env;
			if (opt.encoding) console.warn("Setting encoding on Windows is not supported");
			var env = (0, utils_1.assign)({}, opt.env);
			_this._cols = opt.cols || terminal_1.DEFAULT_COLS;
			_this._rows = opt.rows || terminal_1.DEFAULT_ROWS;
			var cwd = opt.cwd || process.cwd();
			var name = opt.name || env.TERM || DEFAULT_NAME;
			var parsedEnv = _this._parseEnv(env);
			_this._isReady = false;
			_this._deferreds = [];
			_this._agent = new windowsPtyAgent_1.WindowsPtyAgent(file, args, parsedEnv, cwd, _this._cols, _this._rows, false, opt.useConptyDll, opt.conptyInheritCursor);
			_this._socket = _this._agent.outSocket;
			_this._agent.onError(function() {
				_this._close();
				_this.emit("exit", _this._agent.exitCode);
			});
			_this._pid = _this._agent.innerPid;
			_this._fd = _this._agent.fd;
			_this._pty = _this._agent.pty;
			_this._socket.on("ready_datapipe", function() {
				_this._pid = _this._agent.innerPid;
				_this._socket.once("data", function() {
					if (!_this._isReady) {
						_this._isReady = true;
						_this._deferreds.forEach(function(fn) {
							fn.run();
						});
						_this._deferreds = [];
					}
				});
				_this._socket.on("error", function(err) {
					_this._close();
					if (err.code) {
						if (~err.code.indexOf("errno 5") || ~err.code.indexOf("EIO")) return;
					}
					if (_this.listeners("error").length < 2) throw err;
				});
				_this._socket.on("close", function() {
					_this.emit("exit", _this._agent.exitCode);
					_this._close();
				});
			});
			_this._file = file;
			_this._name = name;
			_this._readable = true;
			_this._writable = true;
			_this._forwardEvents();
			return _this;
		}
		WindowsTerminal.prototype._write = function(data) {
			this._defer(this._doWrite, data);
		};
		WindowsTerminal.prototype._doWrite = function(data) {
			this._agent.inSocket.write(data);
		};
		/**
		* openpty
		*/
		WindowsTerminal.open = function(options) {
			throw new Error("open() not supported on windows, use Fork() instead.");
		};
		/**
		* TTY
		*/
		WindowsTerminal.prototype.resize = function(cols, rows, pixelSize) {
			var _this = this;
			if (cols <= 0 || rows <= 0 || isNaN(cols) || isNaN(rows) || cols === Infinity || rows === Infinity) throw new Error("resizing must be done using positive cols and rows");
			this._deferNoArgs(function() {
				_this._agent.resize(cols, rows);
				_this._cols = cols;
				_this._rows = rows;
			});
		};
		WindowsTerminal.prototype.clear = function() {
			var _this = this;
			this._deferNoArgs(function() {
				_this._agent.clear();
			});
		};
		WindowsTerminal.prototype.destroy = function() {
			var _this = this;
			this._deferNoArgs(function() {
				_this.kill();
			});
		};
		WindowsTerminal.prototype.kill = function(signal) {
			var _this = this;
			this._deferNoArgs(function() {
				if (signal) throw new Error("Signals not supported on windows.");
				_this._close();
				_this._agent.kill();
			});
		};
		WindowsTerminal.prototype._deferNoArgs = function(deferredFn) {
			var _this = this;
			if (this._isReady) {
				deferredFn.call(this);
				return;
			}
			this._deferreds.push({ run: function() {
				return deferredFn.call(_this);
			} });
		};
		WindowsTerminal.prototype._defer = function(deferredFn, arg) {
			var _this = this;
			if (this._isReady) {
				deferredFn.call(this, arg);
				return;
			}
			this._deferreds.push({ run: function() {
				return deferredFn.call(_this, arg);
			} });
		};
		Object.defineProperty(WindowsTerminal.prototype, "process", {
			get: function() {
				return this._name;
			},
			enumerable: false,
			configurable: true
		});
		Object.defineProperty(WindowsTerminal.prototype, "master", {
			get: function() {
				throw new Error("master is not supported on Windows");
			},
			enumerable: false,
			configurable: true
		});
		Object.defineProperty(WindowsTerminal.prototype, "slave", {
			get: function() {
				throw new Error("slave is not supported on Windows");
			},
			enumerable: false,
			configurable: true
		});
		return WindowsTerminal;
	}(terminal_1.Terminal);
}));
//#endregion
//#region ../../../../node_modules/.pnpm/node-pty@1.2.0-beta.15_patc_746f94784a9f92509fd9652247742bc3/node_modules/node-pty/lib/unixTerminal.js
var require_unixTerminal = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __extends = exports && exports.__extends || (function() {
		var extendStatics = function(d, b) {
			extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d, b) {
				d.__proto__ = b;
			} || function(d, b) {
				for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p];
			};
			return extendStatics(d, b);
		};
		return function(d, b) {
			if (typeof b !== "function" && b !== null) throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
			extendStatics(d, b);
			function __() {
				this.constructor = d;
			}
			d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
		};
	})();
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.UnixTerminal = void 0;
	/**
	* Copyright (c) 2012-2015, Christopher Jeffrey (MIT License)
	* Copyright (c) 2016, Daniel Imms (MIT License).
	* Copyright (c) 2018, Microsoft Corporation (MIT License).
	*/
	var fs = __require("fs");
	var path = __require("path");
	var tty = __require("tty");
	var terminal_1 = require_terminal();
	var utils_1 = require_utils();
	var native = (0, utils_1.loadNativeModule)("pty");
	var pty = native.module;
	var helperPath = process.env.DSH_NODE_PTY_SPAWN_HELPER;
	if (helperPath) helperPath = path.resolve(helperPath);
	else {
		var executableSibling = process.execPath + "-spawn-helper";
		if (fs.existsSync(executableSibling)) helperPath = executableSibling;
		else {
			helperPath = native.dir + "/spawn-helper";
			helperPath = path.resolve(__dirname, helperPath);
			helperPath = helperPath.replace("app.asar", "app.asar.unpacked");
			helperPath = helperPath.replace("node_modules.asar", "node_modules.asar.unpacked");
		}
	}
	var DEFAULT_FILE = "sh";
	var DEFAULT_NAME = "xterm";
	var DESTROY_SOCKET_TIMEOUT_MS = 200;
	exports.UnixTerminal = function(_super) {
		__extends(UnixTerminal, _super);
		function UnixTerminal(file, args, opt) {
			var _a, _b;
			var _this = _super.call(this, opt) || this;
			_this._boundClose = false;
			_this._emittedClose = false;
			if (typeof args === "string") throw new Error("args as a string is not supported on unix.");
			args = args || [];
			file = file || DEFAULT_FILE;
			opt = opt || {};
			opt.env = opt.env || process.env;
			_this._cols = opt.cols || terminal_1.DEFAULT_COLS;
			_this._rows = opt.rows || terminal_1.DEFAULT_ROWS;
			var uid = (_a = opt.uid) !== null && _a !== void 0 ? _a : -1;
			var gid = (_b = opt.gid) !== null && _b !== void 0 ? _b : -1;
			var env = (0, utils_1.assign)({}, opt.env);
			if (opt.env === process.env) _this._sanitizeEnv(env);
			var cwd = opt.cwd || process.cwd();
			env.PWD = cwd;
			var name = opt.name || env.TERM || DEFAULT_NAME;
			env.TERM = name;
			var parsedEnv = _this._parseEnv(env);
			var encoding = opt.encoding === void 0 ? "utf8" : opt.encoding;
			var onexit = function(code, signal) {
				if (!_this._emittedClose) {
					if (_this._boundClose) return;
					_this._boundClose = true;
					var timeout_1 = setTimeout(function() {
						timeout_1 = null;
						_this._socket.destroy();
					}, DESTROY_SOCKET_TIMEOUT_MS);
					_this.once("close", function() {
						if (timeout_1 !== null) clearTimeout(timeout_1);
						_this.emit("exit", code, signal);
					});
					return;
				}
				_this.emit("exit", code, signal);
			};
			var term = pty.fork(file, args, parsedEnv, cwd, _this._cols, _this._rows, uid, gid, encoding === "utf8", helperPath, onexit);
			_this._socket = new tty.ReadStream(term.fd);
			if (encoding !== null) _this._socket.setEncoding(encoding);
			_this._writeStream = new CustomWriteStream(term.fd, encoding || void 0);
			_this._socket.on("error", function(err) {
				if (err.code) {
					if (~err.code.indexOf("EAGAIN")) return;
				}
				_this._close();
				if (!_this._emittedClose) {
					_this._emittedClose = true;
					_this.emit("close");
				}
				if (err.code) {
					if (~err.code.indexOf("errno 5") || ~err.code.indexOf("EIO")) return;
				}
				if (_this.listeners("error").length < 2) throw err;
			});
			_this._pid = term.pid;
			_this._fd = term.fd;
			_this._pty = term.pty;
			_this._file = file;
			_this._name = name;
			_this._readable = true;
			_this._writable = true;
			_this._socket.on("close", function() {
				if (_this._emittedClose) return;
				_this._emittedClose = true;
				_this._close();
				_this.emit("close");
			});
			_this._forwardEvents();
			return _this;
		}
		Object.defineProperty(UnixTerminal.prototype, "master", {
			get: function() {
				return this._master;
			},
			enumerable: false,
			configurable: true
		});
		Object.defineProperty(UnixTerminal.prototype, "slave", {
			get: function() {
				return this._slave;
			},
			enumerable: false,
			configurable: true
		});
		UnixTerminal.prototype._write = function(data) {
			this._writeStream.write(data);
		};
		Object.defineProperty(UnixTerminal.prototype, "fd", {
			get: function() {
				return this._fd;
			},
			enumerable: false,
			configurable: true
		});
		Object.defineProperty(UnixTerminal.prototype, "ptsName", {
			get: function() {
				return this._pty;
			},
			enumerable: false,
			configurable: true
		});
		/**
		* openpty
		*/
		UnixTerminal.open = function(opt) {
			var self = Object.create(UnixTerminal.prototype);
			opt = opt || {};
			if (arguments.length > 1) opt = {
				cols: arguments[1],
				rows: arguments[2]
			};
			var cols = opt.cols || terminal_1.DEFAULT_COLS;
			var rows = opt.rows || terminal_1.DEFAULT_ROWS;
			var encoding = opt.encoding === void 0 ? "utf8" : opt.encoding;
			var term = pty.open(cols, rows);
			self._master = new tty.ReadStream(term.master);
			if (encoding !== null) self._master.setEncoding(encoding);
			self._master.resume();
			self._slave = new tty.ReadStream(term.slave);
			if (encoding !== null) self._slave.setEncoding(encoding);
			self._slave.resume();
			self._socket = self._master;
			self._pid = -1;
			self._fd = term.master;
			self._pty = term.pty;
			self._file = process.argv[0] || "node";
			self._name = process.env.TERM || "";
			self._readable = true;
			self._writable = true;
			self._socket.on("error", function(err) {
				self._close();
				if (self.listeners("error").length < 2) throw err;
			});
			self._socket.on("close", function() {
				self._close();
			});
			return self;
		};
		UnixTerminal.prototype.destroy = function() {
			var _this = this;
			this._close();
			this._socket.once("close", function() {
				_this.kill("SIGHUP");
			});
			this._socket.destroy();
			this._writeStream.dispose();
		};
		UnixTerminal.prototype.kill = function(signal) {
			try {
				process.kill(this.pid, signal || "SIGHUP");
			} catch (e) {}
		};
		Object.defineProperty(UnixTerminal.prototype, "process", {
			/**
			* Gets the name of the process.
			*/
			get: function() {
				if (process.platform === "darwin") {
					var title = pty.process(this._fd);
					return title !== "kernel_task" && title !== "spawn_helper" ? title : this._file;
				}
				return pty.process(this._fd, this._pty) || this._file;
			},
			enumerable: false,
			configurable: true
		});
		/**
		* TTY
		*/
		UnixTerminal.prototype.resize = function(cols, rows, pixelSize) {
			var _a, _b;
			if (cols <= 0 || rows <= 0 || isNaN(cols) || isNaN(rows) || cols === Infinity || rows === Infinity) throw new Error("resizing must be done using positive cols and rows");
			var pixelWidth = (_a = pixelSize === null || pixelSize === void 0 ? void 0 : pixelSize.width) !== null && _a !== void 0 ? _a : 0;
			var pixelHeight = (_b = pixelSize === null || pixelSize === void 0 ? void 0 : pixelSize.height) !== null && _b !== void 0 ? _b : 0;
			pty.resize(this._fd, cols, rows, pixelWidth, pixelHeight);
			this._cols = cols;
			this._rows = rows;
		};
		UnixTerminal.prototype.clear = function() {};
		UnixTerminal.prototype._sanitizeEnv = function(env) {
			delete env["TMUX"];
			delete env["TMUX_PANE"];
			delete env["STY"];
			delete env["WINDOW"];
			delete env["WINDOWID"];
			delete env["TERMCAP"];
			delete env["COLUMNS"];
			delete env["LINES"];
		};
		return UnixTerminal;
	}(terminal_1.Terminal);
	/**
	* A custom write stream that writes directly to a file descriptor with proper
	* handling of backpressure and errors. This avoids some event loop exhaustion
	* issues that can occur when using the standard APIs in Node.
	*/
	var CustomWriteStream = function() {
		function CustomWriteStream(_fd, _encoding) {
			this._fd = _fd;
			this._encoding = _encoding;
			this._writeQueue = [];
		}
		CustomWriteStream.prototype.dispose = function() {
			clearImmediate(this._writeImmediate);
			this._writeImmediate = void 0;
		};
		CustomWriteStream.prototype.write = function(data) {
			var buffer = typeof data === "string" ? Buffer.from(data, this._encoding) : Buffer.from(data);
			if (buffer.byteLength !== 0) {
				this._writeQueue.push({
					buffer,
					offset: 0
				});
				if (this._writeQueue.length === 1) this._processWriteQueue();
			}
		};
		CustomWriteStream.prototype._processWriteQueue = function() {
			var _this = this;
			this._writeImmediate = void 0;
			if (this._writeQueue.length === 0) return;
			var task = this._writeQueue[0];
			fs.write(this._fd, task.buffer, task.offset, function(err, written) {
				if (err) {
					if ("code" in err && err.code === "EAGAIN") _this._writeImmediate = setImmediate(function() {
						return _this._processWriteQueue();
					});
					else {
						_this._writeQueue.length = 0;
						console.error("Unhandled pty write error", err);
					}
					return;
				}
				task.offset += written;
				if (task.offset >= task.buffer.byteLength) _this._writeQueue.shift();
				_this._processWriteQueue();
			});
		};
		return CustomWriteStream;
	}();
}));
//#endregion
//#region ../../../Core/subprocess/subprocess-local/src/managed-owner.ts
var import_lib = /* @__PURE__ */ __toESM((/* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Copyright (c) 2012-2015, Christopher Jeffrey, Peter Sunde (MIT License)
	* Copyright (c) 2016, Daniel Imms (MIT License).
	* Copyright (c) 2018, Microsoft Corporation (MIT License).
	*/
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.native = void 0;
	exports.spawn = spawn;
	var utils_1 = require_utils();
	var terminalCtor;
	if (process.platform === "win32") terminalCtor = require_windowsTerminal().WindowsTerminal;
	else terminalCtor = require_unixTerminal().UnixTerminal;
	/**
	* Forks a process as a pseudoterminal.
	* @param file The file to launch.
	* @param args The file's arguments as argv (string[]) or in a pre-escaped
	* CommandLine format (string). Note that the CommandLine option is only
	* available on Windows and is expected to be escaped properly.
	* @param options The options of the terminal.
	* @throws When the file passed to spawn with does not exists.
	* @see CommandLineToArgvW https://msdn.microsoft.com/en-us/library/windows/desktop/bb776391(v=vs.85).aspx
	* @see Parsing C++ Comamnd-Line Arguments https://msdn.microsoft.com/en-us/library/17w5ykft.aspx
	* @see GetCommandLine https://msdn.microsoft.com/en-us/library/windows/desktop/ms683156.aspx
	*/
	function spawn(file, args, opt) {
		return new terminalCtor(file, args, opt);
	}
	/**
	* Expose the native API when not Windows, note that this is not public API and
	* could be removed at any time.
	*/
	exports.native = process.platform !== "win32" ? (0, utils_1.loadNativeModule)("pty").module : null;
})))(), 1);
/**
* Apply an optional abort bound to one shared wait promise.
* @param pending - managed-range wait shared by all callers.
* @param signal - optional caller cancellation signal.
* @returns whether the managed-range wait completed before cancellation.
*/
async function waitWithAbort(pending, signal) {
	if (signal?.aborted) {
		pending.catch(() => {});
		return false;
	}
	if (signal === void 0) {
		await pending;
		return true;
	}
	const aborted = Promise.withResolvers();
	const onAbort = () => {
		aborted.resolve(false);
	};
	signal.addEventListener("abort", onAbort, { once: true });
	try {
		return await Promise.race([pending.then(() => true), aborted.promise]);
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
}
//#endregion
//#region ../../../../node_modules/.pnpm/koffi@3.1.1/node_modules/koffi/src/koffi/src/static.js
const require$1 = createRequire(import.meta.url);
function loadStatic(pkg) {
	let native = null;
	if (pkg == "linux-arm64") try {
		native = require$1("@koromix/koffi-linux-arm64");
	} catch (err) {}
	if (pkg == "linux-ia32") try {
		native = require$1("@koromix/koffi-linux-ia32");
	} catch (err) {}
	if (pkg == "linux-x64") try {
		native = require$1("@koromix/koffi-linux-x64");
	} catch (err) {}
	if (pkg == "linux-riscv64") try {
		native = require$1("@koromix/koffi-linux-riscv64");
	} catch (err) {}
	if (pkg == "freebsd-ia32") try {
		native = require$1("@koromix/koffi-freebsd-ia32");
	} catch (err) {}
	if (pkg == "freebsd-x64") try {
		native = require$1("@koromix/koffi-freebsd-x64");
	} catch (err) {}
	if (pkg == "freebsd-arm64") try {
		native = require$1("@koromix/koffi-freebsd-arm64");
	} catch (err) {}
	if (pkg == "openbsd-ia32") try {
		native = require$1("@koromix/koffi-openbsd-ia32");
	} catch (err) {}
	if (pkg == "openbsd-x64") try {
		native = require$1("@koromix/koffi-openbsd-x64");
	} catch (err) {}
	if (pkg == "win32-ia32") try {
		native = require$1("@koromix/koffi-win32-ia32");
	} catch (err) {}
	if (pkg == "win32-x64") try {
		native = require$1("@koromix/koffi-win32-x64");
	} catch (err) {}
	if (pkg == "win32-arm64") try {
		native = require$1("@koromix/koffi-win32-arm64");
	} catch (err) {}
	if (pkg == "darwin-x64") try {
		native = require$1("@koromix/koffi-darwin-x64");
	} catch (err) {}
	if (pkg == "darwin-arm64") try {
		native = require$1("@koromix/koffi-darwin-arm64");
	} catch (err) {}
	if (pkg == "linux-loong64") try {
		native = require$1("@koromix/koffi-linux-loong64");
	} catch (err) {}
	return native;
}
//#endregion
//#region ../../../../node_modules/.pnpm/koffi@3.1.1/node_modules/koffi/src/koffi/index.js
function determineAbi() {
	let abi = process.arch.toString();
	if (abi == "riscv32" || abi == "riscv64") switch (decodeElfHeader(readFileHeader(process.execPath, 512)).e_flags & 6) {
		case 0: break;
		case 2:
			abi += "f";
			break;
		case 4:
			abi += "d";
			break;
		case 6:
			abi += "q";
			break;
	}
	else if (abi == "arm") {
		let header = decodeElfHeader(readFileHeader(process.execPath, 512));
		if (header.e_flags & 1024) abi += "hf";
		else if (header.e_flags & 512) abi += "sf";
		else throw new Error("Unknown ARM floating-point ABI");
	}
	return abi;
}
function readFileHeader(filename, read) {
	try {
		let fd2 = fs2.openSync(filename);
		let buf = Buffer.allocUnsafe(read);
		let len = fs2.readSync(fd2, buf);
		return buf.subarray(0, len);
	} finally {}
}
function decodeElfHeader(buf) {
	let header = {};
	if (buf.length < 16) throw new Error("Truncated header");
	if (buf[0] != 127 || buf[1] != 69 || buf[2] != 76 || buf[3] != 70) throw new Error("Invalid magic number");
	if (buf[6] != 1) throw new Error("Invalid ELF version");
	if (buf[5] != 1) throw new Error("Big-endian architectures are not supported");
	header.e_machine = buf.readUInt16LE(18);
	switch (buf[4]) {
		case 1:
			buf = buf.subarray(0, 68);
			if (buf.length < 68) throw new Error("Truncated ELF header");
			header.ei_class = 32;
			header.e_flags = buf.readUInt32LE(36);
			break;
		case 2:
			buf = buf.subarray(0, 120);
			if (buf.length < 120) throw new Error("Truncated ELF header");
			header.ei_class = 64;
			header.e_flags = buf.readUInt32LE(48);
			break;
		default: throw new Error("Invalid ELF class");
	}
	return header;
}
var package_default = {
	name: "koffi",
	version: "3.1.1",
	cnoke: {
		api: "../../vendor/node-api-headers",
		output: "../../bin/Koffi/{{ toolchain }}",
		node: 16,
		napi: 8
	}
};
var require2 = createRequire(import.meta.url);
function detectPlatform() {
	if (process.versions.napi == null || process.versions.napi < package_default.cnoke.napi) {
		let major = parseInt(process.versions.node, 10);
		throw new Error(`This engine is based on Node ${process.versions.node}, but ${package_default.name} does not support the Node ${major}.x branch (Node-API < ${package_default.cnoke.napi})`);
	}
	let abi = determineAbi();
	let pkg2 = `${process.platform}-${process.arch}`;
	let triplets2 = [`${process.platform}_${abi}`];
	if (process.platform == "linux") triplets2.push(`musl_${abi}`);
	return [
		package_default.version,
		pkg2,
		triplets2
	];
}
function loadDynamic(dirname, pkg2, triplets2) {
	let roots = [dirname + "/../../build/koffi"];
	let native2 = null;
	let err = null;
	if (process["resourcesPath"] != null) for (let suffix2 of [
		"/koffi",
		"/koffi/build",
		"/node_modules/koffi/build"
	]) roots.push(process["resourcesPath"] + suffix2);
	let names = [`${import.meta.dirname}/../../../@koromix/koffi-${pkg2}`, ...triplets2.flatMap((triplet) => roots.map((dir) => `${dir}/${triplet}/koffi.node`))];
	for (let name of names) {
		if (!fs2.existsSync(name)) continue;
		try {
			native2 = require2(name);
			break;
		} catch (e) {
			err ??= e;
		}
	}
	if (native2 == null && err != null) throw err;
	return native2;
}
function wrapNative(native2, version2) {
	if (native2 == null) throw new Error("Cannot find the native Koffi module; did you bundle it correctly?");
	if (native2.version != version2) throw new Error("Mismatched native Koffi modules");
	let load = native2.load;
	let register = native2.register;
	let introspect = native2.introspect ?? native2.type;
	native2.sizeof = (spec) => introspect(spec).size;
	native2.alignof = (spec) => introspect(spec).alignment;
	native2.offsetof = (spec, name) => {
		let info = introspect(spec);
		if (info.primitive != "Record") throw new TypeError("The offsetof() function can only be used with record types");
		let member = info.members[name];
		if (member == null) throw new Error(`Record type ${info.name} does not have member '${name}'`);
		return member.offset;
	};
	native2.register = (...args) => {
		if (args.length >= 3 && typeof args[1] == "function") {
			process.emitWarning("Using koffi.register() with a custom this value was deprecated in Koffi 2.17, use function.bind() instead", "DeprecationWarning", "KOFFI009");
			args[1] = args[1].bind(args[0]);
			args = args.slice(1);
		}
		return register(...args);
	};
	native2.load = (...args) => {
		let lib = load(...args);
		lib.cdecl = util.deprecate((...args2) => lib.func("__cdecl", ...args2), "The koffi.cdecl() function was deprecated in Koffi 2.7, use koffi.func(...) instead", "KOFFI003");
		lib.stdcall = util.deprecate((...args2) => lib.func("__stdcall", ...args2), "The koffi.stdcall() function was deprecated in Koffi 2.7, use koffi.func(\"__stdcall\", ...) instead", "KOFFI004");
		lib.fastcall = util.deprecate((...args2) => lib.func("__fastcall", ...args2), "The koffi.fastcall() function was deprecated in Koffi 2.7, use koffi.func(\"__fastcall\", ...) instead", "KOFFI005");
		lib.thiscall = util.deprecate((...args2) => lib.func("__thiscall", ...args2), "The koffi.thiscall() function was deprecated in Koffi 2.7, use koffi.func(\"__thiscall\", ...) instead", "KOFFI006");
		return lib;
	};
	if (native2.introspect == null) {
		native2.resolve = util.deprecate(native2.type, "The koffi.resolve() function was deprecated in Koffi 3.0, use koffi.type() instead", "KOFFI007");
		native2.introspect = util.deprecate(native2.type, "The koffi.introspect() function was deprecated in Koffi 3.0, use koffi.type() instead", "KOFFI008");
	} else native2.resolve = native2.type;
}
var [version, pkg, triplets] = detectPlatform();
var native = loadStatic(pkg) ?? loadDynamic(import.meta.dirname, pkg, triplets);
wrapNative(native, version);
native.LibraryHandle;
native.TypeObject;
native.Union;
native.address;
native.alias;
native.alignof;
native.alloc;
native.array;
native.as;
native.call;
native.config;
native.decode;
native.disposable;
native.encode;
native.enumeration;
native.errno;
native.extension;
native.free;
native.in;
native.inout;
native.introspect;
native.load;
native.node;
native.offsetof;
native.opaque;
native.os;
native.out;
native.pack;
native.pointer;
native.proto;
native.register;
native.reset;
native.resolve;
native.sizeof;
native.stats;
native.struct;
native.type;
native.types;
native.union;
native.unregister;
native.version;
native.view;
var index_default = native;
//#endregion
//#region ../../../Core/subprocess/subprocess-local/src/windows-inspector.ts
/**
* Windows process-table operations for terminal readiness, signalling, and
* teardown: Toolhelp32 snapshot enumeration with GetProcessTimes creation-time
* identity and process-handle wait-state liveness, the shell pid as a pseudo
* process group (Windows has no POSIX groups), and taskkill tree signalling.
* The koffi bindings load lazily so
* non-Windows processes never touch Win32 libraries; all decision logic takes
* an injectable internals boundary so suites can pin it on any host.
* @module dsh-subprocess-local/windows-inspector
*/
/**
* Walk a process table from one root in children-first order, retaining only
* members whose start identity is readable (unreadable members are detector
* misses, exactly like an unreadable `/proc` entry on Linux).
* @param entries - the process table snapshot.
* @param rootPid - the tree root to descend from.
* @param started - creation-time identity resolver for one member.
* @returns the root and its current transitive descendants, children first.
*/
function windowsProcessTree(entries, rootPid, started) {
	const root = new Map(entries.map((entry) => [entry.pid, entry])).get(rootPid);
	if (root === void 0) return [];
	const byParent = /* @__PURE__ */ new Map();
	for (const entry of entries) {
		const children = byParent.get(entry.parentPid) ?? [];
		children.push(entry);
		byParent.set(entry.parentPid, children);
	}
	const visited = /* @__PURE__ */ new Set();
	const result = [];
	const visit = (entry) => {
		if (visited.has(entry.pid)) return;
		visited.add(entry.pid);
		for (const child of byParent.get(entry.pid) ?? []) visit(child);
		const identity = started(entry.pid);
		if (identity !== void 0) result.push({
			pid: entry.pid,
			started: identity
		});
	};
	visit(root);
	return result;
}
/**
* Windows {@link ProcessInspector}. The shell pid stands in for a foreground
* process group: it is a stable pseudo-group that lets the prompt-marker
* readiness path compare foreground identities, while every actual signal
* targets the console-wide tree through taskkill (SIGINT is delivered by the
* terminal handle as a `\x03` input write and never reaches this layer).
*/
var WindowsProcessInspector = class {
	internals;
	constructor(internals = defaultWindowsProcessInternals()) {
		this.internals = internals;
	}
	foregroundPgid(shellPid) {
		return shellPid;
	}
	isStdinWaiting(_pgid, _shellPid) {
		return false;
	}
	isAlive(identity) {
		const state = this.internals.processState(identity.pid);
		return state?.active === true && state.started === identity.started;
	}
	snapshot() {
		let entries;
		return {
			tree: (rootPid) => windowsProcessTree(entries ??= this.internals.snapshot(), rootPid, (pid) => this.internals.processState(pid)?.started),
			session: () => [],
			alive: (identity) => this.isAlive(identity)
		};
	}
	signalGroup(pgid, signal) {
		this.internals.taskkill(pgid, signal === "SIGKILL");
	}
	signalProcess(identity, signal) {
		if (this.isAlive(identity)) this.internals.taskkill(identity.pid, signal === "SIGKILL");
	}
};
/**
* Create the Windows process inspector.
* @param internals - injectable process operations; defaults to the koffi-backed table.
* @returns the Windows inspector.
*/
function createWindowsProcessInspector(internals = defaultWindowsProcessInternals()) {
	return new WindowsProcessInspector(internals);
}
/** Terminate one Windows process tree with taskkill, contained like POSIX group signalling. */
function taskkillTree(pid, force) {
	if (pid <= 0) return;
	spawnSync("taskkill", [
		"/PID",
		String(pid),
		"/T",
		...force ? ["/F"] : []
	], {
		stdio: "ignore",
		windowsHide: true
	});
}
/**
* True for NULL and INVALID_HANDLE_VALUE returns from Win32 handle APIs.
* @param value - a handle as koffi may hand it back (pointer, null, or 0n).
* @returns whether the value signals an invalid handle.
*/
function isInvalidHandle(value) {
	if (value === null || value === void 0) return true;
	const asBigInt = value;
	return asBigInt === 0n || asBigInt === 18446744073709551615n || asBigInt === -1n;
}
const PVOID$1 = index_default.pointer("void");
/**
* Resolve the koffi Win32 struct types once. Registration is lazy and cached
* because koffi's type registry is global per process: test runners that
* re-evaluate this module (a hoisted `vi.mock` re-imports the graph) must not
* re-register the names.
*/
function win32Structs() {
	if (cachedStructs !== void 0) return cachedStructs;
	const PROCESSENTRY32W = index_default.struct("PROCESSENTRY32W", {
		dwSize: "uint32",
		cntUsage: "uint32",
		th32ProcessID: "uint32",
		th32DefaultHeapID: PVOID$1,
		th32ModuleID: "uint32",
		cCntThreads: "uint32",
		th32ParentProcessID: "uint32",
		pcPriClassBase: "int32",
		dwFlags: "uint32",
		szExeFile: index_default.array("char16", 260)
	});
	const FILETIME = index_default.struct("FILETIME", {
		dwLowDateTime: "uint32",
		dwHighDateTime: "uint32"
	});
	/* v8 ignore start -- a layout-mismatch guard fires only on ABI breakage; the windows-native suites exercise the real struct. */
	if (PROCESSENTRY32W.size !== 568) throw new Error(`PROCESSENTRY32W layout mismatch: koffi computed ${PROCESSENTRY32W.size}, Windows headers say 568`);
	/* v8 ignore stop */
	cachedStructs = {
		PROCESSENTRY32W,
		FILETIME
	};
	return cachedStructs;
}
let cachedStructs;
const TH32CS_SNAPPROCESS = 2;
const WAIT_OBJECT_0 = 0;
const WAIT_TIMEOUT = 258;
let cachedBindings;
/**
* Resolve the lazy Win32 bindings (throws the first binding failure, fail-closed).
* @returns the cached binding table.
*/
function win32Bindings() {
	if (cachedBindings !== void 0) return cachedBindings;
	const { PROCESSENTRY32W, FILETIME } = win32Structs();
	const kernel32 = index_default.load("kernel32.dll");
	const bind = (name, result, args) => kernel32.func("__stdcall", name, result, args);
	cachedBindings = {
		createToolhelp32Snapshot: bind("CreateToolhelp32Snapshot", PVOID$1, ["uint32", "uint32"]),
		process32FirstW: bind("Process32FirstW", "int", [PVOID$1, index_default.pointer(PROCESSENTRY32W)]),
		process32NextW: bind("Process32NextW", "int", [PVOID$1, index_default.pointer(PROCESSENTRY32W)]),
		openProcess: bind("OpenProcess", PVOID$1, [
			"uint32",
			"int",
			"uint32"
		]),
		getProcessTimes: bind("GetProcessTimes", "int", [
			PVOID$1,
			index_default.pointer(FILETIME),
			index_default.pointer(FILETIME),
			index_default.pointer(FILETIME),
			index_default.pointer(FILETIME)
		]),
		waitForSingleObject: bind("WaitForSingleObject", "uint32", [PVOID$1, "uint32"]),
		closeHandle: bind("CloseHandle", "int", [PVOID$1])
	};
	return cachedBindings;
}
/**
* Allocate koffi memory as a branded {@link NativePtr}; koffi's TS types are
* `any`, so the cast goes through `unknown` to keep the unsafe surface here.
* @param type - the koffi type to allocate.
* @param count - element count.
* @returns the branded allocation pointer.
*/
function allocNative(type, count) {
	return index_default.alloc(type, count);
}
/** Enumerate the current process table through Toolhelp32. */
function snapshotWindowsProcesses(bindings) {
	const { PROCESSENTRY32W } = win32Structs();
	const snapshot = bindings.createToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
	/* v8 ignore next -- an invalid snapshot for the process flag is not producible through the public API;
	the guard mirrors POSIX's unreadable-proc tolerance and isInvalidHandle is unit-tested. */
	if (isInvalidHandle(snapshot)) return [];
	const entries = [];
	try {
		const entry = allocNative(PROCESSENTRY32W, 1);
		index_default.encode(entry, "uint32", PROCESSENTRY32W.size);
		let ok = bindings.process32FirstW(snapshot, entry);
		while (ok !== 0) {
			const record = index_default.decode(entry, PROCESSENTRY32W);
			entries.push({
				pid: record.th32ProcessID,
				parentPid: record.th32ParentProcessID
			});
			ok = bindings.process32NextW(snapshot, entry);
		}
	} finally {
		bindings.closeHandle(snapshot);
	}
	return entries;
}
/** Read one process's creation identity and current wait state. */
function windowsProcessState(bindings, pid) {
	const { FILETIME } = win32Structs();
	const handle = bindings.openProcess(1052672, 0, pid);
	if (isInvalidHandle(handle)) return void 0;
	try {
		const creation = allocNative(FILETIME, 1);
		const exit = allocNative(FILETIME, 1);
		const kernel = allocNative(FILETIME, 1);
		const user = allocNative(FILETIME, 1);
		/* v8 ignore next -- a GetProcessTimes failure after a successful open races process exit and
		cannot be staged deterministically; the absent-process path is covered and the caller
		treats undefined as a detector miss. */
		if (bindings.getProcessTimes(handle, creation, exit, kernel, user) === 0) return void 0;
		const record = index_default.decode(creation, FILETIME);
		const wait = bindings.waitForSingleObject(handle, 0);
		/* v8 ignore next -- an opened process handle has exactly one of these two
		zero-time wait states; an unexpected Win32 failure is an unreadable process. */
		if (wait !== WAIT_OBJECT_0 && wait !== WAIT_TIMEOUT) return void 0;
		return {
			started: `${record.dwHighDateTime}:${record.dwLowDateTime}`,
			active: wait === WAIT_TIMEOUT
		};
	} finally {
		bindings.closeHandle(handle);
	}
}
/** The koffi-backed default internals; bindings resolve lazily on first use. */
function defaultWindowsProcessInternals() {
	return {
		snapshot: () => snapshotWindowsProcesses(win32Bindings()),
		processState: (pid) => windowsProcessState(win32Bindings(), pid),
		taskkill: taskkillTree
	};
}
//#endregion
//#region ../../../Core/subprocess/subprocess-local/src/process-inspector.ts
/** Platform process-table inspection for terminal readiness, signals, and teardown. */
/* v8 ignore start -- thin OS bindings; injected logic is unit-tested and real platform composition exercises them. */
const DEFAULT_INTERNALS = {
	readFile: (path) => readFileSync(path, "utf8"),
	readDir: (path) => readdirSync(path),
	readLink: (path) => readlinkSync(path, "utf8"),
	stat: (path) => statSync(path),
	open: (path) => openSync(path, "r"),
	read: (fd, buffer, length, position) => readSync(fd, buffer, 0, length, position),
	close: closeSync,
	exec: (file, args) => execFileSync(file, args, { encoding: "utf8" }),
	kill: (pid, signal) => process.kill(pid, signal)
};
/**
* Parse fields used from Linux `/proc/<pid>/stat`, including parenthesized comm text.
* @param text - complete stat line.
* @returns Parsed identity/group fields, or undefined for malformed input.
*/
function parseProcStat(text) {
	const open = text.indexOf("(");
	const close = text.lastIndexOf(")");
	if (open <= 0 || close <= open) return void 0;
	const pid = Number(text.slice(0, open).trim());
	const rest = text.slice(close + 2).trim().split(/\s+/);
	const state = rest[0] || "";
	const parentPid = Number(rest[1]);
	const pgrp = Number(rest[2]);
	const session = Number(rest[3]);
	const ttyDevice = Number(rest[4]);
	const tpgid = Number(rest[5]);
	const started = rest[19];
	if (![
		pid,
		parentPid,
		pgrp,
		session,
		ttyDevice,
		tpgid
	].every(Number.isSafeInteger) || state.length !== 1 || started === void 0) return void 0;
	return {
		pid,
		parentPid,
		pgrp,
		session,
		state,
		ttyDevice,
		tpgid,
		started
	};
}
function readLinuxStat(internals, pid) {
	try {
		return parseProcStat(internals.readFile(`/proc/${pid}/stat`));
	} catch (_unreadableProcEntry) {
		return;
	}
}
function linuxDeviceNumber(value) {
	return value >>> 0;
}
function readLinuxTerminalDevice(internals, pid, ttyDevice, tid) {
	const terminalDevice = linuxDeviceNumber(ttyDevice);
	if (terminalDevice === 0) return void 0;
	const path = tid === void 0 ? `/proc/${pid}/fd/0` : `/proc/${pid}/task/${tid}/fd/0`;
	try {
		if (internals.readLink(path) === "/dev/tty") return terminalDevice;
		const status = internals.stat(path);
		return status.isCharacterDevice() && linuxDeviceNumber(status.rdev) === terminalDevice ? terminalDevice : void 0;
	} catch (_unreadableStdinDevice) {
		return;
	}
}
/**
* Report whether a Linux process group has an executing member. `false`
* means the group contains only zombie/dead entries; `undefined` means the
* process table could not prove either outcome.
* @param processGroupId - POSIX process-group id to inspect.
* @param internals - injectable process-table operations.
* @returns Live-member presence, or `undefined` when unavailable/absent.
*/
function linuxProcessGroupHasLiveMembers(processGroupId, internals = DEFAULT_INTERNALS) {
	let entries;
	try {
		entries = internals.readDir("/proc");
	} catch (_unreadableProcDirectory) {
		return;
	}
	let matched = false;
	for (const entry of entries) {
		if (!/^\d+$/.test(entry)) continue;
		const stat = readLinuxStat(internals, Number(entry));
		if (stat?.pgrp !== processGroupId) continue;
		matched = true;
		if (!/^[ZXx]$/.test(stat.state)) return true;
	}
	return matched ? false : void 0;
}
function numericEntries(internals, path) {
	try {
		return internals.readDir(path).filter((entry) => /^\d+$/.test(entry)).map(Number);
	} catch (_unreadableProcDirectory) {
		return [];
	}
}
function readSyscall(internals, pid, tid) {
	try {
		const text = internals.readFile(`/proc/${pid}/task/${tid}/syscall`).trim();
		if (text === "running" || text.startsWith("-1 ")) return void 0;
		const fields = text.split(/\s+/);
		const number = Number(fields[0]);
		const args = fields.slice(1, 7).map((field) => Number.parseInt(field, 16));
		if (!Number.isSafeInteger(number) || args.some((value) => !Number.isSafeInteger(value))) return void 0;
		return {
			number,
			args
		};
	} catch (_unreadableSyscall) {
		return;
	}
}
function readMemory(internals, pid, address, length) {
	let fd;
	try {
		fd = internals.open(`/proc/${pid}/mem`);
		const buffer = Buffer.alloc(length);
		const count = internals.read(fd, buffer, length, address);
		return buffer.subarray(0, count);
	} catch (_unreadableProcessMemory) {
		return;
	} finally {
		if (fd !== void 0) internals.close(fd);
	}
}
function fdSetHasStdin(internals, pid, address) {
	return address !== 0 && (readMemory(internals, pid, address, 8)?.[0] ?? 0) % 2 === 1;
}
function pollHasStdin(internals, pid, address, count) {
	if (address === 0 || count <= 0) return false;
	const memory = readMemory(internals, pid, address, Math.min(count, 1024) * 8);
	if (memory === void 0) return false;
	for (let offset = 0; offset + 8 <= memory.length; offset += 8) if (memory.readInt32LE(offset) === 0 && (memory.readInt16LE(offset + 4) & 1) !== 0) return true;
	return false;
}
function epollHasStdin(internals, pid, tid, epfd) {
	try {
		return internals.readFile(`/proc/${pid}/task/${tid}/fdinfo/${epfd}`).split("\n").some((line) => /^tfd:\s+0\b/.test(line.trim()));
	} catch (_unreadableFdInfo) {
		return false;
	}
}
const SYSCALLS = {
	x64: {
		read: 0,
		select: 23,
		pselect: 270,
		poll: 7,
		ppoll: 271,
		epollWait: 232,
		epollPwait: 281
	},
	arm64: {
		read: 63,
		pselect: 72,
		ppoll: 73,
		epollPwait: 22
	}
};
const SUPPORTED_SYSCALL_TABLES = Object.values(SYSCALLS);
function linuxSyscallTables(arch) {
	const primary = SYSCALLS[arch];
	if (primary === void 0) return void 0;
	return [primary, ...SUPPORTED_SYSCALL_TABLES.filter((table) => table !== primary)];
}
function syscallWaitsOnStdin(internals, pid, tid, syscall, tables) {
	const [a0 = 0, a1 = 0, a2 = 0] = syscall.args;
	for (const table of tables) {
		if (syscall.number === table.read) return a0 === 0;
		if (syscall.number === table.select || syscall.number === table.pselect) return a0 >= 1 && fdSetHasStdin(internals, pid, a1);
		if (syscall.number === table.poll || syscall.number === table.ppoll) return a1 >= 1 && pollHasStdin(internals, pid, a0, a1);
		if (syscall.number === table.epollWait || syscall.number === table.epollPwait) return a2 >= 1 && epollHasStdin(internals, pid, tid, a0);
	}
	return false;
}
var PosixProcessInspector = class {
	internals;
	constructor(internals) {
		this.internals = internals;
	}
	signalGroup(pgid, signal) {
		this.internals.kill(-pgid, signal);
	}
	signalProcess(identity, signal) {
		if (this.isAlive(identity)) this.internals.kill(identity.pid, signal);
	}
};
function quiescent(state) {
	return state !== void 0 && /^[ZXx]$/.test(state);
}
var PosixProcessSnapshot = class {
	rows;
	byPid;
	constructor(rows) {
		this.rows = rows;
		this.byPid = new Map(rows.map((row) => [row.pid, row]));
	}
	tree(rootPid) {
		return processTree(this.rows, rootPid);
	}
	session(sessionId) {
		return this.rows.flatMap((row) => row.session === sessionId ? [{
			pid: row.pid,
			started: row.started
		}] : []);
	}
	alive(identity) {
		const row = this.byPid.get(identity.pid);
		return row?.started === identity.started && !quiescent(row.state);
	}
};
function processTree(entries, rootPid) {
	const root = new Map(entries.map((entry) => [entry.pid, entry])).get(rootPid);
	if (root === void 0) return [];
	const byParent = /* @__PURE__ */ new Map();
	for (const entry of entries) {
		const children = byParent.get(entry.parentPid) ?? [];
		children.push(entry);
		byParent.set(entry.parentPid, children);
	}
	const visited = /* @__PURE__ */ new Set();
	const result = [];
	const visit = (entry) => {
		if (visited.has(entry.pid)) return;
		visited.add(entry.pid);
		for (const child of byParent.get(entry.pid) ?? []) visit(child);
		result.push({
			pid: entry.pid,
			started: entry.started
		});
	};
	visit(root);
	return result;
}
var LinuxProcessInspector = class extends PosixProcessInspector {
	arch;
	constructor(arch, internals) {
		super(internals);
		this.arch = arch;
	}
	foregroundPgid(shellPid) {
		const tpgid = readLinuxStat(this.internals, shellPid)?.tpgid;
		return tpgid !== void 0 && tpgid > 0 ? tpgid : void 0;
	}
	isStdinWaiting(pgid, shellPid) {
		const tables = linuxSyscallTables(this.arch);
		if (tables === void 0) return false;
		const shell = readLinuxStat(this.internals, shellPid);
		if (shell === void 0) return false;
		const terminalDevice = readLinuxTerminalDevice(this.internals, shellPid, shell.ttyDevice);
		if (terminalDevice === void 0) return false;
		for (const pid of numericEntries(this.internals, "/proc")) {
			const process = readLinuxStat(this.internals, pid);
			if (process?.pgrp !== pgid) continue;
			for (const tid of numericEntries(this.internals, `/proc/${pid}/task`)) {
				const syscall = readSyscall(this.internals, pid, tid);
				if (syscall !== void 0 && syscallWaitsOnStdin(this.internals, pid, tid, syscall, tables) && readLinuxTerminalDevice(this.internals, pid, process.ttyDevice, tid) === terminalDevice) return true;
			}
		}
		return false;
	}
	isAlive(identity) {
		const stat = readLinuxStat(this.internals, identity.pid);
		return stat?.started === identity.started && !quiescent(stat.state);
	}
	snapshot() {
		return new PosixProcessSnapshot(numericEntries(this.internals, "/proc").flatMap((pid) => {
			const stat = readLinuxStat(this.internals, pid);
			return stat === void 0 ? [] : [{
				pid,
				parentPid: stat.parentPid,
				started: stat.started,
				session: stat.session,
				state: stat.state
			}];
		}));
	}
};
function macProcessTable(internals) {
	return internals.exec("/bin/ps", ["-axo", "pid=,ppid=,lstart="]).split("\n").flatMap((line) => {
		const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
		if (match?.[1] === void 0 || match[2] === void 0 || match[3] === void 0) return [];
		return [{
			pid: Number(match[1]),
			parentPid: Number(match[2]),
			started: match[3],
			session: void 0,
			state: void 0
		}];
	});
}
var MacProcessInspector = class extends PosixProcessInspector {
	foregroundPgid(shellPid) {
		try {
			const value = Number(this.internals.exec("/bin/ps", [
				"-o",
				"tpgid=",
				"-p",
				String(shellPid)
			]).trim());
			return Number.isSafeInteger(value) && value > 0 ? value : void 0;
		} catch (_missingProcess) {
			return;
		}
	}
	isStdinWaiting(_pgid, _shellPid) {
		return false;
	}
	isAlive(identity) {
		return macProcessTable(this.internals).some((entry) => entry.pid === identity.pid && entry.started === identity.started);
	}
	snapshot() {
		return new PosixProcessSnapshot(macProcessTable(this.internals));
	}
};
/**
* Create the supported platform inspector or fail at plugin load.
* @param platform - target Node platform.
* @param arch - target CPU architecture for Linux syscall numbers.
* @param internals - filesystem/process boundary, injectable for deterministic tests.
* @returns Platform process inspector.
*/
function createProcessInspector(platform = process.platform, arch = process.arch, internals = DEFAULT_INTERNALS) {
	if (platform === "linux") return new LinuxProcessInspector(arch, internals);
	if (platform === "darwin") return new MacProcessInspector(internals);
	if (platform === "win32") return createWindowsProcessInspector();
	throw new Error(`subprocess-local: terminal inspection is unsupported on platform ${platform}`);
}
//#endregion
//#region ../../../Core/subprocess/subprocess-local/src/spawn.ts
/**
* Process plumbing for the local subprocess service: ordinary process launch
* with per-stream stdio dispositions, tail-keep collection with spill
* files, provider-owned range signalling, and common termination scheduling.
* POSIX owners stage TERM before KILL; Windows owners terminate immediately.
* This layer reacts to an abort signal; callers own deadlines, teardown
* ladders, and cause classification.
* @module dsh-subprocess-local/spawn
*/
/**
* Build a child environment: explicit caller entries override the scrubbed
* parent base using the target platform's environment-key semantics. A string
* deliberately restores or overrides an entry; an explicit `undefined`
* tombstone removes an ordinary ambient entry.
* @param extra - explicit caller entries and tombstones, merged after the scrub.
* @returns the environment to hand to `spawn` for the child process.
*/
function childEnv(extra) {
	const env = scrubbedParentEnv();
	if (process.platform !== "win32") return {
		...env,
		...extra
	};
	let entries = Object.entries(env);
	for (const [key, value] of Object.entries(extra ?? {})) {
		const normalized = key.toUpperCase();
		entries = entries.filter(([inherited]) => inherited.toUpperCase() !== normalized);
		entries.push([key, value]);
	}
	return Object.fromEntries(entries);
}
/**
* Materialize the selected scrub-overlay or complete-replacement child environment.
* @param spec - environment entries and the child environment policy.
* @returns the concrete child environment with undefined entries removed.
*/
function subprocessEnvironment(spec) {
	const environment = spec.envMode === "replace" ? spec.env ?? {} : childEnv(spec.env);
	return Object.fromEntries(Object.entries(environment).filter((entry) => entry[1] !== void 0));
}
/**
* Liveness-poll cadence for tree-exit waits. The timer stays ref'd: an
* awaited teardown must keep the event loop alive until the tree really
* exits, or the parent can exit while claiming quiescence and orphan the
* survivors it promised to reap.
*/
function sleepTick() {
	return setTimeout$1(15);
}
let spillCounter = 0;
let defaultSpillDir;
/**
* The default spill location: a private (0700) per-process directory under
* the OS tmpdir, created lazily. Predictable world-readable paths would let
* other local users read command output or pre-create symlinks. At a
* JavaScript-observable process exit the directory is removed only when it
* holds no completed spill file (spill files are retained as full-output
* recovery artifacts until an external cleanup).
*/
function privateSpillDir() {
	defaultSpillDir ??= mkdtempSync(join(tmpdir(), "dsh-subprocess-"));
	return defaultSpillDir;
}
/* v8 ignore next 4 -- exit listeners run after the coverage dump; removal is verified by the CI /tmp residue measurement. */
process.once("exit", () => {
	if (defaultSpillDir === void 0) return;
	try {
		rmdirSync(defaultSpillDir);
	} catch {}
});
/**
* Prepare fallible output storage before starting a managed native process.
* @param internals - optional caller-owned spill directory.
* @returns binding inputs whose spill directory is ready for use.
*/
function prepareManagedProcessBinding(internals = {}) {
	return { spillDir: internals.spillDir ?? privateSpillDir() };
}
/**
* Collects one stream with a bounded in-memory tail. With a spill cap, on
* first overflow a spill file is created and every chunk (including those
* already collected) is appended there while the full stream remains within
* the cap; without one, only the in-memory tail is ever retained (the
* diagnostic-tail shape — a language server's stderr).
*
* Tail-keep rationale (pi/OpenCode): errors and final results cluster at the
* end of command output; the spill file covers the head.
*/
var OutputCollector = class {
	maxBytes;
	maxSpillBytes;
	label;
	spillDir;
	chunks = [];
	bytes = 0;
	dropped = false;
	spillFd;
	spillFile;
	spillDisabled;
	/** Total bytes ever pushed (not just retained). */
	total = 0;
	constructor(maxBytes, maxSpillBytes, label, spillDir) {
		this.maxBytes = maxBytes;
		this.maxSpillBytes = maxSpillBytes;
		this.label = label;
		this.spillDir = spillDir;
		this.spillDisabled = maxSpillBytes === void 0;
	}
	/**
	* Ingest one stream chunk, counting it toward the whole-stream total. On
	* first overflow of the in-memory cap a spill file is opened (when spilling
	* is enabled) and every chunk (already-collected ones included) is appended
	* there from then on; the in-memory tail then drops whole chunks from its
	* head (or the head of a single over-cap chunk) until it fits the cap again.
	* @param chunk - the raw bytes from one stream 'data' event.
	*/
	push(chunk) {
		this.total += chunk.length;
		const overflows = this.bytes + chunk.length > this.maxBytes;
		if (!this.spillDisabled && (overflows || this.spillFd !== void 0)) this.spillAll(chunk);
		this.chunks.push(chunk);
		this.bytes += chunk.length;
		while (this.bytes > this.maxBytes) {
			const head = this.chunks[0];
			const excess = this.bytes - this.maxBytes;
			if (head.length <= excess) {
				this.chunks.shift();
				this.bytes -= head.length;
			} else {
				this.chunks[0] = head.subarray(excess);
				this.bytes -= excess;
			}
			this.dropped = true;
		}
	}
	/** Open the spill file lazily and append `chunk` (and any prior chunks once). */
	spillAll(chunk) {
		if (this.maxSpillBytes !== void 0 && this.total > this.maxSpillBytes) {
			this.discardSpill();
			return;
		}
		if (this.spillFd === void 0) {
			this.spillFile = join(this.spillDir, `dsh-subprocess-${process.pid}-${++spillCounter}-${randomBytes(6).toString("hex")}-${this.label}.log`);
			this.spillFd = openSync(this.spillFile, "wx", 384);
			for (const prior of this.chunks) writeSync(this.spillFd, prior);
		}
		writeSync(this.spillFd, chunk);
	}
	/** Stop spilling and remove the file once it can no longer hold the complete stream. */
	discardSpill() {
		const fd = this.spillFd;
		const file = this.spillFile;
		this.spillFd = void 0;
		this.spillFile = void 0;
		this.spillDisabled = true;
		if (fd !== void 0) try {
			closeSync(fd);
		} catch {
			this.spillFd = fd;
		}
		if (file !== void 0) try {
			unlinkSync(file);
		} catch {}
	}
	/**
	* Incremental read in whole-stream byte coordinates: returns everything
	* pushed since `fromByte`. When `fromByte` has already slid out of the
	* in-memory tail window, the read is `lossy` — it returns the whole
	* retained tail and the gap is only recoverable from the spill file.
	* @param fromByte - whole-stream offset to resume from (a prior read's `nextOffset`; 0 for the first read).
	* @returns the delta text, the offset for the next read, the `lossy` flag, and the spill path when one was created.
	*/
	readFrom(fromByte) {
		const windowStart = this.total - this.bytes;
		const buffer = Buffer.concat(this.chunks);
		const lossy = fromByte < windowStart;
		return {
			text: (lossy ? buffer : buffer.subarray(fromByte - windowStart)).toString("utf8"),
			nextOffset: this.total,
			lossy,
			...this.spillFile !== void 0 ? { spillPath: this.spillFile } : {}
		};
	}
	/**
	* Close the spill file once the stream has ended. A failed close (delayed
	* writeback fault) stops advertising the spill path — the file may be
	* missing its tail — while every in-memory read keeps working. Idempotent;
	* the spawn path seals both collectors at settlement so reads after exit
	* never point at a still-open file.
	*/
	seal() {
		if (this.spillFd === void 0) return;
		try {
			closeSync(this.spillFd);
		} catch {
			this.spillFile = void 0;
		}
		this.spillFd = void 0;
	}
	/**
	* Seal the spill file and return the final output.
	* @returns the final collected output: tail text, truncation flag, and the spill path when intact.
	*/
	finalize() {
		this.seal();
		return {
			text: Buffer.concat(this.chunks).toString("utf8"),
			truncated: this.dropped,
			...this.spillFile !== void 0 ? { spillPath: this.spillFile } : {}
		};
	}
};
/**
* Terminate one Windows process tree with `taskkill /T /F`. Contained like
* POSIX group signalling — delivery races tree exit, so an absent tree, a
* nonzero status, or a missing taskkill binary must not break idempotent
* teardown.
* @param pid - root process id, when the spawn published one.
*/
function taskkillProcessTree(pid) {
	if (pid === void 0 || pid <= 0) return;
	spawnSync("taskkill", [
		"/PID",
		String(pid),
		"/T",
		"/F"
	], {
		stdio: "ignore",
		windowsHide: true
	});
}
/**
* Signal a detached process tree with platform-correct semantics: POSIX
* signals the negative process-group id and falls back to the direct child
* when the group is gone; Windows terminates the tree via taskkill (any
* signal value force-terminates — Node maps signals to TerminateProcess).
*/
function signalTree(platform, pid, sig, child, taskkill) {
	/* v8 ignore next -- kill/terminate gate on treeAlive(), which is false without a pid; this guard protects direct callers only. */
	if (pid === void 0) return;
	if (platform === "win32") {
		taskkill(pid);
		return;
	}
	try {
		process.kill(-pid, sig);
	} catch {
		/* v8 ignore start -- the fallback needs a live child whose group signal fails
		(EPERM-style), which POSIX CI cannot stage; the swallow keeps teardown idempotent. */
		try {
			child.kill(sig);
		} catch {}
	}
}
/**
* Validate the synchronous portion of one ordinary spawn request.
* @param spec - exact target request.
* @throws when grace, cancellation, or argv is invalid before launch.
*/
function validateSubprocessSpec(spec) {
	if (!Number.isFinite(spec.graceMs) || spec.graceMs <= 0 || spec.graceMs > 2147483647) throw new Error(`subprocess graceMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
	if (spec.signal?.aborted) {
		let reason = "aborted";
		try {
			reason = String(spec.signal.reason ?? reason);
		} catch {}
		throw new Error(`aborted before spawn: ${reason}`);
	}
	const [program] = spec.argv;
	if (program === void 0 || program.length === 0) throw new Error("invalid argv: expected a non-empty program name at argv[0]");
}
function directChildResult(child) {
	return new Promise((resolve, reject) => {
		let completed = false;
		child.once("error", (error) => {
			/* v8 ignore next -- ChildProcess may report a later operational error after its
			terminal exit event; the first terminal event owns the result. */
			if (completed) return;
			completed = true;
			reject(error);
		});
		child.once("exit", (exitCode, signal) => {
			/* v8 ignore next -- a spawn/kill error may be followed by exit; a Promise can publish only the first terminal event. */
			if (completed) return;
			completed = true;
			resolve({
				exitCode,
				signal
			});
		});
	});
}
function fallbackOwner(platform, pid, child, taskkill, linuxGroupHasLiveMembers, direct) {
	let stopped = false;
	let directSettled = false;
	let observation;
	direct.then(() => {
		directSettled = true;
	}, () => {
		directSettled = true;
	});
	const alive = () => {
		if (stopped || pid === void 0) return false;
		if (platform === "win32") return child.exitCode === null && child.signalCode === null;
		try {
			process.kill(-pid, 0);
			if (directSettled && platform === "linux" && linuxGroupHasLiveMembers(pid) === false) return false;
			return true;
		} catch (error) {
			const code = error.code;
			if (code === "ESRCH") return false;
			/* v8 ignore start -- EPERM and non-POSIX negative-pid failures are platform defenses. */
			if (code === "EPERM") return true;
			return child.exitCode === null && child.signalCode === null;
		}
	};
	return {
		signal: (signal) => {
			if (!alive()) {
				stopped = true;
				return;
			}
			signalTree(platform, pid, signal, child, taskkill);
		},
		waitForExit: async () => {
			/* v8 ignore next -- bindManagedProcess memoizes this owner wait; the guard only
			protects direct internal re-entry after signal() observed absence. */
			if (stopped) return;
			observation ??= (async () => {
				while (alive()) await sleepTick();
				stopped = true;
			})();
			await observation;
		},
		terminateForHostExit: () => {
			if (stopped) return;
			signalTree(platform, pid, "SIGKILL", child, taskkill);
		}
	};
}
/**
* Bind platform launch facts to the existing stdio, outcome, abort, and termination lifecycle.
* @param spec - fully resolved argv, cwd, stdio, grace, cancellation, environment.
* @param launch - platform streams, direct outcome, and managed-range owner.
* @param internals - test-only spill-directory override.
* @returns live subprocess handle.
*/
function bindManagedProcess(spec, launch, internals = {}) {
	const { spillDir } = prepareManagedProcessBinding(internals);
	const { stdin, stdout, stderr } = launch;
	const isCollect = (mode) => mode !== "pipe" && mode !== "inherit";
	const outMode = spec.stdio.stdout;
	const errMode = spec.stdio.stderr;
	const stdinMode = spec.stdio.stdin;
	const collectStream = (mode, stream, label) => {
		if (!isCollect(mode) || stream === null) return void 0;
		const collector = new OutputCollector(mode.maxBytes, mode.spill?.maxBytes, label, spillDir);
		stream.on("data", (chunk) => {
			collector.push(chunk);
			mode.onData?.(chunk);
		});
		return collector;
	};
	const stdoutCollector = collectStream(outMode, stdout, "stdout");
	const stderrCollector = collectStream(errMode, stderr, "stderr");
	const observeOutputStream = (mode, stream) => {
		if (mode === "inherit" || stream === null || stream.readableEnded || stream.destroyed) return void 0;
		return new Promise((resolve) => {
			const settle = () => {
				stream.off("end", settle);
				stream.off("close", settle);
				stream.off("error", settle);
				resolve();
			};
			stream.once("end", settle);
			stream.once("close", settle);
			stream.once("error", settle);
		});
	};
	const stdoutClosed = observeOutputStream(outMode, stdout);
	const stderrClosed = observeOutputStream(errMode, stderr);
	const outputStreamsClosed = Promise.all([stdoutClosed, stderrClosed]);
	const stopCollectors = () => {
		if (stdoutCollector !== void 0) stdout?.destroy();
		if (stderrCollector !== void 0) stderr?.destroy();
		stdoutCollector?.seal();
		stderrCollector?.seal();
	};
	let graceTimer;
	let terminationStarted = false;
	let rangeExitObserved = false;
	let rangeExitObservation;
	let settled = false;
	const scheduleOwnerCleanup = () => {
		if (launch.owner.cleanup === void 0) return false;
		queueMicrotask(() => {
			done.finally(() => {
				launch.owner.cleanup?.();
			}).catch(() => {});
		});
		return true;
	};
	/**
	* Start or reuse the handle's managed-range exit observer. A failed read
	* before direct settlement can be retried. Once direct settlement permits
	* cleanup, retain a failed observation because removing its private evidence
	* must not turn a later wait into a false success. The first confirmed
	* absence is the permanent no-more-signals boundary and cancels pending
	* escalation before stale identity can be used.
	*/
	const observeRangeExit = () => {
		rangeExitObservation ??= (async () => {
			await launch.owner.waitForExit();
			rangeExitObserved = true;
			if (graceTimer !== void 0) clearTimeout(graceTimer);
			graceTimer = void 0;
			spec.signal?.removeEventListener("abort", onAbort);
			scheduleOwnerCleanup();
		})().catch((error) => {
			if (!settled || !scheduleOwnerCleanup()) rangeExitObservation = void 0;
			throw error;
		});
		return rangeExitObservation;
	};
	const kill = (sig, cancellationReason) => {
		if (rangeExitObserved) return;
		launch.owner.signal(sig, cancellationReason);
	};
	const terminateWithReason = (cancellationReason) => {
		if (rangeExitObserved || terminationStarted) return;
		terminationStarted = true;
		observeRangeExit().catch(() => {});
		kill("SIGTERM", cancellationReason);
		graceTimer = setTimeout(() => {
			graceTimer = void 0;
			kill("SIGKILL");
		}, spec.graceMs);
	};
	const terminate = () => {
		terminateWithReason(/* @__PURE__ */ new Error("subprocess terminated before target start"));
	};
	const terminateForHostExit = () => {
		launch.owner.terminateForHostExit();
	};
	const onAbort = () => {
		terminateWithReason(spec.signal?.reason);
	};
	spec.signal?.addEventListener("abort", onAbort, { once: true });
	if (typeof stdinMode === "object" && stdin !== null) {
		stdin.on("error", () => {});
		stdin.end(stdinMode.data);
	}
	const done = new Promise((resolve, reject) => {
		let pipeDrainTimer;
		const settle = (outcome) => {
			if (settled) return;
			settled = true;
			stopCollectors();
			cleanup();
			resolve(outcome);
		};
		const fail = (error) => {
			settled = true;
			terminate();
			stopCollectors();
			cleanup();
			reject(error);
		};
		launch.direct.then((outcome) => {
			if (stdoutClosed === void 0 && stderrClosed === void 0) {
				settle(outcome);
				return;
			}
			pipeDrainTimer = setTimeout(() => {
				settle(outcome);
			}, spec.graceMs);
			outputStreamsClosed.then(() => {
				settle(outcome);
			});
		}, fail);
		function cleanup() {
			if (pipeDrainTimer !== void 0) clearTimeout(pipeDrainTimer);
		}
	});
	const waitForExit = async (signal) => {
		if (rangeExitObserved) return true;
		return waitWithAbort(observeRangeExit(), signal);
	};
	return {
		/* v8 ignore start -- pipe-mode streams exist on every conforming launch;
		the null-coalesces guard an internal adapter defect only. */
		stdin: stdinMode === "pipe" ? stdin ?? void 0 : void 0,
		stdout: outMode === "pipe" ? stdout ?? void 0 : void 0,
		stderr: errMode === "pipe" ? stderr ?? void 0 : void 0,
		/* v8 ignore stop */
		collected: {
			...stdoutCollector !== void 0 ? { stdout: stdoutCollector } : {},
			...stderrCollector !== void 0 ? { stderr: stderrCollector } : {}
		},
		done,
		terminate,
		terminateForHostExit,
		waitForExit
	};
}
/**
* Spawn one detached PGID/taskkill fallback and bind the common lifecycle.
* @param spec - fully resolved argv, cwd, stdio, grace, cancellation, environment.
* @param internals - test-only spill-directory, platform, and taskkill overrides.
* @returns live subprocess handle.
*/
function spawnSubprocess(spec, internals = {}) {
	const binding = prepareManagedProcessBinding(internals);
	const platform = internals.platform ?? process.platform;
	const [program, ...args] = spec.argv;
	const child = (internals.spawn ?? spawn)(program, args, {
		cwd: spec.cwd,
		env: subprocessEnvironment(spec),
		stdio: [
			spec.stdio.stdin === "ignore" ? "ignore" : "pipe",
			spec.stdio.stdout === "inherit" ? "inherit" : "pipe",
			spec.stdio.stderr === "inherit" ? "inherit" : "pipe"
		],
		detached: platform !== "win32",
		windowsHide: platform === "win32"
	});
	const direct = directChildResult(child);
	const pid = child.pid;
	const owner = fallbackOwner(platform, pid, child, internals.taskkill ?? taskkillProcessTree, internals.linuxProcessGroupHasLiveMembers ?? linuxProcessGroupHasLiveMembers, direct);
	return bindManagedProcess(spec, {
		stdin: child.stdin,
		stdout: child.stdout,
		stderr: child.stderr,
		direct,
		owner
	}, binding);
}
//#endregion
//#region ../../../Core/subprocess/subprocess-local/src/linux-execve.ts
/** Lazy libc execve and descriptor bindings used by the one-shot Linux bootstrap. */
const STANDARD_FILE_DESCRIPTORS = [
	0,
	1,
	2
];
const F_GETFD = 1;
const F_SETFD = 2;
const FD_CLOEXEC = 1;
let cachedExecve;
function systemError(errno, syscall, path) {
	const uvError = -errno;
	const code = getSystemErrorName(uvError);
	const detail = getSystemErrorMessage(uvError);
	const subject = path === void 0 ? syscall : `${syscall} '${path}'`;
	const error = Object.assign(/* @__PURE__ */ new Error(`${code}: ${detail}, ${subject}`), {
		code,
		errno: uvError,
		syscall
	});
	return path === void 0 ? error : Object.assign(error, { path });
}
/**
* Load libc's execve and fcntl symbols on first use and retain the native bindings.
* @returns a process-replacing execve operation that throws Node-style errors on failure.
*/
function loadLinuxExecve() {
	if (cachedExecve !== void 0) return cachedExecve;
	const libc = index_default.load(null);
	const nativeExecve = libc.func("int execve(const char *pathname, const char **argv, const char **envp)");
	const nativeFcntl = libc.func("int fcntl(int fd, int cmd, int arg)");
	cachedExecve = (file, argv, env) => {
		for (const fd of STANDARD_FILE_DESCRIPTORS) {
			const flags = nativeFcntl(fd, F_GETFD, 0);
			if (flags === -1) throw systemError(index_default.errno(), "fcntl");
			if ((flags & FD_CLOEXEC) === 0) continue;
			if (nativeFcntl(fd, F_SETFD, flags & -2) === -1) throw systemError(index_default.errno(), "fcntl");
		}
		nativeExecve(file, [...argv, null], [...Object.entries(env).map(([key, value]) => `${key}=${value}`), null]);
		throw systemError(index_default.errno(), "execve", file);
	};
	return cachedExecve;
}
//#endregion
//#region ../../../Core/subprocess/subprocess-local/src/runner-protocol.ts
/** Closed private transports shared by the native subprocess runner. */
function isRecord$1(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function hasExactKeys(value, required, optional = []) {
	const allowed = new Set([...required, ...optional]);
	return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}
function isSerializedRunnerError(value) {
	if (!isRecord$1(value) || !hasExactKeys(value, ["name", "message"], [
		"code",
		"syscall",
		"path"
	])) return false;
	return typeof value.name === "string" && typeof value.message === "string" && (value.code === void 0 || typeof value.code === "string") && (value.syscall === void 0 || typeof value.syscall === "string") && (value.path === void 0 || typeof value.path === "string");
}
function parseErrorResult(value) {
	if (!hasExactKeys(value, ["type", "error"]) || !isSerializedRunnerError(value.error)) throw new Error("subprocess runner emitted an invalid error result");
	if (value.type !== "error") throw new Error("subprocess runner emitted an unknown error result");
	return {
		type: "error",
		error: value.error
	};
}
/**
* Create a private 0700 directory and one complete 0600 launch request.
* @param request - target cwd and complete environment for the bootstrap.
* @returns private paths owned by this launch.
*/
function createLinuxLaunchFiles(request) {
	const directory = mkdtempSync(join(tmpdir(), "dsh-subprocess-launch-"));
	const files = {
		directory,
		requestPath: join(directory, "launch-request.json"),
		startupErrorPath: join(directory, "startup-error.json")
	};
	try {
		chmodSync(directory, 448);
		writeFileSync(files.requestPath, JSON.stringify(request), {
			flag: "wx",
			mode: 384
		});
		return files;
	} catch (error) {
		cleanupLinuxLaunchFiles(files);
		throw error;
	}
}
/**
* Read the Linux pre-exec error, if the bootstrap published one.
* @param path - expected startup-error path.
* @returns the validated failure, or undefined when none was published.
*/
function readLinuxStartupError(path) {
	if (!existsSync(path)) return void 0;
	const value = JSON.parse(readFileSync(path, "utf8"));
	if (!isRecord$1(value)) throw new Error("subprocess runner emitted an invalid startup error");
	return parseErrorResult(value);
}
/**
* Strictly parse one of the two Windows direct-result branches.
* @param value - untrusted IPC payload.
* @returns validated direct-result message.
*/
function parseWindowsRunnerResult(value) {
	if (!isRecord$1(value) || typeof value.type !== "string") throw new Error("subprocess runner emitted an invalid Windows result");
	if (value.type === "error") return parseErrorResult(value);
	if (value.type === "target-exit") {
		const validExitCode = typeof value.exitCode === "number" && Number.isSafeInteger(value.exitCode) && value.exitCode >= 0;
		if (!hasExactKeys(value, ["type", "exitCode"]) || !validExitCode) throw new Error("subprocess runner emitted an invalid target-exit result");
		return {
			type: "target-exit",
			exitCode: value.exitCode
		};
	}
	throw new Error(`subprocess runner emitted an unknown Windows result: ${value.type}`);
}
/**
* Rebuild a Node-shaped Error from a strict runner record.
* @param serialized - validated bounded error fields.
* @returns reconstructed Error with supported Node fields.
*/
function deserializeRunnerError(serialized) {
	const error = new Error(serialized.message);
	error.name = serialized.name;
	return Object.assign(error, {
		...serialized.code === void 0 ? {} : { code: serialized.code },
		...serialized.syscall === void 0 ? {} : { syscall: serialized.syscall },
		...serialized.path === void 0 ? {} : { path: serialized.path }
	});
}
/**
* Best-effort removal of only the private paths created for this Linux spawn.
* @param files - exact private paths owned by this launch.
*/
function cleanupLinuxLaunchFiles(files) {
	try {
		if (lstatSync(files.directory).isSymbolicLink()) {
			unlinkSync(files.directory);
			return;
		}
		for (const path of [files.requestPath, files.startupErrorPath]) try {
			unlinkSync(path);
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		rmdirSync(files.directory);
	} catch {}
}
/** Job limit that terminates every member when the final Job handle closes. */
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 8192;
//#endregion
//#region ../../../Core/subprocess/win32-process/src/errors.ts
/** Win32 call failure with the exact API name and error code. */
var Win32Error = class extends Error {
	/** Win32 function whose checked result failed. */
	api;
	/** Exact GetLastError value or direct Win32 API error code. */
	win32Code;
	constructor(api, win32Code, detail) {
		super(`${api} failed (Win32 ${win32Code})${detail === void 0 ? "" : `: ${detail}`}`);
		this.name = "Win32Error";
		this.api = api;
		this.win32Code = win32Code;
	}
};
//#endregion
//#region ../../../Core/subprocess/win32-process/src/ffi.ts
/** Lazy Koffi bindings for generic Win32 process, stdio, and Job operations. */
const PVOID = index_default.pointer("void");
const PPVOID = index_default.pointer(PVOID);
/**
* Return whether a Koffi pointer represents NULL.
* @param value - pointer value returned by Koffi or a Win32 call.
* @returns true for null, undefined, or address zero.
*/
function isNullPtr(value) {
	return value === null || value === void 0 || value === 0n;
}
/** Koffi STARTUPINFOW layout. */
const STARTUPINFOW = index_default.struct("DSH_STARTUPINFOW", {
	cb: "uint32",
	lpReserved: "str16",
	lpDesktop: "str16",
	lpTitle: "str16",
	dwX: "uint32",
	dwY: "uint32",
	dwXSize: "uint32",
	dwYSize: "uint32",
	dwXCountChars: "uint32",
	dwYCountChars: "uint32",
	dwFillAttribute: "uint32",
	dwFlags: "uint32",
	wShowWindow: "uint16",
	cbReserved2: "uint16",
	lpReserved2: index_default.pointer("uint8"),
	hStdInput: PVOID,
	hStdOutput: PVOID,
	hStdError: PVOID
});
/** Koffi PROCESS_INFORMATION layout. */
const PROCESS_INFORMATION = index_default.struct("DSH_PROCESS_INFORMATION", {
	hProcess: PVOID,
	hThread: PVOID,
	dwProcessId: "uint32",
	dwThreadId: "uint32"
});
/* v8 ignore start -- ABI guards are pinned by native header probes. */
if (STARTUPINFOW.size !== 104) throw new Error(`STARTUPINFOW layout mismatch: koffi computed ${STARTUPINFOW.size}, expected 104`);
if (PROCESS_INFORMATION.size !== 24) throw new Error(`PROCESS_INFORMATION layout mismatch: koffi computed ${PROCESS_INFORMATION.size}, expected 24`);
let cachedContext;
let cached;
/* v8 ignore start -- exercised by native Windows ABI and sandbox jobs. */
function bindingContext() {
	if (cachedContext !== void 0) return cachedContext;
	const kernel32 = index_default.load("kernel32.dll");
	const advapi32 = index_default.load("advapi32.dll");
	const bind = (lib, name, result, args) => lib.func("__stdcall", name, result, args);
	cachedContext = {
		kernel32,
		advapi32,
		bind
	};
	return cachedContext;
}
function bindings() {
	if (cached !== void 0) return cached;
	const { kernel32, advapi32, bind } = bindingContext();
	const node = index_default.load(null);
	cached = {
		closeHandle: bind(kernel32, "CloseHandle", "int", [PVOID]),
		getLastError: bind(kernel32, "GetLastError", "uint32", []),
		formatMessageW: bind(kernel32, "FormatMessageW", "uint32", [
			"uint32",
			PVOID,
			"uint32",
			"uint32",
			PVOID,
			"uint32",
			PVOID
		]),
		createPipe: bind(kernel32, "CreatePipe", "int", [
			PPVOID,
			PPVOID,
			PVOID,
			"uint32"
		]),
		setHandleInformation: bind(kernel32, "SetHandleInformation", "int", [
			PVOID,
			"uint32",
			"uint32"
		]),
		createProcessAsUserW: bind(advapi32, "CreateProcessAsUserW", "int", [
			PVOID,
			"str16",
			"str16",
			PVOID,
			PVOID,
			"int",
			"uint32",
			PVOID,
			"str16",
			index_default.pointer(STARTUPINFOW),
			index_default.pointer(PROCESS_INFORMATION)
		]),
		createProcessW: bind(kernel32, "CreateProcessW", "int", [
			"str16",
			"str16",
			PVOID,
			PVOID,
			"int",
			"uint32",
			PVOID,
			"str16",
			index_default.pointer(STARTUPINFOW),
			index_default.pointer(PROCESS_INFORMATION)
		]),
		readFile: bind(kernel32, "ReadFile", "int", [
			PVOID,
			PVOID,
			"uint32",
			index_default.pointer("uint32"),
			PVOID
		]),
		peekNamedPipe: bind(kernel32, "PeekNamedPipe", "int", [
			PVOID,
			PVOID,
			"uint32",
			index_default.pointer("uint32"),
			index_default.pointer("uint32"),
			index_default.pointer("uint32")
		]),
		waitForSingleObject: bind(kernel32, "WaitForSingleObject", "uint32", [PVOID, "uint32"]),
		getExitCodeProcess: bind(kernel32, "GetExitCodeProcess", "int", [PVOID, index_default.pointer("uint32")]),
		createJobObjectW: bind(kernel32, "CreateJobObjectW", PVOID, [PVOID, "str16"]),
		setInformationJobObject: bind(kernel32, "SetInformationJobObject", "int", [
			PVOID,
			"int",
			PVOID,
			"uint32"
		]),
		queryInformationJobObject: bind(kernel32, "QueryInformationJobObject", "int", [
			PVOID,
			"int",
			PVOID,
			"uint32",
			PVOID
		]),
		assignProcessToJobObject: bind(kernel32, "AssignProcessToJobObject", "int", [PVOID, PVOID]),
		resumeThread: bind(kernel32, "ResumeThread", "uint32", [PVOID]),
		terminateProcess: bind(kernel32, "TerminateProcess", "int", [PVOID, "uint32"]),
		terminateJobObject: bind(kernel32, "TerminateJobObject", "int", [PVOID, "uint32"]),
		getStdHandle: bind(kernel32, "GetStdHandle", PVOID, ["int"]),
		uvGetOsfhandle: node.func("uv_get_osfhandle", PVOID, ["int"])
	};
	return cached;
}
/**
* Load the generic process binding table without policy-specific extensions.
* @returns shared Win32 process, stdio, and Job operations.
*/
function loadWin32ProcessBindings() {
	return bindings();
}
/* v8 ignore stop */
/**
* Format a Win32 error code through FormatMessageW.
* @param api - active binding table.
* @param win32Code - captured GetLastError value.
* @returns trimmed system message, or an empty string when unavailable.
*/
function errorText(api, win32Code) {
	const buffer = Buffer.alloc(1024);
	const length = api.formatMessageW(4608, null, win32Code, 0, buffer, buffer.length / 2, null);
	return length === 0 ? "" : buffer.subarray(0, length * 2).toString("utf16le").trim();
}
/**
* Throw the current GetLastError value.
* @param api - active binding table.
* @param name - failing Win32 operation.
* @param detail - optional operation context.
* @returns never; always throws Win32Error.
*/
function throwLastError(api, name, detail) {
	const win32Code = api.getLastError();
	throw new Win32Error(name, win32Code, detail ?? errorText(api, win32Code));
}
/**
* Throw an explicitly captured Win32 error code.
* @param api - active binding table.
* @param name - failing Win32 operation.
* @param win32Code - error captured before cleanup.
* @param detail - optional operation context.
* @returns never; always throws Win32Error.
*/
function throwWin32(api, name, win32Code, detail) {
	throw new Win32Error(name, win32Code, detail ?? errorText(api, win32Code));
}
//#endregion
//#region ../../../Core/subprocess/win32-process/src/process.ts
function createKillOnCloseJob(api) {
	const job = api.createJobObjectW(null, null);
	if (isNullPtr(job)) throwLastError(api, "CreateJobObjectW");
	const information = Buffer.alloc(144);
	information.writeUInt32LE(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, 16);
	if (api.setInformationJobObject(job, 9, information, information.length) === 0) {
		const win32Code = api.getLastError();
		api.closeHandle(job);
		throwWin32(api, "SetInformationJobObject", win32Code);
	}
	return job;
}
/**
* Verify that an unnamed kill-on-close Job can be created and released now.
* @param api - active binding table.
*/
function probeCurrentTokenJobSupport(api) {
	closeHandleChecked(api, createKillOnCloseJob(api), "current-token Job capability probe");
}
/**
* Close a caller-owned handle and report a labelled Win32 failure.
* @param api - active binding table.
* @param handle - handle to close.
* @param detail - lifecycle label for diagnostics.
*/
function closeHandleChecked(api, handle, detail) {
	if (api.closeHandle(handle) === 0) throwLastError(api, "CloseHandle", detail);
}
//#endregion
//#region ../../../Core/subprocess/subprocess-local/src/runner-launch.ts
/** The one private environment variable consumed before target state is restored. */
const SUBPROCESS_RUNNER_ENV = "DSH_SUBPROCESS_RUNNER";
/** Sentinel used by the packaged bootstrap for the Windows IPC runner. */
const WINDOWS_RUNNER_SELECTION = "windows";
const SOURCE_TSCONFIG_PATH = fileURLToPath(new URL("../../../../../tsconfig.base.json", import.meta.url));
const RUNNER_CONTROL_ENV_PREFIXES = ["NODE_", "TSX_"];
/**
* Resolve the source, built, or packaged entry that calls the same runner core.
* @returns executable and arguments for the active runtime form.
*/
function spawnRunnerInvocation() {
	if ("pkg" in process) return [process.execPath];
	/* v8 ignore next -- built-artifact smoke imports the emitted JavaScript runner entry;
	* source-unit coverage cannot change import.meta.url. */
	if (extname(fileURLToPath(import.meta.url)) !== ".ts") return [process.execPath, fileURLToPath(import.meta.resolve("@deepseek-ai/dsh-subprocess-local/runner"))];
	return [
		process.execPath,
		"--import",
		import.meta.resolve("tsx/esm"),
		fileURLToPath(new URL("./bin.ts", import.meta.url))
	];
}
/**
* Check the concrete runner executable and entry paths without executing a probe mode.
* @param invocation - resolved executable and runner-entry arguments.
* @returns whether every concrete executable or entry path is accessible.
*/
function runnerInvocationAvailable(invocation = spawnRunnerInvocation()) {
	try {
		if (isAbsolute(invocation[0])) accessSync(invocation[0], constants.X_OK);
		const entry = invocation.at(-1);
		if (entry !== void 0 && entry !== invocation[0] && isAbsolute(entry)) accessSync(entry, constants.R_OK);
		return true;
	} catch {
		return false;
	}
}
/**
* Build the bootstrap-safe environment; target overrides arrive through request/IPC.
* @param selection - private runner selector or Linux launch-request locator.
* @param invocation - resolved runner invocation whose source form needs the workspace paths map.
* @returns environment for the runner before target state is restored.
*/
function runnerEnvironment(selection, invocation) {
	const entry = invocation?.at(-1);
	const env = childEnv();
	for (const name of Object.keys(env)) {
		const normalized = name.toUpperCase();
		if (RUNNER_CONTROL_ENV_PREFIXES.some((prefix) => normalized.startsWith(prefix))) Reflect.deleteProperty(env, name);
	}
	return {
		...env,
		[SUBPROCESS_RUNNER_ENV]: selection,
		SYSTEMD_LOG_TARGET: "null",
		...entry?.endsWith(".ts") === true ? { TSX_TSCONFIG_PATH: SOURCE_TSCONFIG_PATH } : {}
	};
}
/**
* Build direct Linux target stdio, or isolated Windows runner stdio with IPC
* on fd 3 and target carriers on fd 4 through fd 6.
* @param spec - ordinary subprocess request whose stdio modes are preserved.
* @param ipc - whether to isolate the runner and add its private Node IPC descriptor.
* @param stdinCarrier - runner fd 4 carrier; Windows ignore passes an opened null-device fd.
* @returns child-process stdio options for the runner.
*/
function runnerStdio(spec, ipc, stdinCarrier = "pipe") {
	const targetStdio = [
		spec.stdio.stdin === "ignore" ? "ignore" : "pipe",
		spec.stdio.stdout === "inherit" ? "inherit" : "pipe",
		spec.stdio.stderr === "inherit" ? "inherit" : "pipe"
	];
	if (!ipc) return targetStdio;
	return [
		"ignore",
		"ignore",
		"ignore",
		"ipc",
		stdinCarrier,
		spec.stdio.stdout === "inherit" ? 1 : "pipe",
		spec.stdio.stderr === "inherit" ? 2 : "pipe"
	];
}
function throwNullByteError(property, value, argument) {
	const subject = argument ? `The argument '${property}'` : `The property '${property}'`;
	const error = /* @__PURE__ */ new TypeError(`${subject} must be a string without null bytes. Received ${inspect(value)}`);
	Object.assign(error, { code: "ERR_INVALID_ARG_VALUE" });
	throw error;
}
function validateNoNullByte(property, value, argument = false) {
	if (value.includes("\0")) throwNullByteError(property, value, argument);
}
/**
* Materialize and synchronously validate the final target environment.
* @param spec - final target argv, cwd, and environment overrides.
* @returns complete target environment after Node-equivalent validation.
*/
function targetEnvironment(spec) {
	spec.argv.forEach((value, index) => {
		validateNoNullByte(index === 0 ? "file" : `args[${String(index - 1)}]`, value, true);
	});
	validateNoNullByte("options.cwd", spec.cwd);
	const env = subprocessEnvironment(spec);
	for (const [key, value] of Object.entries(env)) {
		validateNoNullByte(`options.env['${key}']`, key);
		validateNoNullByte(`options.env['${key}']`, value);
	}
	return env;
}
//#endregion
//#region ../../../Core/subprocess/subprocess-local/src/linux-scope.ts
/** Linux user-systemd scope launch and managed-range ownership. */
const SYSTEMCTL_TIMEOUT_MS = 5e3;
const SCOPE_INITIAL_POLL_INTERVAL_MS = 50;
const MISSING_UNIT = /\bunit\b[^\r\n]*(?:could not be found|not found|not loaded)/iu;
function managerEnvironment() {
	const environment = childEnv({ LC_ALL: "C" });
	delete environment.SYSTEMD_LOG_TARGET;
	return environment;
}
function quietSystemdEnvironment() {
	return childEnv({
		LC_ALL: "C",
		SYSTEMD_LOG_TARGET: "null"
	});
}
function querySystemctl(command, args) {
	return new Promise((resolveResult) => {
		execFile(command, [...args], {
			encoding: "utf8",
			env: managerEnvironment(),
			timeout: SYSTEMCTL_TIMEOUT_MS
		}, (error, stdout, stderr) => {
			const code = error === null ? 0 : error.code;
			resolveResult({
				status: typeof code === "number" ? code : null,
				stdout,
				stderr,
				...error === null ? {} : { error }
			});
		});
	});
}
function unitStem(prefix) {
	return `${prefix}-${String(process.pid)}-${randomBytes(6).toString("hex")}`;
}
function sleepWithAbort(delayMs, signal) {
	return setTimeout$1(delayMs, void 0, { signal });
}
/**
* Confirm this exact runner entry and libc execve binding without a probe mode.
* @param internals - optional runner and libc-binding seams used by tests.
* @returns whether the bootstrap can enter the final target.
*/
function probeLinuxBootstrap(internals = {}) {
	try {
		(internals.loadLinuxExecve ?? loadLinuxExecve)();
		const invocation = internals.runnerInvocation ?? (internals.resolveRunnerInvocation ?? spawnRunnerInvocation)();
		return (internals.runnerAvailable ?? runnerInvocationAvailable)(invocation);
	} catch {
		return false;
	}
}
/**
* Confirm current literal-argv transient-scope support before selecting native launch.
* @param internals - optional systemd command seams used by tests.
* @returns whether the current user manager supports the required scope invocation.
*/
function probeLinuxScope(internals = {}) {
	const unitBase = unitStem("dsh-subprocess-probe");
	const result = (internals.spawnSync ?? spawnSync)(internals.systemdRun ?? "systemd-run", [
		"--user",
		"--scope",
		"--quiet",
		"--collect",
		"--expand-environment=no",
		`--unit=${unitBase}`,
		"--",
		internals.systemctl ?? "systemctl",
		"--user",
		"show",
		`${unitBase}.scope`,
		"--property=ActiveState",
		"--value"
	], {
		env: quietSystemdEnvironment(),
		stdio: "ignore",
		timeout: SYSTEMCTL_TIMEOUT_MS
	});
	return result.error === void 0 && result.status === 0;
}
/**
* Confirm that the current user manager remains reachable after a positive deep probe.
* @param internals - optional systemctl seam used by tests.
* @returns whether one lightweight manager query succeeds.
*/
function probeLinuxManager(internals = {}) {
	const result = (internals.spawnSync ?? spawnSync)(internals.systemctl ?? "systemctl", [
		"--user",
		"show",
		"--property=Version",
		"--value"
	], {
		env: managerEnvironment(),
		stdio: "ignore",
		timeout: SYSTEMCTL_TIMEOUT_MS
	});
	return result.error === void 0 && result.status === 0;
}
/**
* Re-check every Linux native prerequisite for one eligible spawn.
* @param internals - optional native capability seams used by tests.
* @returns whether the Linux native containment path is currently available.
*/
function probeLinuxNative(internals = {}) {
	return probeLinuxBootstrap(internals) && probeLinuxScope(internals);
}
var LinuxScopeStartup = class {
	files;
	kind;
	terminationSignals = /* @__PURE__ */ new Set();
	constructor(files, kind) {
		this.files = files;
		this.kind = kind;
	}
	resolveOutcome(outcome) {
		const startup = readLinuxStartupError(this.files.startupErrorPath);
		if (startup !== void 0) throw deserializeRunnerError(startup.error);
		if (existsSync(this.files.requestPath) && !(outcome.signal !== null && this.terminationSignals.has(outcome.signal))) throw new Error(`${this.kind} scope exited before its bootstrap consumed the launch request`);
		return outcome;
	}
};
var SystemdScopeOwner = class {
	unit;
	startup;
	direct;
	systemctl;
	runSync;
	query;
	sleep;
	establishment = "pending";
	stopped = false;
	terminationRequested = false;
	observation;
	killFailure;
	wakeGeneration = 0;
	wakeWaiter;
	constructor(unit, startup, direct, systemctl, runSync, query, sleep) {
		this.unit = unit;
		this.startup = startup;
		this.direct = direct;
		this.systemctl = systemctl;
		this.runSync = runSync;
		this.query = query;
		this.sleep = sleep;
	}
	signal(signal) {
		if (this.stopped) return;
		this.terminationRequested = true;
		if (this.direct.running()) this.startup.terminationSignals.add(signal);
		this.observeRequestConsumption();
		const directFallbackRequired = this.establishment === "pending";
		if (directFallbackRequired && this.direct.running()) this.direct.signal(signal);
		const result = this.runSync(this.systemctl, [
			"--user",
			"kill",
			"--kill-whom=all",
			`--signal=${signal}`,
			this.unit
		], {
			encoding: "utf8",
			env: managerEnvironment(),
			timeout: SYSTEMCTL_TIMEOUT_MS
		});
		this.wakeObservation();
		if (result.error === void 0 && result.status === 0) {
			if (signal === "SIGKILL") this.killFailure = void 0;
			return;
		}
		if (!directFallbackRequired && this.direct.running()) this.direct.signal(signal);
		if (signal === "SIGKILL") {
			const output = `${result.stdout}\n${result.stderr}`;
			if (!MISSING_UNIT.test(output)) this.killFailure = result.error ?? /* @__PURE__ */ new Error(`systemctl could not signal ${this.unit}: ${output.trim() || `exit ${String(result.status)}`}`);
		}
	}
	terminateForHostExit() {
		if (this.stopped) return;
		try {
			if (this.direct.running()) this.direct.signal("SIGKILL");
		} catch {}
		try {
			this.runSync(this.systemctl, [
				"--user",
				"kill",
				"--kill-whom=all",
				"--signal=SIGKILL",
				this.unit
			], {
				env: managerEnvironment(),
				stdio: "ignore",
				timeout: SYSTEMCTL_TIMEOUT_MS
			});
		} catch {}
	}
	observeRequestConsumption() {
		if (this.establishment === "pending" && !existsSync(this.startup.files.requestPath)) this.establishment = "established";
	}
	absentUnit() {
		this.observeRequestConsumption();
		if (this.establishment === "established") return false;
		if (!this.direct.running() && existsSync(this.startup.files.requestPath)) return false;
		if (this.killFailure !== void 0) throw this.killFailure;
		return true;
	}
	/**
	* Prove an active unit with no processes is the empty managed range rather
	* than a launch still placing its payload. systemd ends a scope only on the
	* populated-to-empty transition, so a payload killed before it entered the
	* cgroup leaves the unit active forever. Requested termination plus a
	* departed client makes that leftover conclusive: the client forked every
	* process it will ever fork.
	*/
	emptyRange(tasksCurrent) {
		return this.terminationRequested && tasksCurrent === 0 && !this.direct.running();
	}
	/** Release a leftover empty scope so the transient unit is collected and cannot accumulate. */
	releaseEmptyRange() {
		try {
			this.runSync(this.systemctl, [
				"--user",
				"stop",
				this.unit
			], {
				env: managerEnvironment(),
				stdio: "ignore",
				timeout: SYSTEMCTL_TIMEOUT_MS
			});
		} catch {}
	}
	parseUnitState(stdout) {
		const values = /* @__PURE__ */ new Map();
		for (const line of stdout.split(/\r?\n/u)) {
			if (line === "") continue;
			const separator = line.indexOf("=");
			if (separator <= 0) throw new Error(`systemctl returned malformed state for ${this.unit}: ${JSON.stringify(stdout.trim())}`);
			const name = line.slice(0, separator);
			if (values.has(name)) throw new Error(`systemctl returned duplicate ${name} for ${this.unit}`);
			values.set(name, line.slice(separator + 1));
		}
		const loadState = values.get("LoadState");
		const activeState = values.get("ActiveState");
		const reportedTasks = values.get("TasksCurrent");
		const tasksCurrent = reportedTasks === "[not set]" ? void 0 : reportedTasks;
		if (values.size !== (reportedTasks === void 0 ? 2 : 3) || loadState === void 0 || activeState === void 0) throw new Error(`systemctl returned incomplete state for ${this.unit}: ${JSON.stringify(stdout.trim())}`);
		if (tasksCurrent !== void 0 && !/^\d+$/u.test(tasksCurrent)) throw new Error(`systemctl returned a non-numeric TasksCurrent for ${this.unit}: ${JSON.stringify(tasksCurrent)}`);
		return {
			loadState,
			activeState,
			tasksCurrent: tasksCurrent === void 0 ? void 0 : Number(tasksCurrent)
		};
	}
	async rangeActive() {
		this.observeRequestConsumption();
		const result = await this.query(this.systemctl, [
			"--user",
			"show",
			this.unit,
			"--property=LoadState",
			"--property=ActiveState",
			"--property=TasksCurrent"
		]);
		const output = `${result.stdout}\n${result.stderr}`;
		if (result.status === 0) {
			const { loadState, activeState, tasksCurrent } = this.parseUnitState(result.stdout);
			if (loadState === "not-found" && activeState === "inactive") return this.absentUnit();
			if (loadState !== "loaded") throw new Error(`systemctl returned unknown state for ${this.unit}: ${JSON.stringify({
				loadState,
				activeState
			})}`);
			this.establishment = "established";
			if (activeState === "inactive" || activeState === "failed") return false;
			if (![
				"active",
				"activating",
				"reloading",
				"deactivating"
			].includes(activeState)) throw new Error(`systemctl returned unknown ActiveState for ${this.unit}: ${JSON.stringify(activeState)}`);
			if (this.killFailure !== void 0) throw this.killFailure;
			if (this.emptyRange(tasksCurrent)) {
				this.releaseEmptyRange();
				return false;
			}
			return true;
		}
		if (!MISSING_UNIT.test(output)) {
			if (result.error !== void 0) throw result.error;
			throw new Error(`systemctl could not read ${this.unit}: ${output.trim() || `exit ${String(result.status)}`}`);
		}
		return this.absentUnit();
	}
	wakeObservation() {
		this.wakeGeneration += 1;
		this.wakeWaiter?.resolve();
		this.wakeWaiter = void 0;
	}
	async waitForPoll(delayMs, generation) {
		if (generation !== this.wakeGeneration) return;
		const wake = Promise.withResolvers();
		const waiter = {
			generation,
			resolve: wake.resolve
		};
		const sleepController = new AbortController();
		this.wakeWaiter = waiter;
		try {
			await Promise.race([this.sleep(delayMs, sleepController.signal), wake.promise]);
		} finally {
			sleepController.abort();
			if (this.wakeWaiter === waiter) this.wakeWaiter = void 0;
		}
	}
	async waitForExit() {
		if (this.stopped) return;
		this.observation ??= (async () => {
			let pollIntervalMs = SCOPE_INITIAL_POLL_INTERVAL_MS;
			let generation = this.wakeGeneration;
			while (await this.rangeActive()) {
				await this.waitForPoll(pollIntervalMs, generation);
				generation = this.wakeGeneration;
				if (this.establishment === "established") pollIntervalMs = Math.min(pollIntervalMs * 2, SYSTEMCTL_TIMEOUT_MS);
			}
			this.stopped = true;
		})().catch((error) => {
			this.observation = void 0;
			throw error;
		});
		await this.observation;
	}
	cleanup() {
		cleanupLinuxLaunchFiles(this.startup.files);
	}
};
function scopeArgs(unitBase, invocation, argv) {
	return [
		"--user",
		"--scope",
		"--quiet",
		"--collect",
		"--expand-environment=no",
		`--unit=${unitBase}`,
		"--",
		...invocation,
		"--",
		...argv
	];
}
function directOutcome(child, startup) {
	return new Promise((resolveOutcome, rejectOutcome) => {
		let settled = false;
		child.once("error", (error) => {
			if (settled) return;
			settled = true;
			rejectOutcome(error);
		});
		child.once("exit", (exitCode, signal) => {
			if (settled) return;
			settled = true;
			try {
				resolveOutcome(startup.resolveOutcome({
					exitCode,
					signal
				}));
			} catch (error) {
				rejectOutcome(error instanceof Error ? error : new Error(String(error)));
			}
		});
	});
}
function signalChildGroup(child, signal) {
	try {
		process.kill(-child.pid, signal);
	} catch {
		try {
			child.kill(signal);
		} catch {}
	}
}
/**
* Prepare one Linux PTY scope using the same launch request and bootstrap core.
* @param spec - terminal target request.
* @param targetEnv - validated complete target environment.
* @param internals - optional runner and systemd seams used by tests.
* @returns invocation and ownership callbacks; requested termination preserves the observed signal even before bootstrap consumption.
*/
function prepareLinuxTerminalScope(spec, targetEnv, internals = {}) {
	const invocation = internals.runnerInvocation ?? spawnRunnerInvocation();
	const files = createLinuxLaunchFiles({
		cwd: spec.cwd,
		env: targetEnv
	});
	const startup = new LinuxScopeStartup(files, "terminal");
	const unitBase = unitStem("dsh-terminal");
	return {
		command: internals.systemdRun ?? "systemd-run",
		args: scopeArgs(unitBase, invocation, spec.argv),
		cwd: process.cwd(),
		env: runnerEnvironment(files.requestPath, invocation),
		bindOwner: (direct) => new SystemdScopeOwner(`${unitBase}.scope`, startup, direct, internals.systemctl ?? "systemctl", internals.spawnSync ?? spawnSync, internals.systemctlQuery ?? querySystemctl, internals.sleep ?? sleepWithAbort),
		resolveOutcome: (outcome) => startup.resolveOutcome(outcome),
		cleanup: () => {
			cleanupLinuxLaunchFiles(files);
		}
	};
}
/**
* Launch one ordinary target inside a transient user scope.
* @param spec - ordinary target request.
* @param targetEnv - validated complete target environment.
* @param internals - optional runner and systemd seams used by tests.
* @returns streams, result, and scope owner; requested termination preserves the observed signal even before bootstrap consumption.
*/
function launchLinuxScope(spec, targetEnv, internals = {}) {
	const invocation = internals.runnerInvocation ?? spawnRunnerInvocation();
	const files = createLinuxLaunchFiles({
		cwd: spec.cwd,
		env: targetEnv
	});
	const startup = new LinuxScopeStartup(files, "subprocess");
	const unitBase = unitStem("dsh-subprocess");
	let child;
	try {
		child = (internals.spawn ?? spawn)(internals.systemdRun ?? "systemd-run", scopeArgs(unitBase, invocation, spec.argv), {
			cwd: process.cwd(),
			env: runnerEnvironment(files.requestPath, invocation),
			stdio: runnerStdio(spec, false),
			detached: true
		});
	} catch (error) {
		cleanupLinuxLaunchFiles(files);
		throw error;
	}
	const owner = new SystemdScopeOwner(`${unitBase}.scope`, startup, {
		running: () => child.pid !== void 0 && child.exitCode === null && child.signalCode === null,
		signal: (signal) => {
			signalChildGroup(child, signal);
		}
	}, internals.systemctl ?? "systemctl", internals.spawnSync ?? spawnSync, internals.systemctlQuery ?? querySystemctl, internals.sleep ?? sleepWithAbort);
	return {
		stdin: child.stdin,
		stdout: child.stdout,
		stderr: child.stderr,
		direct: directOutcome(child, startup),
		owner
	};
}
//#endregion
//#region ../../../Core/subprocess/subprocess-local/src/windows-job.ts
/** Windows parent-side launch and ownership for the private Job runner. */
function isWindowsStartCancellationError(error) {
	return error.name === "Error" && error.message === "subprocess target start was cancelled" && error.code === void 0 && error.syscall === void 0 && error.path === void 0;
}
/**
* Re-check the runner entry, bindings, and current Job capability for every spawn.
* @param internals - optional runner and Win32 capability seams used by tests.
* @returns whether the Windows native containment path is currently available.
*/
function probeWindowsJob(internals = {}) {
	try {
		const invocation = internals.runnerInvocation ?? (internals.resolveRunnerInvocation ?? spawnRunnerInvocation)();
		if (!(internals.runnerAvailable ?? runnerInvocationAvailable)(invocation)) return false;
		const api = (internals.loadWin32ProcessBindings ?? loadWin32ProcessBindings)();
		(internals.probeCurrentTokenJobSupport ?? probeCurrentTokenJobSupport)(api);
		return true;
	} catch {
		return false;
	}
}
var WindowsJobOwner = class {
	runner;
	exited;
	directResultType;
	failInfrastructure;
	cancellationReason;
	cancellationReasonSet = false;
	terminationSent = false;
	constructor(runner, exited, directResultType, failInfrastructure) {
		this.runner = runner;
		this.exited = exited;
		this.directResultType = directResultType;
		this.failInfrastructure = failInfrastructure;
		this.exited.catch(() => {});
	}
	signal(_signal, cancellationReason) {
		if (!this.cancellationReasonSet) {
			this.cancellationReason = cancellationReason;
			this.cancellationReasonSet = true;
		}
		if (this.terminationSent || !this.runner.connected) return;
		this.terminationSent = true;
		try {
			this.runner.send?.({ type: "terminate" }, (error) => {
				if (error === null || this.directResultType() !== void 0) return;
				this.failInfrastructure(error);
				this.terminateForHostExit();
			});
		} catch (error) {
			this.failInfrastructure(error);
			this.terminateForHostExit();
		}
	}
	mapStartFailure(failure, serialized) {
		return this.cancellationReasonSet && isWindowsStartCancellationError(serialized) ? this.cancellationReason : failure;
	}
	async waitForExit() {
		await this.exited;
	}
	terminateForHostExit() {
		try {
			this.runner.kill("SIGKILL");
		} catch {}
	}
};
/**
* Launch one target through a runner that uniquely owns its Job handle.
* @param spec - ordinary target request.
* @param targetEnv - validated complete target environment.
* @param internals - optional runner launch seams used by tests.
* @returns direct streams, result, and runner-owned managed range.
*/
function launchWindowsJob(spec, targetEnv, internals = {}) {
	const invocation = internals.runnerInvocation ?? spawnRunnerInvocation();
	const [command, ...prefix] = invocation;
	const ignoredStdinFd = spec.stdio.stdin === "ignore" ? openSync(devNull, "r") : void 0;
	let child;
	try {
		child = (internals.spawn ?? spawn)(command, [
			...prefix,
			"--",
			...spec.argv
		], {
			cwd: process.cwd(),
			env: runnerEnvironment(WINDOWS_RUNNER_SELECTION, invocation),
			stdio: runnerStdio(spec, true, ignoredStdinFd ?? "pipe")
		});
	} finally {
		if (ignoredStdinFd !== void 0) closeSync(ignoredStdinFd);
	}
	const targetStdin = child.stdio[4];
	const direct = Promise.withResolvers();
	const rangeExit = Promise.withResolvers();
	let directResultType;
	let runnerSpawned = false;
	const failInfrastructure = (error) => {
		direct.reject(error);
		rangeExit.reject(error);
	};
	const owner = new WindowsJobOwner(child, rangeExit.promise, () => directResultType, failInfrastructure);
	child.on("message", (value) => {
		if (directResultType !== void 0) {
			failInfrastructure(/* @__PURE__ */ new Error("subprocess-local: Windows runner emitted more than one direct result"));
			owner.terminateForHostExit();
			return;
		}
		let result;
		try {
			result = parseWindowsRunnerResult(value);
		} catch (error) {
			failInfrastructure(error);
			owner.terminateForHostExit();
			return;
		}
		directResultType = result.type;
		if (result.type === "target-exit") direct.resolve({
			exitCode: result.exitCode,
			signal: null
		});
		else direct.reject(owner.mapStartFailure(deserializeRunnerError(result.error), result.error));
	});
	child.once("spawn", () => {
		runnerSpawned = true;
		try {
			if (child.send === void 0) throw new Error("subprocess-local: Windows runner has no IPC channel");
			child.send({
				type: "start",
				cwd: spec.cwd,
				env: targetEnv
			}, (error) => {
				if (error === null) return;
				failInfrastructure(error);
				owner.terminateForHostExit();
			});
		} catch (error) {
			failInfrastructure(error);
			owner.terminateForHostExit();
		}
	});
	child.once("error", (error) => {
		if (!runnerSpawned) {
			direct.reject(error);
			rangeExit.resolve();
			return;
		}
		failInfrastructure(error);
	});
	child.once("close", (exitCode, signal) => {
		if (!runnerSpawned) return;
		if (exitCode === 0 && signal === null && directResultType !== void 0) {
			rangeExit.resolve();
			return;
		}
		const status = signal !== null ? `signal ${signal}` : exitCode === null ? "without an exit status" : `exit code ${String(exitCode)}`;
		failInfrastructure(/* @__PURE__ */ new Error(`subprocess-local: Windows Job runner exited with ${status} before proving its managed range empty`));
	});
	return {
		stdin: spec.stdio.stdin === "ignore" ? null : targetStdin,
		stdout: child.stdio[5],
		stderr: child.stdio[6],
		direct: direct.promise,
		owner
	};
}
//#endregion
//#region ../../../Core/subprocess/subprocess-local/src/terminal.ts
/** Local node-pty terminal-process implementation for the subprocess seam. */
function delay(ms, signal) {
	return new Promise((resolve) => {
		const finish = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", finish);
			resolve();
		};
		const timer = setTimeout(finish, ms);
		signal?.addEventListener("abort", finish, { once: true });
	});
}
async function raceWithDelay(operation, ms, timeout) {
	const controller = new AbortController();
	try {
		return await Promise.race([operation, delay(ms, controller.signal).then(() => timeout)]);
	} finally {
		controller.abort();
	}
}
function signalName(number) {
	if (number === void 0 || number === 0) return null;
	for (const [name, value] of Object.entries(constants$1.signals)) if (value === number) return name;
	return null;
}
/**
* A local terminal whose native managed range or fallback process-session
* ownership stays below the PTY backend.
* The seam's terminate() promise — no write, inspection, or signal in flight
* after settlement — holds here without operation tracking only because every
* handle call completes synchronously under the hood (node-pty write, ps-based
* inspection). A first genuinely asynchronous step in any handle call must add
* the tracking a remote provider needs.
*/
var LocalTerminalHandle = class {
	terminal;
	inspector;
	graceMs;
	platform;
	managedOwner;
	resolveManagedOutcome;
	processId = 0;
	output = new PassThrough();
	done;
	outcome = Promise.withResolvers();
	dataDisposable;
	exitDisposable;
	cleanup;
	managedOwnerCleaned = false;
	exited = false;
	trackedDescendants = [];
	/** The spawned shell's start identity; scans stop adopting members once the root pid no longer carries it. */
	rootIdentity;
	awaitingProcessId = false;
	/**
	* @param terminal - allocated node-pty process.
	* @param inspector - platform process/session operations.
	* @param graceMs - TERM-to-KILL and exit-wait grace.
	* @param platform - host platform; defaults to the running platform, injectable for deterministic tests.
	*/
	constructor(terminal, inspector, graceMs, platform = process.platform, managedOwner, resolveManagedOutcome) {
		this.terminal = terminal;
		this.inspector = inspector;
		this.graceMs = graceMs;
		this.platform = platform;
		this.managedOwner = managedOwner;
		this.resolveManagedOutcome = resolveManagedOutcome;
		const pid = this.pid;
		this.awaitingProcessId = pid === 0;
		if (pid > 0) this.rootIdentity = inspector.snapshot().tree(pid).find((member) => member.pid === pid);
		this.done = this.outcome.promise;
		this.dataDisposable = terminal.onData((data) => {
			this.output.write(Buffer$1.from(data, "utf8"));
		});
		this.exitDisposable = terminal.onExit(({ exitCode, signal: exitSignal }) => {
			if (this.exited) return;
			this.exited = true;
			this.output.end();
			const outcome = {
				exitCode: exitSignal === void 0 || exitSignal === 0 ? exitCode : null,
				signal: signalName(exitSignal)
			};
			try {
				this.outcome.resolve(this.resolveManagedOutcome?.(outcome) ?? outcome);
			} catch (error) {
				this.outcome.reject(error);
			}
		});
	}
	/** The shell PID becomes available after asynchronous Windows PTY startup and remains stable after exit. */
	get pid() {
		if (this.processId === 0 && this.terminal.pid > 0) this.processId = this.terminal.pid;
		return this.processId;
	}
	/** Whether node-pty has not yet published the top-level exit event. */
	get running() {
		return !this.exited;
	}
	async write(data) {
		if (this.exited) throw new Error("terminal process has exited");
		this.terminal.write(data);
	}
	async inspectForeground() {
		if (this.pid === 0) return void 0;
		this.descendants(this.inspector.snapshot());
		const processGroupId = this.inspector.foregroundPgid(this.pid);
		if (processGroupId === void 0) return void 0;
		return {
			processGroupId,
			inputWaiting: this.inspector.isStdinWaiting(processGroupId, this.pid)
		};
	}
	async signalForeground(signal) {
		const foreground = await this.inspectForeground();
		if (foreground === void 0) throw new Error(`cannot resolve foreground process group for terminal ${this.pid}`);
		if (signal === "SIGKILL" && foreground.processGroupId === this.pid) throw new Error("refusing to SIGKILL the terminal shell; terminate the terminal session instead");
		if (this.platform === "win32") {
			if (signal === "SIGINT") {
				this.terminal.write("");
				return foreground.processGroupId;
			}
			if (signal === "SIGTSTP" || signal === "SIGHUP") throw new Error(`signal ${signal} is unsupported on Windows; only SIGINT, SIGTERM, and SIGKILL are available`);
		}
		this.inspector.signalGroup(foreground.processGroupId, signal);
		return foreground.processGroupId;
	}
	terminate() {
		if (this.cleanup !== void 0) return this.cleanup;
		const cleanup = this.closeOnce();
		this.cleanup = cleanup;
		cleanup.catch(() => {
			this.cleanup = void 0;
		});
		return cleanup;
	}
	/**
	* Force-terminate the observable session synchronously during Node's exit
	* event. This does not claim quiescence and does not replace terminate().
	*/
	terminateForHostExit() {
		this.forceStopDescendants();
		this.forceStopShell();
		this.forceStopDescendants();
		this.managedOwner?.terminateForHostExit();
	}
	forceStopShell() {
		if (this.exited) return;
		if (this.rootIdentity !== void 0) {
			try {
				this.inspector.signalProcess(this.rootIdentity, "SIGKILL");
			} catch (_rootExitedDuringHostExit) {}
			return;
		}
		try {
			this.terminal.kill("SIGKILL");
		} catch (_unidentifiedShellExitedDuringHostExit) {}
	}
	survivors(members, observed) {
		return members.filter((member) => observed.alive(member));
	}
	descendants(observed) {
		if (this.pid === 0) return this.survivors(this.trackedDescendants, observed);
		const tree = observed.tree(this.pid);
		const root = tree.find((member) => member.pid === this.pid);
		if (this.awaitingProcessId) {
			if (!this.exited) this.rootIdentity = root;
			this.awaitingProcessId = false;
		}
		const rootVerified = this.rootIdentity !== void 0 && root !== void 0 && root.started === this.rootIdentity.started;
		this.trackedDescendants = this.survivors(this.unionMembers(this.trackedDescendants, ...rootVerified ? [tree, observed.session(this.pid)] : []).filter((member) => member.pid !== this.pid), observed);
		return this.trackedDescendants;
	}
	async waitForMembers(members) {
		if (members.length === 0) return [];
		const until = Date.now() + this.graceMs;
		let survivors = this.survivors(members, this.inspector.snapshot());
		while (survivors.length > 0 && Date.now() < until) {
			await delay(Math.min(25, Math.max(1, until - Date.now())));
			survivors = this.survivors(members, this.inspector.snapshot());
		}
		return survivors;
	}
	signalMembers(members, signal) {
		for (const member of members) try {
			this.inspector.signalProcess(member, signal);
		} catch (_alreadyExitedDuringSignal) {}
	}
	forceStopDescendants() {
		let members = this.trackedDescendants;
		try {
			members = this.descendants(this.inspector.snapshot());
		} catch (_processTableUnavailableDuringHostExit) {}
		this.signalMembers(members, "SIGKILL");
	}
	unionMembers(...groups) {
		const members = [];
		const seen = /* @__PURE__ */ new Set();
		for (const group of groups) for (const member of group) {
			const key = `${member.pid}:${member.started}`;
			if (seen.has(key)) continue;
			seen.add(key);
			members.push(member);
		}
		return members;
	}
	async stopDescendants() {
		const captured = this.descendants(this.inspector.snapshot());
		this.signalMembers(captured, "SIGTERM");
		const capturedSurvivors = await this.waitForMembers(captured);
		const members = this.unionMembers(capturedSurvivors, this.descendants(this.inspector.snapshot()));
		this.signalMembers(members, "SIGKILL");
		const survivors = await this.waitForMembers(members);
		const observed = this.inspector.snapshot();
		return this.survivors(this.unionMembers(survivors, this.descendants(observed)), observed);
	}
	async stopShell() {
		if (this.platform === "win32") {
			await this.stopShellWindows();
			return;
		}
		if (!this.exited) {
			try {
				this.terminal.kill("SIGTERM");
			} catch (_topLevelAlreadyExitedDuringTerm) {}
			await Promise.race([this.done.then(() => void 0), delay(this.graceMs)]);
		}
		if (!this.exited) {
			try {
				this.terminal.kill("SIGKILL");
			} catch (_topLevelAlreadyExitedDuringKill) {}
			await Promise.race([this.done.then(() => void 0), delay(this.graceMs)]);
		}
		if (!this.exited) throw new Error(`terminal cleanup failed; surviving pid: ${this.pid}`);
	}
	async stopShellWindows() {
		const shellGone = () => this.exited || this.rootIdentity !== void 0 && !this.inspector.isAlive(this.rootIdentity);
		if (!shellGone() && this.rootIdentity !== void 0) {
			this.inspector.signalProcess(this.rootIdentity, "SIGTERM");
			await this.waitForWindowsShellExit();
		}
		if (!shellGone() && this.rootIdentity === void 0) {
			try {
				this.terminal.kill();
			} catch (_topLevelAlreadyExitedDuringKill) {}
			await Promise.race([this.done.then(() => void 0), delay(this.graceMs)]);
		}
		if (!shellGone() && this.rootIdentity !== void 0) {
			this.inspector.signalProcess(this.rootIdentity, "SIGKILL");
			await this.waitForWindowsShellExit();
		}
		if (!shellGone()) throw new Error(`terminal cleanup failed; surviving pid: ${this.pid}`);
	}
	async waitForWindowsShellExit() {
		const until = Date.now() + this.graceMs;
		while (!this.exited && Date.now() < until) {
			if (this.rootIdentity !== void 0 && !this.inspector.isAlive(this.rootIdentity)) return;
			await delay(Math.min(25, Math.max(1, until - Date.now())));
		}
	}
	async closeOnce() {
		if (this.managedOwner !== void 0) {
			try {
				await this.closeManagedRange(this.managedOwner);
				this.dataDisposable.dispose();
				this.exitDisposable.dispose();
			} finally {
				this.done.finally(() => {
					this.cleanupManagedOwner(this.managedOwner);
				}).catch(() => {});
			}
			return;
		}
		let survivors = await this.stopDescendants();
		if (survivors.length > 0) throw new Error(`terminal cleanup failed; surviving pids: ${survivors.map((member) => member.pid).join(", ")}`);
		await this.stopShell();
		survivors = await this.stopDescendants();
		if (survivors.length > 0) throw new Error(`terminal cleanup failed; surviving pids: ${survivors.map((member) => member.pid).join(", ")}`);
		this.settleExitIfGone();
		this.dataDisposable.dispose();
		this.exitDisposable.dispose();
	}
	cleanupManagedOwner(owner) {
		if (this.managedOwnerCleaned) return;
		this.managedOwnerCleaned = true;
		owner.cleanup?.();
	}
	async closeManagedRange(owner) {
		owner.signal("SIGTERM");
		const observation = owner.waitForExit();
		const first = await raceWithDelay(observation.then(() => ({ kind: "stopped" }), (error) => ({
			kind: "failed",
			error
		})), this.graceMs, { kind: "timeout" });
		if (first.kind !== "stopped") {
			owner.signal("SIGKILL");
			if (first.kind === "failed") {
				try {
					await owner.waitForExit();
				} catch (finalError) {
					throw new AggregateError([first.error, finalError], "terminal managed-range cleanup failed");
				}
				throw first.error;
			}
			await observation;
		}
		if (!this.exited) await raceWithDelay(this.done.then(() => void 0), this.graceMs, void 0);
		if (!this.exited) throw new Error(`terminal cleanup failed; surviving pid: ${this.pid}`);
	}
	settleExitIfGone() {
		if (this.platform !== "win32") return;
		if (this.exited) return;
		/* v8 ignore next -- stopShellWindows() verified the shell is gone or threw;
		the identity re-check is a defensive fence for a future caller. */
		if (this.rootIdentity !== void 0 && this.inspector.isAlive(this.rootIdentity)) return;
		this.exited = true;
		this.output.end();
		this.outcome.resolve({
			exitCode: null,
			signal: null
		});
	}
};
//#endregion
//#region ../../../Core/subprocess/subprocess-local/src/controller.ts
/**
* Shared local implementation for the subprocess capability seam. Each spawn owns a
* platform-selected managed range with the spec's per-stream stdio dispositions.
* Normal disposal terminates and joins live ranges; Node's synchronous exit
* phase force-stops any ranges the service still owns. It has no config: every
* disposition and limit arrives on the spec, so deployment-varying choices
* stay with the caller's config (the bash executor's, the LSP host's, …).
* @module @deepseek-ai/dsh-subprocess-local/controller
*/
/**
* Local subprocess service: platform-selected managed ranges, Node-shaped stdio
* dispositions (raw pipes, inherit, bounded tail-keep collection with spill
* files), credential-scrubbed environment, and provider-owned range signalling.
* POSIX paths stage TERM before KILL; Windows paths terminate immediately.
* JavaScript-observable host exit also performs synchronous final termination.
*/
var LocalSubprocessController = class {
	warn;
	/** Live handles retained for normal disposal and synchronous host-exit finalization. */
	live = /* @__PURE__ */ new Set();
	/** Live terminals retained through normal quiescence or host-exit finalization. */
	terminals = /* @__PURE__ */ new Set();
	/** Test hook: process, spill, and platform operations forwarded to spawnSubprocess. */
	internals = {};
	/** Provider-lifetime latch suppressing repeated weaker-containment warnings. */
	fallbackWarningIssued = false;
	/** Positive-only cache for the expensive Linux bootstrap and scope probe. */
	linuxDeepProbePassed = false;
	/** Test hook for platform process inspection; production resolves lazily on terminal spawn. */
	terminalInspector;
	onHostExit = () => {
		this.terminateForHostExit();
	};
	constructor(warn) {
		this.warn = warn;
		process.prependListener("exit", this.onHostExit);
	}
	/** Terminate every owned process range before removing the host-exit fallback. */
	async dispose() {
		await this.disposeManagedProcesses();
		process.off("exit", this.onHostExit);
	}
	terminateForHostExit() {
		for (const handle of this.live) try {
			handle.terminateForHostExit();
		} catch (_ordinaryRangeTerminationFailed) {}
		for (const terminal of this.terminals) try {
			terminal.terminateForHostExit();
		} catch (_terminalTerminationFailed) {}
	}
	async disposeManagedProcesses() {
		const pending = [];
		for (const handle of this.live) {
			handle.terminate();
			pending.push(Promise.all([handle.done.catch(() => {}), handle.waitForExit()]).then(() => {
				this.live.delete(handle);
			}));
		}
		for (const terminal of this.terminals) pending.push(terminal.terminate().then(() => {
			this.terminals.delete(terminal);
		}));
		const outcomes = await Promise.allSettled(pending);
		const failures = [];
		for (const outcome of outcomes) if (outcome.status === "rejected") failures.push(outcome.reason);
		if (failures.length > 0) this.terminateForHostExit();
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, "local subprocess teardown failed");
	}
	async resolveExecutable(command, env, signal) {
		if (command.length === 0) throw new Error("subprocess-local: executable must be non-empty");
		signal?.throwIfAborted();
		const environment = childEnv(env);
		const absolute = isAbsolute(command);
		if (!absolute && (command.includes("/") || process.platform === "win32" && command.includes("\\"))) throw new Error(`subprocess-local: command ${JSON.stringify(command)} is a relative path; use an absolute path or a bare PATH name`);
		const candidates = absolute ? [command] : this.executableCandidates(command, environment);
		for (const candidate of candidates) {
			signal?.throwIfAborted();
			try {
				if (!(await stat(candidate)).isFile()) continue;
				await access(candidate, constants.X_OK);
				signal?.throwIfAborted();
				return candidate;
			} catch {}
		}
		signal?.throwIfAborted();
		throw new Error(absolute ? `subprocess-local: command ${JSON.stringify(command)} is not an executable file` : `subprocess-local: command ${JSON.stringify(command)} was not found on PATH`);
	}
	/**
	* Expand a bare command across the effective PATH and platform extensions.
	* @param command - bare executable name.
	* @param env - child environment used for PATH resolution.
	* @returns absolute candidate paths in search order.
	*/
	executableCandidates(command, env) {
		const path = environmentValue(env, "PATH") ?? "";
		const extensions = process.platform === "win32" && extname(command) === "" ? (environmentValue(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";") : [""];
		return path.split(delimiter).flatMap((directory) => extensions.map((extension) => resolve(process.cwd(), directory, command + extension)));
	}
	spawn(spec) {
		validateSubprocessSpec(spec);
		const env = targetEnvironment(spec);
		const containmentMode = this.selectContainmentMode("ordinary");
		let handle;
		if (containmentMode === "fallback") handle = spawnSubprocess(spec, this.internals);
		else {
			const binding = prepareManagedProcessBinding(this.internals);
			handle = bindManagedProcess(spec, containmentMode === "linux-scope" ? launchLinuxScope(spec, env) : launchWindowsJob(spec, env), binding);
		}
		this.live.add(handle);
		const release = () => handle.waitForExit().then(() => {
			this.live.delete(handle);
		});
		handle.done.then(release, release).catch(() => {});
		return handle;
	}
	/** Connect one subprocess with caller-owned raw stdin, stdout, and stderr. */
	connect(spec) {
		const handle = this.spawn({
			...spec,
			stdio: {
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe"
			}
		});
		if (handle.stdin === void 0 || handle.stdout === void 0 || handle.stderr === void 0) {
			handle.terminate();
			throw new Error("subprocess-local: child connection did not create all stdio pipes");
		}
		return {
			...handle,
			stdin: handle.stdin,
			stdout: handle.stdout,
			stderr: handle.stderr
		};
	}
	/**
	* Select the strongest currently available managed range for a spawn.
	* @param kind - ordinary child or terminal session.
	* @returns the selected platform owner or explicit fallback.
	*/
	selectContainmentMode(kind) {
		const platform = this.internals.platform ?? process.platform;
		let fallbackReason;
		if (platform === "linux") {
			const available = this.linuxDeepProbePassed ? probeLinuxManager() : probeLinuxNative();
			if (available) this.linuxDeepProbePassed = true;
			if (available) return "linux-scope";
			fallbackReason = "the current user-systemd scope or private bootstrap is unavailable";
		}
		if (kind === "ordinary" && platform === "win32") {
			if (probeWindowsJob()) return "windows-job";
		}
		this.warnFallback(platform, kind, fallbackReason);
		return "fallback";
	}
	/**
	* Report weaker containment once during this Provider installation.
	* @param platform - selected execution platform.
	* @param kind - ordinary child or terminal session.
	* @param selectedReason - detected reason when one is available.
	*/
	warnFallback(platform, kind, selectedReason) {
		if (this.fallbackWarningIssued) return;
		this.fallbackWarningIssued = true;
		const reason = selectedReason ?? (platform === "darwin" ? "macOS has no supported persistent process-range owner" : platform === "win32" ? kind === "terminal" ? "Windows ConPTY remains outside Job containment" : "the Win32 Job runner is unavailable" : `platform ${platform} has no native managed range`);
		this.warn(`subprocess-local is using weaker process-tree containment because ${reason}; descendants that escape the process group or direct-parent tree are not guaranteed to terminate or delay waitForExit()`);
	}
	async spawnTerminal(spec) {
		const file = spec.argv[0];
		if (file === void 0 || file.length === 0) throw new Error("subprocess-local: terminal argv must contain a program");
		spec.signal?.throwIfAborted();
		const env = targetEnvironment(spec);
		const options = {
			name: "dumb",
			rows: spec.rows,
			cols: spec.cols,
			cwd: spec.cwd,
			env
		};
		const inspector = this.terminalInspector ?? createProcessInspector();
		const scope = this.selectContainmentMode("terminal") === "linux-scope" ? prepareLinuxTerminalScope(spec, {
			...env,
			PWD: spec.cwd,
			TERM: "dumb"
		}) : void 0;
		if (scope !== void 0) {
			options.cwd = scope.cwd;
			options.env = scope.env;
		}
		let terminal;
		try {
			terminal = import_lib.spawn(scope?.command ?? file, scope?.args ?? [...spec.argv.slice(1)], options);
		} catch (error) {
			scope?.cleanup();
			throw error;
		}
		let handle;
		const owner = scope?.bindOwner({
			running: () => handle?.running ?? true,
			signal: (signal) => {
				try {
					terminal.kill(signal);
				} catch {}
			}
		});
		handle = new LocalTerminalHandle(terminal, inspector, spec.graceMs, this.internals.platform ?? process.platform, owner, scope?.resolveOutcome);
		this.terminals.add(handle);
		const release = async () => {
			await handle.terminate();
			this.terminals.delete(handle);
		};
		handle.done.then(release, release).catch(() => {});
		return handle;
	}
};
/** Read a Windows environment key using the platform's case-insensitive semantics. */
function environmentValue(env, name) {
	const exact = env[name];
	if (exact !== void 0 || process.platform !== "win32") return exact;
	const normalized = name.toUpperCase();
	return Object.entries(env).find(([key]) => key.toUpperCase() === normalized)?.[1];
}
//#endregion
//#region ../../../Core/subprocess/subprocess-local/src/child-connection.ts
/**
* Create the same managed local process owner used by the Native Provider.
* @returns a framework-free connection capability with explicit teardown.
*/
function createLocalChildConnectionProvider() {
	const controller = new LocalSubprocessController((message) => {
		process.emitWarning(message);
	});
	return {
		connect: (spec) => controller.connect(spec),
		dispose: () => controller.dispose()
	};
}
//#endregion
//#region ../../../Core/util/json-rpc-line/src/index.ts
/**
* Newline-delimited JSON-RPC 2.0 over byte streams. Frames with `id` and
* `method` are requests, `id` alone is a response, and `method` alone is a
* notification. Malformed lines are ignored; handler failures become error frames.
*
* @module @deepseek-ai/dsh-json-rpc-line
*/
/** A JSON-RPC error response, preserving the wire `code` and optional `data`. */
var JsonRpcResponseError = class extends Error {
	code;
	data;
	/**
	* @param code - the wire error code, or `undefined` when the peer sent none.
	* @param message - the wire error message.
	* @param data - the optional structured error payload, verbatim.
	*/
	constructor(code, message, data) {
		super(message);
		this.code = code;
		this.data = data;
		this.name = "JsonRpcResponseError";
	}
};
/**
* Line-delimited endpoint over caller-owned streams. {@link start} attaches
* listeners; {@link close} detaches them and rejects pending requests without
* destroying the streams. Missing request handlers return `-32601`; handler
* failures return `-32603`. Notifications without a handler are dropped.
*/
var JsonRpcLineTransport = class {
	input;
	output;
	buffer = "";
	decoder = new StringDecoder("utf8");
	started = false;
	requestHandler;
	notificationHandler;
	pending = /* @__PURE__ */ new Map();
	constructor(input, output) {
		this.input = input;
		this.output = output;
	}
	/** Attach the input listeners and begin reading frames. Idempotent. */
	start() {
		if (this.started) return;
		this.started = true;
		this.input.on("data", this.onData);
		this.input.on("error", this.onInputError);
		this.input.on("end", this.onInputEnd);
	}
	/**
	* Detach listeners and reject pending requests. Safe before {@link start}.
	*/
	close() {
		this.input.off("data", this.onData);
		this.input.off("error", this.onInputError);
		this.input.off("end", this.onInputEnd);
		this.failPending(/* @__PURE__ */ new Error("JSON-RPC transport closed"));
	}
	/**
	* Install the request handler, replacing any prior handler.
	* @param handler - resolves to the response `result`; a rejection becomes a
	* `-32603` error response carrying the message.
	*/
	onRequest(handler) {
		this.requestHandler = handler;
	}
	/**
	* Install the notification handler, replacing any prior handler.
	* @param handler - invoked per notification with the method and normalized
	* params object.
	*/
	onNotification(handler) {
		this.notificationHandler = handler;
	}
	/**
	* Send a request and await its response.
	* @param method - the JSON-RPC method name.
	* @param params - the request parameters object.
	* @param signal - optional abandonment signal: aborting removes the pending
	* entry (no state is retained for a response that may never come) and
	* rejects with the signal's reason.
	* @returns the result; rejects per {@link JsonRpcTransportPeer.request}.
	*/
	request(method, params, signal) {
		const id = `req_${randomUUID().replaceAll("-", "")}`;
		const message = {
			jsonrpc: "2.0",
			id,
			method,
			params
		};
		return new Promise((resolve, reject) => {
			let detach = () => {};
			if (signal !== void 0) {
				if (signal.aborted) {
					reject(abortError(signal.reason));
					return;
				}
				const onAbort = () => {
					this.pending.delete(id);
					reject(abortError(signal.reason));
				};
				signal.addEventListener("abort", onAbort, { once: true });
				detach = () => {
					signal.removeEventListener("abort", onAbort);
				};
			}
			this.pending.set(id, {
				resolve: (value) => {
					detach();
					resolve(value);
				},
				reject: (error) => {
					detach();
					reject(error);
				}
			});
			try {
				this.write(message);
			} catch (error) {
				this.pending.delete(id);
				detach();
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}
	notify(method, params) {
		this.write(params === void 0 ? {
			jsonrpc: "2.0",
			method
		} : {
			jsonrpc: "2.0",
			method,
			params
		});
	}
	/**
	* Wait for prior frame write callbacks. The empty barrier emits no bytes.
	* @returns a promise that settles with the output write callback.
	*/
	flush() {
		return new Promise((resolve, reject) => {
			this.output.write("", (error) => {
				if (error) reject(error);
				else resolve();
			});
		});
	}
	onData = (chunk) => {
		this.buffer += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
		this.drainLines();
	};
	drainLines() {
		for (;;) {
			const newline = this.buffer.indexOf("\n");
			if (newline < 0) break;
			const line = this.buffer.slice(0, newline).trim();
			this.buffer = this.buffer.slice(newline + 1);
			if (!line) continue;
			this.handleLine(line);
		}
	}
	onInputError = (error) => {
		this.failPending(error);
	};
	onInputEnd = () => {
		this.buffer += this.decoder.end();
		this.drainLines();
		this.failPending(/* @__PURE__ */ new Error("JSON-RPC input closed"));
	};
	async handleLine(line) {
		let message;
		try {
			message = JSON.parse(line);
		} catch {
			return;
		}
		if (!message || typeof message !== "object") return;
		const frame = message;
		const id = frame.id;
		const method = frame.method;
		if ((typeof id === "string" || typeof id === "number") && typeof method === "string") {
			await this.handleIncomingRequest(id, method, objectParams(frame.params));
			return;
		}
		if (typeof id === "string" || typeof id === "number") {
			this.handleIncomingResponse(id, frame);
			return;
		}
		if (typeof method === "string") this.notificationHandler?.(method, objectParams(frame.params));
	}
	async handleIncomingRequest(id, method, params) {
		const handler = this.requestHandler;
		if (!handler) {
			this.writeError(id, -32601, `method not found: ${method}`);
			return;
		}
		try {
			const result = await handler(method, params);
			this.write({
				jsonrpc: "2.0",
				id,
				result
			});
		} catch (error) {
			this.writeError(id, -32603, error instanceof Error ? error.message : String(error));
		}
	}
	handleIncomingResponse(id, frame) {
		const pending = this.pending.get(id);
		if (!pending) return;
		this.pending.delete(id);
		if (frame.error && typeof frame.error === "object") {
			const error = frame.error;
			pending.reject(new JsonRpcResponseError(typeof error.code === "number" ? error.code : void 0, typeof error.message === "string" ? error.message : "JSON-RPC error", error.data));
			return;
		}
		pending.resolve(frame.result);
	}
	writeError(id, code, message) {
		this.write({
			jsonrpc: "2.0",
			id,
			error: {
				code,
				message
			}
		});
	}
	write(message) {
		this.output.write(`${JSON.stringify(message)}\n`);
	}
	failPending(error) {
		const pending = [...this.pending.values()];
		this.pending.clear();
		for (const waiter of pending) waiter.reject(error);
	}
};
/** Normalize JSON-RPC `params` to a plain object (arrays and scalars collapse to `{}`). */
function objectParams(params) {
	return params && typeof params === "object" && !Array.isArray(params) ? params : {};
}
/** Normalize an abort reason into the rejection Error (a non-Error reason is stringified). */
function abortError(reason) {
	return reason instanceof Error ? reason : /* @__PURE__ */ new Error(`JSON-RPC request aborted: ${String(reason)}`);
}
//#endregion
//#region ../sdk-runtime/src/client.ts
/**
* Low-level JSON-RPC client for a DeepSeek Harness SDK runtime subprocess.
* {@link HarnessClient} owns the child process: it spawns the runtime, speaks
* the `@deepseek-ai/dsh-sdk-protocol` wire over the child's stdio, fans
* server notifications out to subscriptions, and tears the child down through
* Core's managed connection lifetime. The design
* twin is the Python SDK's `HarnessClient` (`rsh/Programs/SDK/python/sdk`); both drive the
* same runtime protocol. This client runs OUTSIDE any harness context, so it
* uses the framework-free local `dsh-subprocess` connection Provider without
* mounting NativeHost or Cordis.
*
* @module @deepseek-ai/dsh-sdk-runtime/client
*/
const nativeChildConnection = Symbol("native SDK child connection");
const nativeApprovalRelay = Symbol("native SDK child approval relay");
/** Retained stderr lines used to diagnose an unexpected runtime death. */
const STDERR_TAIL_LIMIT = 400;
/** Grace for the runtime's stdio streams to settle after its exit edge. */
const STREAM_SETTLE_MS = 100;
/**
* The runtime subprocess is gone or unusable: it exited, its stdio closed, or
* it was never launchable. The message carries the exit code and a stderr
* tail when available.
*/
var TransportClosedError = class extends Error {
	/** @param message - the failure description, including any stderr tail. */
	constructor(message) {
		super(message);
		this.name = "TransportClosedError";
	}
};
/** A request exceeded {@link HarnessClientOptions.requestTimeoutMs}. */
var RequestTimeoutError = class extends Error {
	/** @param message - which method timed out. */
	constructor(message) {
		super(message);
		this.name = "RequestTimeoutError";
	}
};
/**
* The runtime answered outside its documented protocol (for example a
* `session/prompt` response without `accepted: true`).
*/
var SdkProtocolError = class extends Error {
	/** @param message - the protocol violation description. */
	constructor(message) {
		super(message);
		this.name = "SdkProtocolError";
	}
};
/** Internal producer side of a public notification subscription. */
var NotificationSubscriptionImpl = class {
	state;
	unsubscribe;
	constructor(state, unsubscribe) {
		this.state = state;
		this.unsubscribe = unsubscribe;
	}
	/**
	* Await the next matching notification.
	* @returns the notification; after the runtime died, drains what was
	* already delivered and then rejects; after {@link close}, rejects
	* immediately (the queue is dropped).
	*/
	next() {
		const queued = this.state.queue.shift();
		if (queued !== void 0) return Promise.resolve(queued);
		if (this.state.failure !== void 0) return Promise.reject(this.state.failure);
		return new Promise((resolve, reject) => {
			this.state.waiters.push({
				resolve,
				reject
			});
		});
	}
	/**
	* Drain one already-delivered notification without waiting.
	* @returns the next queued notification, or `undefined` when none is queued.
	*/
	tryNext() {
		return this.state.queue.shift();
	}
	/** Detach from the client; queued items drop and pending waiters reject. */
	close() {
		this.unsubscribe();
		this.state.queue.length = 0;
		this.fail(new TransportClosedError("notification subscription closed"));
	}
	/**
	* Reject pending and future waits (delivery stops; the first failure wins).
	* Already-queued notifications remain drainable via {@link next}/{@link tryNext}.
	* @param error - the terminal failure delivered to waiters.
	*/
	fail(error) {
		this.state.failure ??= error;
		for (const waiter of this.state.waiters.splice(0)) waiter.reject(this.state.failure);
	}
	/**
	* Deliver one notification to a waiter or the queue when the filter
	* matches. A throwing filter fails only THIS subscription (detached, the
	* throw becomes its terminal error) — it never disturbs sibling
	* subscriptions or the transport's read loop.
	* @param notification - the wire notification to deliver.
	*/
	push(notification) {
		let matches;
		try {
			matches = this.state.filter === void 0 || this.state.filter(notification);
		} catch (error) {
			this.unsubscribe();
			this.fail(error instanceof Error ? error : new Error(String(error)));
			return;
		}
		if (!matches) return;
		const waiter = this.state.waiters.shift();
		if (waiter !== void 0) waiter.resolve(notification);
		else this.state.queue.push(notification);
	}
	/**
	* Iterate notifications until the subscription or runtime closes (the
	* terminating rejection propagates).
	* @returns an async iterator over {@link next} results.
	*/
	async *[Symbol.asyncIterator]() {
		for (;;) yield await this.next();
	}
};
/**
* JSON-RPC client for the DeepSeek Harness SDK runtime over subprocess stdio.
*
* The subprocess starts lazily on {@link start} and is owned by this instance
* until {@link close}, which requests protocol `shutdown`, gives protocol
* writes a bounded flush opportunity, then closes stdin and awaits the Provider-managed process range. A
* timed-out request stays running server-side; the explicit native-sdk
* profile supports Session cancellation separately from request timeouts.
*/
var HarnessClient$1 = class {
	/** Original public dsh launch and timeout options for this client. */
	options;
	runtime;
	hostChildConnection;
	approvalRelay;
	activeApprovalRequests = /* @__PURE__ */ new Map();
	seenApprovalRequests = /* @__PURE__ */ new Set();
	approvalWork = /* @__PURE__ */ new Set();
	runtimeDisposer;
	child;
	processProvider;
	transport;
	stderrTail = [];
	subscriptions = /* @__PURE__ */ new Map();
	sessionParents = /* @__PURE__ */ new Map();
	subscriptionSerial = 0;
	exitCode;
	spawnError;
	rangeError;
	streamsSettled = Promise.resolve();
	closeTask;
	constructor(options = {}, runtime) {
		const { [nativeChildConnection]: ownedConnection, [nativeApprovalRelay]: approvalRelay, ...publicOptions } = options;
		this.options = publicOptions;
		this.hostChildConnection = ownedConnection?.definition;
		this.approvalRelay = approvalRelay;
		this.runtimeDisposer = ownedConnection?.dispose;
		const selectedRuntime = runtime;
		if (selectedRuntime === void 0) throw new Error("SDK runtime client requires a Program-resolved process launch");
		this.runtime = selectedRuntime;
	}
	/**
	* Spawn the runtime subprocess and start reading frames. Idempotent while
	* the process is live; rejects reuse after {@link close}.
	*/
	start() {
		if (this.closeTask !== void 0) throw new TransportClosedError("DeepSeek Harness runtime client is closed");
		if (this.child !== void 0) return;
		let processProvider;
		let connection;
		if (this.hostChildConnection === void 0) {
			processProvider = createLocalChildConnectionProvider();
			connection = processProvider;
		} else connection = this.hostChildConnection;
		this.processProvider = processProvider;
		let child;
		try {
			child = connection.connect({
				argv: [this.runtime.command, ...this.runtime.args],
				cwd: this.runtime.cwd ?? process.cwd(),
				env: this.runtime.environment(),
				envMode: "replace",
				graceMs: this.runtime.disposeGraceMs ?? 3e3
			});
		} catch (error) {
			if (processProvider !== void 0) processProvider.dispose().catch(() => {});
			this.processProvider = void 0;
			throw error;
		}
		this.child = child;
		/* v8 ignore next */
		child.stdin.on("error", () => {});
		let stderrBuffer = "";
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk) => {
			stderrBuffer += chunk;
			const newline = stderrBuffer.lastIndexOf("\n");
			if (newline >= 0) {
				this.appendStderr(stderrBuffer.slice(0, newline).split("\n"));
				stderrBuffer = stderrBuffer.slice(newline + 1);
			}
		});
		let signalStreamsSettled;
		this.streamsSettled = new Promise((resolve) => {
			signalStreamsSettled = resolve;
		});
		const settled = {
			stderr: false,
			exited: false
		};
		const maybeSettle = () => {
			if (settled.stderr && settled.exited) signalStreamsSettled();
		};
		child.stderr.once("close", () => {
			if (stderrBuffer.length > 0) this.appendStderr([stderrBuffer]);
			settled.stderr = true;
			maybeSettle();
		});
		child.done.then((outcome) => {
			this.exitCode = outcome.exitCode;
			settled.exited = true;
			maybeSettle();
			return child.waitForExit().then(() => {
				this.abortApprovalRequests(this.closedError("DeepSeek Harness runtime exited"));
				this.transport?.close();
				this.failSubscriptions(this.closedError("DeepSeek Harness runtime exited"));
			}, (error) => {
				this.rangeError = error instanceof Error ? error : new Error(String(error));
				this.abortApprovalRequests(this.closedError("DeepSeek Harness process range could not be confirmed"));
				this.transport?.close();
				this.failSubscriptions(this.closedError("DeepSeek Harness process range could not be confirmed"));
			});
		}, (error) => {
			this.spawnError = error instanceof Error ? error : new Error(String(error));
			settled.exited = true;
			maybeSettle();
			this.abortApprovalRequests(this.closedError("DeepSeek Harness runtime failed to start"));
			this.transport?.close();
			this.failSubscriptions(this.closedError("DeepSeek Harness runtime failed to start"));
		});
		const transport = new JsonRpcLineTransport(child.stdout, child.stdin);
		transport.onNotification((method, params) => {
			if (method === "approval/cancel") this.cancelApproval(params);
			this.dispatchNotification({
				method,
				params
			});
		});
		transport.onRequest((method, params) => this.handleIncomingRequest(method, params));
		transport.start();
		this.transport = transport;
	}
	/**
	* Perform the process-wide handshake.
	* @param params - workspace cwd plus the provider/model route.
	* @returns the runtime's wire identity.
	*/
	async initialize(params) {
		if (params.maxSteps !== void 0 && (!Number.isSafeInteger(params.maxSteps) || params.maxSteps <= 0)) throw new TypeError("initialize maxSteps must be a positive safe integer");
		if (params.allowedTools !== void 0 && (!Array.isArray(params.allowedTools) || params.allowedTools.some((name) => typeof name !== "string" || name.length === 0) || new Set(params.allowedTools).size !== params.allowedTools.length)) throw new TypeError("initialize allowedTools must be an array of unique non-empty names");
		if (params.workspaceWriteRoot !== void 0 && (typeof params.workspaceWriteRoot !== "string" || params.workspaceWriteRoot.length === 0 || !isAbsolute(params.workspaceWriteRoot))) throw new TypeError("initialize workspaceWriteRoot must be an absolute path");
		const result = await this.request("initialize", {
			...params,
			...this.approvalRelay === void 0 ? {} : { approvalOperationId: this.approvalRelay.operationId }
		}, this.runtime.initializeTimeoutMs);
		if (!isRecord(result) || !isRecord(result.serverInfo) || typeof result.serverInfo.name !== "string" || typeof result.serverInfo.version !== "string") throw new SdkProtocolError(`initialize returned no server identity: ${JSON.stringify(result)}`);
		if (result.maxSteps !== void 0 && (typeof result.maxSteps !== "number" || !Number.isSafeInteger(result.maxSteps) || result.maxSteps <= 0)) throw new SdkProtocolError(`initialize returned an invalid maxSteps value: ${JSON.stringify(result.maxSteps)}`);
		if (params.maxSteps !== void 0 && (result.maxSteps === void 0 || result.maxSteps > params.maxSteps)) throw new SdkProtocolError(`initialize did not negotiate maxSteps at or below ${String(params.maxSteps)}`);
		return {
			serverInfo: {
				name: result.serverInfo.name,
				version: result.serverInfo.version
			},
			...result.maxSteps === void 0 ? {} : { maxSteps: result.maxSteps }
		};
	}
	/**
	* Queue one prompt and return its durable inbox identity.
	* @param sessionId - target session; an unknown id creates it.
	* @param contentBlocks - the user message, sent verbatim.
	* @returns the queued message id.
	*/
	async prompt(sessionId, contentBlocks) {
		const params = {
			sessionId,
			contentBlocks
		};
		const result = await this.request("session/prompt", { ...params });
		if (!isRecord(result) || typeof result.messageId !== "string") throw new SdkProtocolError(`session/prompt returned no message id: ${JSON.stringify(result)}`);
		return result.messageId;
	}
	/**
	* Durably steer the admitted native SDK root at its next step and wake it after a turn interruption.
	* @param sessionId - active Session owned by this runtime; idle or unknown identities reject.
	* @param contentBlocks - ordered text and encoded images, admitted through the prompt policy.
	* @returns the durable next-step message id; unsupported profiles reject.
	*/
	async steer(sessionId, contentBlocks) {
		const result = await this.request("session/steer", {
			sessionId,
			contentBlocks
		});
		if (!isRecord(result) || typeof result.messageId !== "string" || result.messageId.length === 0) throw new SdkProtocolError(`session/steer returned no message id: ${JSON.stringify(result)}`);
		return result.messageId;
	}
	/**
	* Cancel an admitted turn on the explicit native-sdk profile and await cleanup.
	* @param sessionId - Session whose active turn to cancel; other Sessions remain running.
	* @returns false when no admitted turn was active; rejects on unsupported profiles.
	*/
	async cancel(sessionId) {
		const result = await this.request("session/cancel", { sessionId });
		if (!isRecord(result) || typeof result.cancelled !== "boolean") throw new SdkProtocolError(`session/cancel returned no cancellation result: ${JSON.stringify(result)}`);
		return result.cancelled;
	}
	/**
	* Copy a closed native-sdk turn into a fresh Session without a model request.
	* @param sessionId - readable source Session under the initialized workspace.
	* @param destinationSessionId - fresh destination identity; existing identities reject.
	* @param atSeq - source event in a closed turn; omitted selects its last closed turn.
	* @returns the durable destination identity; unsupported profiles reject.
	*/
	async fork(sessionId, destinationSessionId, atSeq) {
		const result = await this.request("session/fork", {
			sessionId,
			destinationSessionId,
			...atSeq === void 0 ? {} : { atSeq }
		});
		if (!isRecord(result) || typeof result.sessionId !== "string" || result.sessionId !== destinationSessionId) throw new SdkProtocolError(`session/fork returned no matching Session identity: ${JSON.stringify(result)}`);
		return result.sessionId;
	}
	/**
	* Send one JSON-RPC request and await its result.
	* @param method - the wire method name.
	* @param params - the params object; omitted params send `{}`.
	* @param timeoutMs - per-call override of {@link HarnessClientOptions.requestTimeoutMs}.
	* @returns the raw result; rejects with {@link JsonRpcResponseError} on a
	* protocol error response, {@link RequestTimeoutError} on timeout, and
	* {@link TransportClosedError} when the runtime is gone.
	*/
	async request(method, params, timeoutMs) {
		this.start();
		return this.requestOnStartedTransport(method, params, timeoutMs);
	}
	async requestOnStartedTransport(method, params, timeoutMs) {
		if (this.exitCode !== void 0 || this.spawnError !== void 0 || this.rangeError !== void 0) {
			await this.settleStreams();
			throw this.closedError("DeepSeek Harness runtime is not running");
		}
		const transport = this.transport;
		/* v8 ignore next -- start() either sets the transport or throws */
		if (transport === void 0) throw new TransportClosedError("DeepSeek Harness runtime is not running");
		const timeout = timeoutMs ?? this.runtime.requestTimeoutMs;
		try {
			if (timeout === void 0) return await transport.request(method, params ?? {});
			const abandon = new AbortController();
			const timer = setTimeout(() => {
				const stderr = this.stderrTail.length === 0 ? "" : `; stderr tail:\n${this.stderrTail.join("\n")}`;
				abandon.abort(new RequestTimeoutError(`${method} timed out after ${timeout}ms waiting for ${this.runtime.description}${stderr}`));
			}, timeout);
			try {
				return await transport.request(method, params ?? {}, abandon.signal);
			} finally {
				clearTimeout(timer);
			}
		} catch (error) {
			if (error instanceof JsonRpcResponseError || error instanceof RequestTimeoutError) throw error;
			await this.settleStreams();
			throw this.closedError(errorMessage(error));
		}
	}
	/**
	* Subscribe to server notifications.
	* @param filter - optional predicate; omitted means every notification.
	* @returns the subscription handle; close it to stop delivery. After
	* {@link close} or runtime death the handle is born failed — there is no
	* producer left, so `next()` rejects instead of waiting forever.
	*/
	subscribe(filter) {
		const id = String(this.subscriptionSerial++);
		const subscription = new NotificationSubscriptionImpl({
			queue: [],
			waiters: [],
			filter,
			failure: void 0
		}, () => {
			this.subscriptions.delete(id);
		});
		if (this.closeTask !== void 0 || this.exitCode !== void 0 || this.spawnError !== void 0 || this.rangeError !== void 0) {
			subscription.fail(this.closedError("DeepSeek Harness runtime closed"));
			return subscription;
		}
		this.subscriptions.set(id, subscription);
		return subscription;
	}
	/**
	* Subscribe to one session and the descendants discovered from
	* `subagent.started` lineage edges. The runtime notifies for every session
	* in its context, so this client applies the scope.
	* @param sessionId - the root session id.
	* @returns the filtered subscription handle.
	*/
	subscribeSessionTree(sessionId) {
		return this.subscribe((notification) => {
			const params = notification.params;
			if (notification.method === "subagent.started" || notification.method === "subagent.finished") {
				const parentId = params.parentSessionId;
				if (typeof parentId === "string" && this.isDescendantOf(parentId, sessionId)) return true;
				return params.childSessionId === sessionId;
			}
			const relatedId = params.sessionId;
			return typeof relatedId === "string" && this.isDescendantOf(relatedId, sessionId);
		});
	}
	/**
	* Shut the runtime down and reap it: a best-effort protocol `shutdown`
	* and write flush, each bounded by `shutdownTimeoutMs`, then close stdin and
	* await the Provider-managed process range. Idempotent.
	* @returns settlement of the complete teardown.
	*/
	close() {
		this.closeTask ??= this.performClose();
		return this.closeTask;
	}
	async performClose() {
		this.abortApprovalRequests(new TransportClosedError("SDK client is closing"));
		await Promise.allSettled([...this.approvalWork]);
		const child = this.child;
		const failures = [];
		let flushError;
		let connectionReleased = child === void 0;
		if (child !== void 0) {
			try {
				await this.requestOnStartedTransport("shutdown", void 0, this.runtime.shutdownTimeoutMs ?? 1e3);
			} catch (error) {
				this.appendStderr([`shutdown request failed: ${errorMessage(error)}`]);
			}
			const transport = this.transport;
			if (transport !== void 0) {
				const flushTimeoutMs = this.runtime.shutdownTimeoutMs ?? 1e3;
				let flushTimer;
				try {
					await Promise.race([transport.flush(), new Promise((_, reject) => {
						flushTimer = setTimeout(() => {
							reject(/* @__PURE__ */ new Error(`stdio flush timed out after ${flushTimeoutMs}ms`));
						}, flushTimeoutMs);
					})]);
				} catch (error) {
					flushError = error instanceof Error ? error : new Error(String(error));
					this.appendStderr([`stdio flush failed: ${errorMessage(flushError)}`]);
				} finally {
					if (flushTimer !== void 0) clearTimeout(flushTimer);
				}
			}
			try {
				await disposeChildConnection(child, {
					eofGraceMs: this.runtime.disposeEofGraceMs ?? 6e3,
					terminationGraceMs: this.runtime.disposeGraceMs ?? 3e3
				});
				await child.done.catch(() => {});
				await this.settleStreams();
				connectionReleased = true;
			} catch (error) {
				failures.push(error);
			}
		}
		if (connectionReleased) {
			this.transport?.close();
			this.failSubscriptions(this.closedError("DeepSeek Harness runtime closed"));
			const provider = this.processProvider;
			if (provider !== void 0) try {
				await provider.dispose();
				this.processProvider = void 0;
			} catch (error) {
				failures.push(error);
			}
			const disposeRuntime = this.runtimeDisposer;
			if (disposeRuntime !== void 0) {
				this.runtimeDisposer = void 0;
				try {
					await disposeRuntime();
				} catch (error) {
					failures.push(error);
				}
			}
		}
		if (flushError !== void 0 && failures.length > 0) failures.unshift(flushError);
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, "runtime connection and process owner cleanup failed");
	}
	async handleIncomingRequest(method, params) {
		if (method !== "approval/request") throw new SdkProtocolError("unsupported server request: " + method);
		const request = approvalRequest(params);
		const relay = this.approvalRelay;
		if (request === void 0 || relay !== void 0 && request.operationId !== relay.operationId) throw new SdkProtocolError("approval/request does not match the active SDK operation");
		if (this.closeTask !== void 0) return {
			operationId: request.operationId,
			requestId: request.requestId,
			outcome: "cancelled"
		};
		const key = approvalKey(request.operationId, request.requestId);
		if (this.seenApprovalRequests.has(key)) return {
			operationId: request.operationId,
			requestId: request.requestId,
			outcome: "unavailable"
		};
		this.seenApprovalRequests.add(key);
		const controller = new AbortController();
		this.activeApprovalRequests.set(key, controller);
		const cancelled = Promise.withResolvers();
		const onAbort = () => {
			cancelled.resolve("cancelled");
		};
		controller.signal.addEventListener("abort", onAbort, { once: true });
		if (controller.signal.aborted) onAbort();
		const work = Promise.resolve().then(() => {
			if (relay !== void 0) return relay.request(request, controller.signal);
			return this.options.onApprovalRequest?.(request, controller.signal) ?? "unavailable";
		}).then((outcome) => isApprovalOutcome(outcome) ? outcome : "unavailable", () => "unavailable");
		const task = Promise.race([work, cancelled.promise]);
		this.approvalWork.add(task);
		task.then(() => {
			this.approvalWork.delete(task);
		});
		let timer;
		try {
			const timeout = this.runtime.requestTimeoutMs;
			const outcome = timeout === void 0 ? await task : await Promise.race([task, new Promise((resolveOutcome) => {
				timer = setTimeout(() => {
					controller.abort(new RequestTimeoutError(`approval/request timed out after ${timeout}ms`));
					resolveOutcome("cancelled");
				}, timeout);
			})]);
			return {
				operationId: request.operationId,
				requestId: request.requestId,
				outcome: controller.signal.aborted ? "cancelled" : outcome
			};
		} finally {
			if (timer !== void 0) clearTimeout(timer);
			controller.signal.removeEventListener("abort", onAbort);
			this.activeApprovalRequests.delete(key);
		}
	}
	cancelApproval(params) {
		if (typeof params.operationId !== "string" || typeof params.requestId !== "string") return;
		this.activeApprovalRequests.get(approvalKey(params.operationId, params.requestId))?.abort(/* @__PURE__ */ new Error("parent approval request was cancelled"));
	}
	abortApprovalRequests(reason) {
		for (const controller of this.activeApprovalRequests.values()) controller.abort(reason);
	}
	dispatchNotification(notification) {
		this.recordSessionRelationship(notification);
		for (const subscription of this.subscriptions.values()) subscription.push(notification);
	}
	recordSessionRelationship(notification) {
		if (notification.method !== "subagent.started") return;
		const parentId = notification.params.parentSessionId;
		const childId = notification.params.childSessionId;
		if (typeof parentId === "string" && parentId !== "" && typeof childId === "string" && childId !== "" && parentId !== childId) this.sessionParents.set(childId, parentId);
	}
	isDescendantOf(sessionId, rootSessionId) {
		const visited = /* @__PURE__ */ new Set();
		let current = sessionId;
		while (!visited.has(current)) {
			if (current === rootSessionId) return true;
			visited.add(current);
			const parent = this.sessionParents.get(current);
			if (parent === void 0) return false;
			current = parent;
		}
		/* v8 ignore next */
		return false;
	}
	failSubscriptions(error) {
		for (const subscription of this.subscriptions.values()) subscription.fail(error);
	}
	appendStderr(lines) {
		const kept = lines.filter((line) => line.length > 0);
		this.stderrTail.push(...kept);
		if (this.stderrTail.length > STDERR_TAIL_LIMIT) this.stderrTail.splice(0, this.stderrTail.length - STDERR_TAIL_LIMIT);
	}
	settleStreams() {
		return Promise.race([this.streamsSettled, new Promise((resolve) => {
			setTimeout(resolve, STREAM_SETTLE_MS);
		})]);
	}
	closedError(reason) {
		const parts = [`${this.runtime.description}: ${reason}`];
		if (this.spawnError !== void 0) parts.push(`spawn error: ${this.spawnError.message}`);
		if (this.rangeError !== void 0) parts.push(`managed-range error: ${this.rangeError.message}`);
		if (this.exitCode !== void 0) parts.push(`exit code: ${String(this.exitCode)}`);
		if (this.stderrTail.length > 0) parts.push(`stderr tail:\n${this.stderrTail.join("\n")}`);
		return new TransportClosedError(parts.join("\n"));
	}
};
/**
* Whether `value` is a plain JSON object (the wire-boundary shape probe).
* @param value - the wire value to probe.
* @returns `true` iff `value` is a non-null, non-array object.
*/
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function approvalRequest(value) {
	if (!isRecord(value) || typeof value.operationId !== "string" || value.operationId.length === 0 || typeof value.requestId !== "string" || value.requestId.length === 0 || typeof value.sessionId !== "string" || value.sessionId.length === 0 || value.toolName !== "write_file" || typeof value.callId !== "string" || value.callId.length === 0 || value.reason !== void 0 && typeof value.reason !== "string") return void 0;
	return {
		operationId: value.operationId,
		requestId: value.requestId,
		sessionId: value.sessionId,
		toolName: "write_file",
		callId: value.callId,
		...value.reason === void 0 ? {} : { reason: value.reason }
	};
}
function isApprovalOutcome(value) {
	return value === "allowed-once" || value === "rejected" || value === "cancelled" || value === "unavailable";
}
function approvalKey(operationId, requestId) {
	return `${operationId}\\0${requestId}`;
}
/** The message of a thrown value (the transport only throws `Error`s; `String` covers the rest). */
function errorMessage(error) {
	/* v8 ignore next -- the transport and dispose ladder reject only with Errors */
	return error instanceof Error ? error.message : String(error);
}
//#endregion
//#region ../sdk-runtime/src/api.ts
/**
* High-level run API over {@link HarnessClient}: `DeepSeekHarness` owns one
* runtime subprocess across many sessions; `HarnessSession.run` sends a
* prompt and settles when the whole agent next becomes idle.
*
* @module @deepseek-ai/dsh-sdk-runtime/api
*/
/**
* Reusable SDK for running DeepSeek Harness agent turns in a runtime
* subprocess. The subprocess starts lazily on first use and stays owned by
* this instance until {@link close}; always close (or `await using`) so the
* child is reaped.
*/
var DeepSeekHarness$1 = class {
	clientInstance;
	createClient;
	cwd;
	provider;
	model;
	reasoningEffort;
	maxTokens;
	maxSteps;
	allowedTools;
	workspaceWriteRoot;
	initializationResult;
	initialized;
	closed = false;
	/** @param options - dsh launch configuration plus the session route, effort, and output cap. */
	constructor(options, clientFactory) {
		this.createClient = clientFactory;
		this.clientInstance = this.createClient();
		this.cwd = resolve(options.cwd ?? options.processCwd ?? process.cwd());
		this.provider = options.provider ?? "deepseek-official";
		this.model = options.model ?? "deepseek-v4-flash";
		this.reasoningEffort = options.reasoningEffort;
		this.maxTokens = options.maxTokens;
		this.maxSteps = options.maxSteps;
		this.allowedTools = options.allowedTools === void 0 ? void 0 : [...options.allowedTools];
		this.workspaceWriteRoot = options.workspaceWriteRoot;
	}
	/**
	* The underlying JSON-RPC client (exposed for low-level access). A failed
	* handshake swaps in a fresh instance only after cleanup proves the runtime
	* exited; cleanup failure retains this client, so do not cache it across a
	* failed {@link start}.
	* @returns the client currently owning the runtime subprocess.
	*/
	get client() {
		return this.clientInstance;
	}
	/**
	* Initialization result from the selected runtime, including a negotiated step cap when supported.
	* @returns the result after a successful handshake, otherwise `undefined`.
	*/
	get initializedWith() {
		return this.initializationResult;
	}
	/**
	* Start the subprocess and perform the `initialize` handshake once. On
	* failure, successful SDK-owned cleanup reaps the runtime and installs a
	* fresh client (`HarnessClient.close` is permanent), so a later call retries
	* with a new subprocess unless {@link close} already ended this harness. If
	* cleanup also fails, rejects with an `AggregateError` whose ordered errors
	* preserve both causes and retains the failed client rather than spawning
	* alongside a process whose exit was not proved.
	* @returns settlement of the (memoized) handshake.
	*/
	start() {
		this.initialized ??= (async () => {
			try {
				this.clientInstance.start();
				this.initializationResult = await this.clientInstance.initialize({
					cwd: this.cwd,
					provider: this.provider,
					model: this.model,
					...this.reasoningEffort === void 0 ? {} : { reasoningEffort: this.reasoningEffort },
					...this.maxTokens === void 0 ? {} : { maxTokens: this.maxTokens },
					...this.maxSteps === void 0 ? {} : { maxSteps: this.maxSteps },
					...this.allowedTools === void 0 ? {} : { allowedTools: [...this.allowedTools] },
					...this.workspaceWriteRoot === void 0 ? {} : { workspaceWriteRoot: this.workspaceWriteRoot }
				});
			} catch (error) {
				this.initialized = void 0;
				this.initializationResult = void 0;
				try {
					await this.clientInstance.close();
				} catch (cleanupError) {
					throw new AggregateError([error, cleanupError], "DeepSeek Harness initialization and cleanup failed");
				}
				if (!this.closed) this.clientInstance = this.createClient();
				throw error;
			}
		})();
		return this.initialized;
	}
	/**
	* Open a session handle (no wire traffic; the runtime creates the session
	* on its first prompt).
	* @param sessionId - explicit id to reuse; omitted mints a fresh one.
	* @returns the session handle.
	*/
	session(sessionId) {
		return new HarnessSession(this, sessionId ?? `session-${randomUUID().replaceAll("-", "")}`);
	}
	/**
	* Run one prompt on a fresh (or named) session.
	* @param input - prompt text, or content blocks sent verbatim.
	* @param options - optional session id and per-notification observer.
	* @returns the owned activity interval.
	*/
	run(input, options) {
		return this.session(options?.sessionId).run(input, options);
	}
	/**
	* Shut down and reap the runtime subprocess. Idempotent and terminal —
	* a closed harness no longer retries a failed handshake.
	* @returns settlement of the complete teardown.
	*/
	close() {
		this.closed = true;
		return this.clientInstance.close();
	}
	/**
	* `await using` support: {@link close}.
	* @returns settlement of the teardown.
	*/
	[Symbol.asyncDispose]() {
		return this.close();
	}
};
/**
* One SDK session: a stable id plus owned activity intervals.
*/
var HarnessSession = class {
	harness;
	id;
	/**
	* @param harness - the owning harness (supplies the client and handshake).
	* @param id - the wire session id this handle runs on.
	*/
	constructor(harness, id) {
		this.harness = harness;
		this.id = id;
	}
	/**
	* Queue input for this admitted native SDK root's next step and wake a parked root without cancelling dispatch.
	* @param input - text or encoded-image content, using the same admission as run.
	* @returns the durable message id; idle Sessions and unsupported profiles reject.
	*/
	async steer(input) {
		await this.harness.start();
		return this.harness.client.steer(this.id, normalizeInput(input));
	}
	/**
	* Cancel this Session's admitted native-sdk turn and await owned cleanup.
	* @returns false when no admitted turn was active; rejects on unsupported profiles.
	*/
	async cancel() {
		await this.harness.start();
		return this.harness.client.cancel(this.id);
	}
	/**
	* Fork a closed native-sdk turn into a fresh Session handle without running it.
	* @param destinationSessionId - fresh destination identity under this harness.
	* @param atSeq - source event in a closed turn; omitted selects its last closed turn.
	* @returns a handle whose next run resumes the durable copied history.
	*/
	async fork(destinationSessionId, atSeq) {
		await this.harness.start();
		const id = await this.harness.client.fork(this.id, destinationSessionId, atSeq);
		return this.harness.session(id);
	}
	/**
	* Queue one prompt, then observe the whole session through its next idle.
	* @param input - prompt text, or content blocks sent verbatim.
	* @param options - optional per-notification observer.
	* @returns the owned activity interval; rejects on transport loss, timeout,
	* or a protocol error.
	*/
	async run(input, options) {
		await this.harness.start();
		const client = this.harness.client;
		const contentBlocks = normalizeInput(input);
		const events = [];
		const notifications = [];
		const subscription = client.subscribeSessionTree(this.id);
		const collect = (notification) => {
			if (notification.method === "session.event" && notification.params.sessionId === this.id) {
				const event = validatedSessionEvent(notification.params.event);
				notifications.push(notification);
				options?.onNotification?.(notification);
				events.push(event);
				return;
			}
			notifications.push(notification);
			options?.onNotification?.(notification);
		};
		try {
			const messageId = await client.prompt(this.id, contentBlocks);
			let received = false;
			while (true) {
				const notification = await subscription.next();
				if (!received) {
					if (notification.method !== "session.event" || notification.params.sessionId !== this.id || !isInboxReceipt(notification.params.event, messageId)) continue;
					received = true;
				}
				collect(notification);
				if (notification.method === "session.status" && notification.params.sessionId === this.id && notification.params.status === "idle") break;
			}
		} finally {
			subscription.close();
		}
		return {
			sessionId: this.id,
			finalResponse: finalResponse(events),
			events,
			notifications
		};
	}
};
/**
* Normalize run input: a string becomes one text block; blocks pass verbatim.
* @param input - prompt text or content blocks.
* @returns the content blocks to send.
*/
function normalizeInput(input) {
	return typeof input === "string" ? [{
		type: "text",
		text: input
	}] : input;
}
/** Validate the provider-read fields of one wire turn-end reason. */
function validatedTurnEndReason(value) {
	if (!isRecord(value) || typeof value.kind !== "string") throw new SdkProtocolError(`turn/end carried no reason envelope: ${JSON.stringify(value)}`);
	if (value.kind === "aborted") {
		if (!isRecord(value.reason) || typeof value.reason.kind !== "string") throw new SdkProtocolError(`turn/end carried a malformed aborted reason: ${JSON.stringify(value)}`);
		switch (value.reason.kind) {
			case "user":
			case "parent":
			case "disposed":
			case "legacy": break;
			case "hook":
				if (typeof value.reason.reason !== "string") throw new SdkProtocolError(`turn/end carried a malformed hook abort reason: ${JSON.stringify(value)}`);
				break;
			default: throw new SdkProtocolError(`turn/end carried an unknown abort reason: ${JSON.stringify(value)}`);
		}
	}
	return value;
}
/** Validate the fields in a wire `session.event` envelope before returning the typed result. */
function validatedSessionEvent(value) {
	if (!isRecord(value) || typeof value.type !== "string") throw new SdkProtocolError(`session.event carried no event envelope: ${JSON.stringify(value)}`);
	if (value.type === "assistant/message") {
		const message = isRecord(value.data) ? value.data.message : void 0;
		const content = isRecord(message) ? message.content : void 0;
		if (!Array.isArray(content) || !content.every((block) => isRecord(block) && typeof block.type === "string")) throw new SdkProtocolError(`assistant/message event carried malformed content: ${JSON.stringify(value)}`);
	}
	if (value.type === "turn/end") {
		const data = isRecord(value.data) ? value.data : void 0;
		if (data === void 0) throw new SdkProtocolError(`turn/end event carried malformed data: ${JSON.stringify(value)}`);
		validatedTurnEndReason(data.reason);
	}
	return value;
}
/** Whether a raw session event is the durable enqueue receipt for `messageId`. */
function isInboxReceipt(value, messageId) {
	if (!isRecord(value) || value.type !== "agent/inbox/spliced" || !isRecord(value.data)) return false;
	const inserted = value.data.inserted;
	return Array.isArray(inserted) && inserted.some((message) => isRecord(message) && message.id === messageId);
}
/**
* Extract the concatenated text of the last assistant message.
* @param events - the activity interval's `session.event` payloads in wire order.
* @returns the final response text, or `''` when no assistant message exists.
*/
function finalResponse(events) {
	for (let index = events.length - 1; index >= 0; index--) {
		const event = events[index];
		if (event?.type !== "assistant/message") continue;
		return event.data.message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
	}
	return "";
}
//#endregion
//#region ../../../Core/util/home-paths/src/profile-runtime.ts
/** Shared validation for profile execution markers stored under a DSH home. */
function object(value, label) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
	return value;
}
function record(value, label, allowed) {
	const fields = object(value, label);
	for (const key of Object.keys(fields)) if (!allowed.includes(key)) throw new Error(`${label} has unknown field ${key}`);
	return fields;
}
/**
* Read the runtime marker from one profile package manifest.
* @param profileDir - directory containing the profile's package.json.
* @returns the validated profile runtime and configuration reload mode.
*/
function resolveDshProfileDirectoryExecution(profileDir) {
	const manifestPath = join(profileDir, "package.json");
	if (!existsSync(manifestPath)) return {
		runtime: "legacy",
		reload: "startup"
	};
	const manifest = object(JSON.parse(readFileSync(manifestPath, "utf8")), "profile package");
	const dsh = manifest.dsh === void 0 ? {} : object(manifest.dsh, "profile dsh");
	const profile = dsh.profile === void 0 ? {} : record(dsh.profile, "dsh.profile", [
		"bundles",
		"patchReload",
		"runtime",
		"config",
		"configReload"
	]);
	if (profile.runtime === void 0) {
		if (profile.config !== void 0 || profile.configReload !== void 0) throw new Error("dsh.profile.config/configReload requires runtime native");
		return {
			runtime: "legacy",
			reload: "startup"
		};
	}
	if (profile.runtime !== "native" || profile.config !== "rsh.profile.json") throw new Error("dsh.profile.runtime/config must select native and rsh.profile.json");
	if (profile.bundles !== void 0 || profile.patchReload !== void 0) throw new Error("native profile cannot declare Cordis bundles or patchReload");
	if (profile.configReload !== void 0 && profile.configReload !== "startup" && profile.configReload !== "live") throw new Error("dsh.profile.configReload must be startup or live");
	return {
		runtime: "native",
		reload: profile.configReload ?? "startup"
	};
}
/**
* Read one profile's execution marker under the resolved Harness home.
* @param name - profile directory name.
* @param home - resolved Harness home.
* @returns the validated profile runtime and configuration reload mode.
*/
function resolveDshProfileExecution(name, home) {
	validateDshProfileName(name);
	return resolveDshProfileDirectoryExecution(join(home, "profiles", name));
}
/** Reject names that can escape or alias the profile directory.
* @param name - profile directory name.
*/
function validateDshProfileName(name) {
	if (name === "" || name === "." || name === ".." || name === "node_modules" || name.includes("/") || name.includes("\\")) throw new Error(`dsh: invalid profile name ${JSON.stringify(name)}`);
}
//#endregion
//#region ../../../Core/util/home-paths/src/index.ts
/** Directory name for the default DeepSeek Harness home under the OS home. */
const DSH_HOME_DIR_NAME = ".dsh";
/** Environment variable that overrides the default DeepSeek Harness home. */
const DSH_HOME_ENV = "DSH_HOME";
/**
* Resolve the default DeepSeek Harness home using Node's platform path rules.
* @returns the absolute default harness home path.
*/
function defaultDshHome() {
	return join(homedir(), DSH_HOME_DIR_NAME);
}
/**
* Expand supported tilde prefixes against the operating-system home.
* @param path - configured path that may begin with `~`, `~/`, or `~\`.
* @returns the expanded path, or the original value when no supported prefix is present.
*/
function expandHomePath(path) {
	if (path === "~") return homedir();
	if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
	return path;
}
/**
* Resolve the single-root DeepSeek Harness home.
*
* Precedence, highest first: an explicit configured path, `$DSH_HOME`, then
* `~/.dsh`. The harness keeps all user data under one root. An empty or
* whitespace-only `$DSH_HOME` is treated as unset, so a blank override never
* resolves the home to the current working directory.
* @param configured - explicit harness-home override, which has highest precedence.
* @param env - environment mapping used to read `DSH_HOME`.
* @returns the normalized absolute harness home path.
*/
function resolveDshHome(configured, env = process.env) {
	const fromEnv = env[DSH_HOME_ENV];
	return resolve(expandHomePath(configured ?? (fromEnv !== void 0 && fromEnv.trim().length > 0 ? fromEnv : defaultDshHome())));
}
/** Read a package manifest from one resolved package.json URL. */
function manifest(url) {
	return JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
}
/**
* Resolve and version-check a dsh executable from package manifests.
* @param dshManifestUrl - resolved URL of the dsh package manifest.
* @param clientManifestUrl - resolved URL of the SDK client manifest.
* @returns the absolute dsh executable path.
*/
function resolveDshBinFromManifests(dshManifestUrl, clientManifestUrl) {
	const dshManifest = manifest(dshManifestUrl);
	const clientManifest = manifest(clientManifestUrl);
	if (typeof dshManifest.version !== "string" || dshManifest.version !== clientManifest.version) throw new Error(`dsh SDK client ${String(clientManifest.version)} requires the same dsh version, got ${String(dshManifest.version)}`);
	const bin = typeof dshManifest.bin === "object" && dshManifest.bin !== null ? dshManifest.bin.dsh : dshManifest.bin;
	if (typeof bin !== "string" || bin === "") throw new Error("@deepseek-ai/dsh declares no dsh executable");
	return resolve(dirname(fileURLToPath(dshManifestUrl)), bin);
}
/**
* Resolve the Node launch for one same-version dsh package.
* @param dshManifestUrl - Resolved URL of the dsh package manifest.
* @param clientManifestUrl - Resolved URL of the SDK client manifest.
* @param options - Profile, home, and environment settings with an optional source-loader override for tests.
* @returns Built output or a source entry configured for the profile's declared runtime.
*/
function resolveDshNodeLaunchFromManifests(dshManifestUrl, clientManifestUrl, options = {}) {
	const profile = options.profile ?? "sdk";
	const environment = options.environment ?? process.env;
	const home = resolveDshHome(options.dshHome, environment);
	const bin = resolveDshBinFromManifests(dshManifestUrl, clientManifestUrl);
	if (existsSync(bin)) return {
		nodeArgs: [bin],
		patches: [],
		environment: {}
	};
	const packageDir = dirname(fileURLToPath(dshManifestUrl));
	const sourceBin = resolve(packageDir, "src/bin.ts");
	const sourcePatch = resolve(packageDir, "src/sdk-source.cordis.patch.yml");
	const sourceTsconfig = resolve(packageDir, "tsconfig.json");
	const nativeTemplates = manifest(dshManifestUrl).dsh?.nativeProfileTemplates;
	if (!Array.isArray(nativeTemplates) || nativeTemplates.some((name) => typeof name !== "string" || name === "")) throw new Error("@deepseek-ai/dsh does not declare its native profile templates");
	const shippedNativeProfile = nativeTemplates.includes(profile);
	const profileDirectory = join(home, "profiles", profile);
	const runtime = shippedNativeProfile && !existsSync(profileDirectory) ? "native" : resolveDshProfileExecution(profile, home).runtime;
	if (shippedNativeProfile && runtime !== "native") throw new Error(`dsh: existing ${profile} profile is not a complete native profile`);
	const cordisSourcePatch = runtime === "legacy";
	const sourceFiles = [
		sourceBin,
		...cordisSourcePatch ? [sourcePatch] : [],
		sourceTsconfig
	];
	if (sourceFiles.some((path) => !existsSync(path))) throw new Error(`@deepseek-ai/dsh is missing its built executable ${bin} and complete source launch files ${sourceFiles.join(", ")}`);
	return {
		nodeArgs: [
			"--import",
			options.sourceLoaderUrl ?? import.meta.resolve("tsx/esm"),
			sourceBin
		],
		patches: cordisSourcePatch ? [sourcePatch] : [],
		environment: { TSX_TSCONFIG_PATH: sourceTsconfig }
	};
}
/**
* Resolve the installed dsh package to a built or source Node launch.
* @returns the launch descriptor for the current checkout or installed package.
*/
function installedDshNodeLaunch(profile, dshHome, environment) {
	return resolveDshNodeLaunchFromManifests(import.meta.resolve("@deepseek-ai/dsh/package.json"), new URL("../package.json", import.meta.url).href, {
		profile,
		...dshHome === void 0 ? {} : { dshHome },
		environment
	});
}
/**
* Resolve caller-relative filesystem inputs and construct canonical dsh argv.
* @param options - public SDK launch options.
* @param callerCwd - parent-process directory used for lexical resolution.
* @returns one generic subprocess spec for the JSON-RPC transport.
*/
function resolveDshLaunch(options = {}, callerCwd = process.cwd()) {
	const profile = options.profile ?? "sdk";
	const dshHome = options.dshHome === void 0 ? void 0 : resolve(callerCwd, options.dshHome);
	const childEnvironment = options.env ?? process.env;
	const dshLaunch = options.dshBin === void 0 ? installedDshNodeLaunch(profile, dshHome, childEnvironment) : {
		nodeArgs: [resolve(callerCwd, options.dshBin)],
		patches: [],
		environment: {}
	};
	const patches = [...dshLaunch.patches, ...(options.patches ?? []).map((path) => resolve(callerCwd, path))];
	return {
		command: process.execPath,
		args: [
			...dshLaunch.nodeArgs,
			"--profile",
			profile,
			...patches.flatMap((path) => ["--patch", path])
		],
		...options.processCwd === void 0 ? {} : { cwd: resolve(callerCwd, options.processCwd) },
		environment: () => {
			const hasSystemRoot = Object.keys(childEnvironment).some((name) => name.toUpperCase() === "SYSTEMROOT");
			return {
				...process.platform === "win32" && !hasSystemRoot && process.env.SystemRoot !== void 0 ? { SystemRoot: process.env.SystemRoot } : {},
				...childEnvironment,
				...dshLaunch.environment,
				...dshHome === void 0 ? {} : { DSH_HOME: dshHome }
			};
		},
		description: `dsh profile ${JSON.stringify(profile)}`,
		initializeTimeoutMs: options.initializeTimeoutMs ?? 3e4,
		...options.requestTimeoutMs === void 0 ? {} : { requestTimeoutMs: options.requestTimeoutMs },
		...options.shutdownTimeoutMs === void 0 ? {} : { shutdownTimeoutMs: options.shutdownTimeoutMs },
		...options.disposeEofGraceMs === void 0 ? {} : { disposeEofGraceMs: options.disposeEofGraceMs },
		...options.disposeGraceMs === void 0 ? {} : { disposeGraceMs: options.disposeGraceMs }
	};
}
//#endregion
//#region ../../../Programs/SDK/packages/client/src/client.ts
/** Program-owned launcher facade for the Engine SDK transport. */
/** Low-level public SDK client using the Program-owned dsh launcher. */
var HarnessClient = class extends HarnessClient$1 {
	constructor(options = {}, runtime = resolveDshLaunch(options)) {
		super(options, runtime);
	}
};
//#endregion
//#region ../../../Programs/SDK/packages/client/src/api.ts
/** Public SDK facade that supplies the Program-owned standard dsh launcher. */
/** High-level public SDK facade using the Program-owned standard dsh launcher. */
var DeepSeekHarness = class extends DeepSeekHarness$1 {
	constructor(options = {}, clientFactory) {
		super(options, clientFactory ?? (() => new HarnessClient(options)));
	}
	get client() {
		return super.client;
	}
};
//#endregion
//#region lib/types/run.js
/**
* Fresh-process SDK subagent client. Drives one child DeepSeek Harness
* runtime over stdio JSON-RPC through `@deepseek-ai/dsh-sdk-client` and owns
* cancellation and quiescent disposal. It publishes after the child
* handshake, maps child failures to stop reasons, and tears down to
* quiescence. The SDK client spawns the child rather than using
* `ctx.subprocess` — the subprocess seam's documented exception for
* SDK-managed transports — so this driver applies the seam's shared env scrub.
*
* @module @deepseek-ai/dsh-subagent-dsh-sdk/run
*/
/** EOF grace for child flush and nested-process teardown; wider than the signal grace below. */
const DEFAULT_DISPOSE_EOF_GRACE_MS = 6e3;
/** Default POSIX grace between SIGTERM and SIGKILL on dispose (the `disposeGraceMs` config). */
const DEFAULT_DISPOSE_GRACE_MS = 3e3;
/** Default bound on the protocol `shutdown` exchange during dispose. */
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 1e3;
/** Fixed safe failure text derived only from provider-owned structured facts. */
function failureDiagnostic(facts) {
	return `Subagent failure (${[
		"provider: DSH SDK",
		`stage: ${facts.stage}`,
		`category: ${facts.category}`
	].join("; ")})`;
}
var SdkRunFailure = class extends Error {
	facts;
	constructor(facts, cause) {
		super(`subagent-dsh-sdk: ${failureDiagnostic(facts)}`, { cause });
		this.facts = facts;
		this.name = "SdkRunFailure";
	}
};
/** Runtime constructor seam replaced only by package-local fake-runtime tests. */
const internals = { createHarness: (options) => new DeepSeekHarness(options) };
/**
* Hide a pre-spawn workspace/configuration failure behind fixed safe facts.
* @param cause - original Host failure retained on the Error cause chain.
* @returns an Error whose message contains only the fixed DSH SDK failure line.
*/
function sdkConfigurationFailure(cause) {
	return new SdkRunFailure({
		stage: "initialize",
		category: "configuration"
	}, cause);
}
/** Classify one SDK rejection without reading its message or stderr tail. */
function sdkFailure(error, stage) {
	return new SdkRunFailure(error instanceof TransportClosedError ? {
		stage,
		category: "transport"
	} : error instanceof SdkProtocolError || error instanceof JsonRpcResponseError ? {
		stage,
		category: "protocol"
	} : {
		stage,
		category: "unknown"
	}, error);
}
/**
* Map one child terminal reason to its complete shared result outcome.
* @param reason - the owned child run's final durable turn reason, or
* `undefined` when it settled without running a turn.
* @returns the shared stop reason and any additional safe diagnostic.
*/
function sdkChildOutcome(reason) {
	switch (reason?.kind) {
		case "completed": return { stopReason: "completed" };
		case "max-tokens": return { stopReason: "max-tokens" };
		case "aborted": return reason.reason.kind === "disposed" ? {
			stopReason: "aborted",
			diagnostic: failureDiagnostic({
				stage: "session-run",
				category: "child-disposed"
			})
		} : { stopReason: "aborted" };
		case "blocked": return { stopReason: "refusal" };
		case "error": return {
			stopReason: "error",
			diagnostic: failureDiagnostic({
				stage: "session-run",
				category: "child-error"
			})
		};
		case "interrupted": return { stopReason: "error" };
		case void 0: return {
			stopReason: "error",
			diagnostic: failureDiagnostic({
				stage: "session-run",
				category: "missing-terminal"
			})
		};
		default: return {
			stopReason: "error",
			diagnostic: failureDiagnostic({
				stage: "session-run",
				category: "child-unknown"
			})
		};
	}
}
/** Normalize an unknown thrown value to an Error (the catch binding is `unknown`). */
function toError(value) {
	/* v8 ignore next */
	return value instanceof Error ? value : new Error(String(value));
}
/** Report an original Host failure without letting the observation sink replace it. */
function reportFailure(spec, error) {
	try {
		spec.onError?.(toError(error), "error");
	} catch {}
}
/** Map an SDK-owned failed-start aggregate into safe initialize/shutdown lines. */
function sdkStartupFailure(spec, error) {
	if (!(error instanceof AggregateError) || error.errors.length < 2) {
		reportFailure(spec, error);
		return sdkFailure(error, "initialize");
	}
	const initializeError = error.errors[0];
	const cleanupError = error.errors[1];
	reportFailure(spec, initializeError);
	reportFailure(spec, cleanupError);
	const initializeFailure = sdkFailure(initializeError, "initialize");
	const cleanupFailure = new SdkRunFailure({
		stage: "shutdown",
		category: "unknown"
	}, cleanupError);
	return new AggregateError([initializeFailure, cleanupFailure], `${initializeFailure.message}; ${cleanupFailure.message}`);
}
/**
* Start and publish one SDK runtime child after its `initialize` handshake.
* Child failures resolve through the run result. Startup rejects with fixed
* safe facts after SDK-owned cleanup; successful cleanup proves process reap.
* Cleanup failure preserves initialize plus shutdown for an ordinary failure,
* or shutdown alone after cancellation, without claiming quiescence. Disposal
* shuts the runtime down and reaps it.
* @param request - the start request; its signal is the cancellation channel.
* @param spec - the resolved spawn spec: profile/patches/home/cwd, the child's
* provider/model/reasoning route, output cap, env, timeouts, and the optional
* error sink.
* @returns the ready run handle for the child subprocess.
*/
async function startSdkRun(request, spec) {
	if (request.signal.aborted) throw new Error("subagent request was aborted before the SDK child started");
	const id = brandString(randomUUID());
	const harness = internals.createHarness({
		...spec.dshBin === void 0 ? {} : { dshBin: spec.dshBin },
		profile: spec.profile,
		patches: spec.patches,
		dshHome: spec.dshHome,
		processCwd: spec.cwd,
		env: {
			...scrubbedParentEnv(),
			...spec.env
		},
		shutdownTimeoutMs: spec.shutdownTimeoutMs,
		disposeEofGraceMs: spec.disposeEofGraceMs,
		disposeGraceMs: spec.disposeGraceMs,
		cwd: spec.cwd,
		provider: spec.provider,
		model: spec.model,
		...spec.reasoningEffort === void 0 ? {} : { reasoningEffort: spec.reasoningEffort },
		...spec.maxTokens === void 0 ? {} : { maxTokens: spec.maxTokens }
	});
	const flags = { cancelled: false };
	let signalCancelSettled;
	const cancelSettled = new Promise((resolve) => {
		signalCancelSettled = resolve;
	});
	const requestCancel = () => {
		if (flags.cancelled) return;
		flags.cancelled = true;
		signalCancelSettled();
	};
	const onAbort = () => {
		requestCancel();
	};
	request.signal.addEventListener("abort", onAbort, { once: true });
	const cancelledStartup = /* @__PURE__ */ new Error("subagent cancelled before the SDK child initialized");
	try {
		await Promise.race([harness.start(), cancelSettled.then(() => {
			throw cancelledStartup;
		})]);
		/* v8 ignore next */
		if (flags.cancelled) throw cancelledStartup;
	} catch (error) {
		request.signal.removeEventListener("abort", onAbort);
		if (error !== cancelledStartup) throw sdkStartupFailure(spec, error);
		try {
			await harness.close();
		} catch (cleanupError) {
			reportFailure(spec, cleanupError);
			const cleanupFailure = new SdkRunFailure({
				stage: "shutdown",
				category: "unknown"
			}, cleanupError);
			throw new AggregateError([cleanupFailure], cleanupFailure.message);
		}
		throw new Error("subagent request was aborted before the SDK child started");
	}
	const childSessionId = `session-${randomUUID().replaceAll("-", "")}`;
	const fold = new AssistantOutputFold();
	const observe = (notification) => {
		if (notification.method !== "session.event" || notification.params.sessionId !== childSessionId) return;
		fold.push(notification.params.event);
	};
	const collectOutput = () => fold.collect() ?? [];
	const teardown = async () => {
		try {
			await harness.close();
		} catch (error) {
			reportFailure(spec, error);
			throw new SdkRunFailure({
				stage: "shutdown",
				category: "unknown"
			}, error);
		}
	};
	let diagnostic;
	return subprocessRunHandle({
		id,
		result: settleRunResult({
			attempt: async () => {
				try {
					const turn = await Promise.race([harness.session(childSessionId).run(request.prompt, { onNotification: observe }), cancelSettled.then(() => "cancelled")]);
					if (turn === "cancelled") return {
						output: collectOutput(),
						stopReason: "aborted"
					};
					const outcome = sdkChildOutcome(turn.events.findLast((event) => event.type === "turn/end")?.data.reason);
					diagnostic = outcome.diagnostic;
					return {
						output: collectOutput(),
						...outcome
					};
				} catch (error) {
					diagnostic = failureDiagnostic(sdkFailure(error, "session-run").facts);
					throw error;
				}
			},
			collectOutput,
			collectDiagnostic: () => diagnostic,
			cancelled: () => flags.cancelled,
			onError: spec.onError,
			signal: request.signal,
			onAbort
		}),
		signal: request.signal,
		onAbort,
		requestCancel,
		teardown
	});
}
//#endregion
//#region lib/types/index.js
/**
* Out-of-process SDK subagent backend. Each child is a complete DeepSeek
* Harness runtime in its own process — own named profile and patch composition,
* session, model route, and tools — driven over stdio JSON-RPC through the
* TypeScript SDK client, so it shares no Cordis context. It accepts the
* provider/model/reasoning/maxTokens subset of `agentOptions`; other start
* features remain unsupported. The ONE thing it reads off `request.parent`
* is the session's workspace cwd. This plugin uses named
* exports only; a default would hide its loader metadata (see
* `rsh/Docs/postmortem/0001-acp-default-export-drops-inject.md`).
* @module @deepseek-ai/dsh-subagent-dsh-sdk
*/
const name = "subagent-dsh-sdk";
const inject = ["subagents"];
const Config = Schema.object({
	providerName: Schema.string().default("dsh-sdk"),
	dshBin: Schema.string(),
	profile: Schema.string().default("sdk"),
	patches: Schema.array(Schema.string()).default([]),
	dshHome: Schema.string().required(),
	cwd: Schema.string(),
	provider: Schema.string().default("deepseek-official"),
	model: Schema.string().default("deepseek-v4-flash"),
	maxTokens: Schema.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
	env: Schema.dict(Schema.string()).default({}),
	shutdownTimeoutMs: Schema.number().default(DEFAULT_SHUTDOWN_TIMEOUT_MS),
	disposeEofGraceMs: Schema.number().default(DEFAULT_DISPOSE_EOF_GRACE_MS),
	disposeGraceMs: Schema.number().default(DEFAULT_DISPOSE_GRACE_MS)
});
/** Resolve one configured runtime file against the harness launch directory and require a regular file. */
function resolveConfiguredFile(field, value) {
	const path = resolve(value);
	try {
		if (statSync(path).isFile()) return path;
	} catch {}
	throw new TypeError(`subagent-dsh-sdk ${field} must name an existing file: ${path}`);
}
/** DSH SDK can apply Agent route options while the other start features remain child-owned. */
const SDK_START_CAPABILITIES = Object.freeze({
	...NO_START_CAPABILITIES,
	agentOptions: true
});
/** Merge the request's supported route fields over this provider instance's defaults. */
function resolveSdkRoute(config, requested) {
	const maxTokens = requested?.maxTokens ?? config.maxTokens;
	return {
		provider: requested?.provider ?? config.provider,
		model: requested?.model ?? config.model,
		...requested?.reasoningEffort === void 0 ? {} : { reasoningEffort: requested.reasoningEffort },
		...maxTokens === void 0 ? {} : { maxTokens }
	};
}
/**
* The SDK provider. It resolves Agent route options into the child runtime's
* process-wide handshake; output schema, depth, tool filter, and persona stay
* unsupported because their ownership does not cross this process boundary.
*/
var SdkSubagentProvider = class {
	name;
	ctx;
	config;
	capabilities = SDK_START_CAPABILITIES;
	agentRouteDefaults;
	inheritsParentContext = false;
	constructor(name, ctx, config) {
		this.name = name;
		this.ctx = ctx;
		this.config = config;
		this.agentRouteDefaults = Object.freeze({
			provider: config.provider,
			model: config.model
		});
	}
	start(request) {
		if (request.signal.aborted) throw new Error("subagent request was aborted before the SDK child started");
		let cwd;
		try {
			cwd = resolveChildCwd("subagent-dsh-sdk", this.config.cwd, request.parent.session.header.cwd);
		} catch (error) {
			const failure = sdkConfigurationFailure(error);
			this.ctx.logger.warn(`subagent-dsh-sdk "${this.name}": child start failed: %o`, error);
			throw failure;
		}
		const route = resolveSdkRoute(this.config, request.agentOptions);
		return startSdkRun(request, {
			...this.config.dshBin === void 0 ? {} : { dshBin: this.config.dshBin },
			profile: this.config.profile,
			patches: this.config.patches,
			dshHome: this.config.dshHome,
			cwd,
			...route,
			env: this.config.env,
			shutdownTimeoutMs: this.config.shutdownTimeoutMs,
			disposeEofGraceMs: this.config.disposeEofGraceMs,
			disposeGraceMs: this.config.disposeGraceMs,
			onError: (error, stopReason) => {
				this.ctx.logger.warn(`subagent-dsh-sdk "${this.name}": child run failed (${stopReason}): ${error.message}`);
			}
		});
	}
};
function apply(ctx, config) {
	const resolved = config;
	assertPositiveFinite("subagent-dsh-sdk", "shutdownTimeoutMs", resolved.shutdownTimeoutMs);
	assertPositiveFinite("subagent-dsh-sdk", "disposeEofGraceMs", resolved.disposeEofGraceMs);
	assertPositiveFinite("subagent-dsh-sdk", "disposeGraceMs", resolved.disposeGraceMs);
	if (resolved.maxTokens !== void 0 && (!Number.isSafeInteger(resolved.maxTokens) || resolved.maxTokens <= 0)) throw new TypeError("subagent-dsh-sdk maxTokens must be a positive safe integer");
	if (!isAbsolute(resolved.dshHome)) throw new TypeError("subagent-dsh-sdk dshHome must be an absolute path");
	const launchPaths = {
		...resolved,
		patches: resolved.patches.map((path, index) => resolveConfiguredFile(`patches[${String(index)}]`, path)),
		...resolved.dshBin === void 0 ? {} : { dshBin: resolveConfiguredFile("dshBin", resolved.dshBin) }
	};
	const configuredCwd = validateConfiguredCwd("subagent-dsh-sdk", resolved.cwd);
	const validated = configuredCwd === void 0 ? launchPaths : {
		...launchPaths,
		cwd: configuredCwd
	};
	ctx.subagents.registerProvider(new SdkSubagentProvider(validated.providerName, ctx, validated));
}
//#endregion
export { Config, apply, inject, name };
