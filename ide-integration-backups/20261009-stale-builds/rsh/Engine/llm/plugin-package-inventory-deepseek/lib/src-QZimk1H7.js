import { a as isNonNullable, i as defineProperty, n as hyphenate, o as isNullable, r as deepEqual, s as mapValues, t as Schema$1 } from "./src-L60_K02-.js";
import { createRequire, isBuiltin } from "node:module";
import { existsSync } from "node:fs";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { access, chmod, constants, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { setTimeout as setTimeout$1 } from "node:timers/promises";
import { randomBytes } from "node:crypto";
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
//#region ../../../Core/vendor/loader/src/internal.ts
let ModuleLoader;
(function(_ModuleLoader) {
	let _cachedLoader;
	function requireInternal(id) {
		const require = createRequire(import.meta.url);
		if (process.execArgv.includes("--expose-internals")) try {
			return require(id);
		} catch {}
		try {
			return require("node-addon-require-builtin").requireBuiltin(id);
		} catch {}
	}
	function fromInternal() {
		if (_cachedLoader) return _cachedLoader;
		const [major] = process.versions.node.split(".").map(Number);
		if (major < 22) return;
		const raw = requireInternal("internal/modules/esm/loader")?.getOrInitializeCascadedLoader();
		if (!raw) return;
		const version = typeof raw.getOrCreateModuleJob === "function" ? "v2" : typeof raw.getModuleJobForImport === "function" ? "v1" : void 0;
		if (!version) return;
		return _cachedLoader = Object.assign(raw, { version });
	}
	_ModuleLoader.fromInternal = fromInternal;
})(ModuleLoader || (ModuleLoader = {}));
//#endregion
//#region ../../../Core/vendor/loader/src/config/group.ts
/** Runtime owner for a list of child loader entries. */
var EntryGroup = class {
	ctx;
	tree;
	static key = Symbol.for("cordis.group");
	data = [];
	constructor(ctx, tree) {
		this.ctx = ctx;
		this.tree = tree;
		const entry = ctx.fiber.entry;
		if (entry) entry.subgroup = this;
	}
	get context() {
		return this.ctx;
	}
	async create(options) {
		const id = this.tree.ensureId(options);
		const existing = this.tree.store[id];
		const entry = existing ?? (this.tree.store[id] = new Entry(this.ctx.loader));
		const previousParent = entry.parent;
		entry.parent = this;
		try {
			await entry.update(options, true, true);
		} catch (error) {
			if (existing) entry.parent = previousParent;
			else delete this.tree.store[id];
			throw error;
		}
		return entry.id;
	}
	unlink(options) {
		const config = this.data;
		const index = config.indexOf(options);
		if (index >= 0) config.splice(index, 1);
	}
	async remove(id, isDispose = false) {
		const entry = this.tree.store[id];
		if (!entry) return;
		await entry._dispose();
		if (!isDispose) this.unlink(entry.options);
		delete this.tree.store[id];
		this.context.emit("loader/partial-dispose", entry, entry.options, false);
	}
	async update(config) {
		const oldConfig = this.data;
		const seen = /* @__PURE__ */ new Set();
		for (const options of config) {
			const id = this.tree.ensureId(options);
			if (seen.has(id)) throw new TypeError(`duplicate loader entry id: ${id}`);
			seen.add(id);
		}
		const oldMap = Object.fromEntries(oldConfig.map((options) => [options.id, options]));
		const newMap = Object.fromEntries(config.map((options) => [options.id, options]));
		try {
			const outcomes = await Promise.allSettled(config.map((options) => this.create(options)));
			if (this.ctx.fiber.uid === null) return;
			const failures = outcomes.filter((outcome) => outcome.status === "rejected").map((outcome) => outcome.reason);
			if (failures.length === 1) throw failures[0];
			if (failures.length > 1) throw new AggregateError(failures, "loader entries failed to apply");
			for (const id of Object.keys(oldMap)) if (!newMap[id]) await this.remove(id, true);
			this.data = config;
		} catch (error) {
			const rollbackErrors = [];
			for (const id of Object.keys(newMap).reverse()) {
				if (oldMap[id]) continue;
				try {
					await this.remove(id, true);
				} catch (rollbackError) {
					rollbackErrors.push(rollbackError);
				}
			}
			for (const options of oldConfig) try {
				await this.create(options);
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError);
			}
			this.data = oldConfig;
			if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], "loader entry rollback failed");
			throw error;
		}
	}
	async stop() {
		for (const options of this.data) await this.remove(options.id, true);
	}
};
EntryGroup.key, Service.init;
//#endregion
//#region ../../../Core/vendor/loader/src/config/tree.ts
/** Mutable tree of loader entries. Persistence is supplied by subclasses. */
var EntryTree = class EntryTree {
	static sep = ":";
	ctx;
	enableLogs;
	root;
	store = Object.create(null);
	constructor(ctx) {
		this.ctx = ctx.extend({ baseUrl: ctx.baseUrl });
		this.root = new EntryGroup(this.ctx, this);
		const entry = this.ctx.fiber.entry;
		if (entry) entry.subtree = this;
	}
	get context() {
		return this.ctx;
	}
	/** Iterate entries in this tree and any nested subtrees. */
	*entries() {
		for (const entry of Object.values(this.store)) {
			yield entry;
			if (!entry.subtree) continue;
			yield* entry.subtree.entries();
		}
	}
	/** Return pending import and lifecycle tasks owned by this tree. */
	getTasks() {
		return [...this.entries()].map((entry) => entry._initTask || entry.fiber?.inertia).filter(isNonNullable);
	}
	/**
	* Wait until this tree has no active import or lifecycle tasks.
	* @throws a settled fiber failure, or an aggregate when several fibers failed.
	*/
	async await() {
		while (true) {
			const tasks = this.getTasks();
			if (tasks.length) {
				await Promise.allSettled(tasks);
				continue;
			}
			const failures = (await Promise.allSettled([...this.entries()].map((entry) => entry._await()))).filter((outcome) => outcome.status === "rejected").map((outcome) => outcome.reason);
			if (failures.length === 1) throw failures[0];
			if (failures.length > 1) throw new AggregateError(failures, "loader fibers failed");
			this.ctx.reflect.notify(["loader"]);
			if (!this.getTasks().length) return;
		}
	}
	ensureId(options) {
		if (!options.id) do
			options.id = Math.random().toString(16).slice(2, 10);
		while (this.store[options.id]);
		return options.id;
	}
	/** Resolve an entry by id, including nested ids separated by `EntryTree.sep`. */
	resolve(id) {
		const parts = id.split(EntryTree.sep);
		let tree = this;
		const final = parts.pop();
		for (const part of parts) {
			tree = tree.store[part]?.subtree;
			if (!tree) throw new Error(`cannot resolve entry ${id}`);
		}
		const entry = tree.store[final];
		if (!entry) throw new Error(`cannot resolve entry ${id}`);
		return entry;
	}
	resolveGroup(id) {
		if (!id) return this.root;
		const entry = this.resolve(id);
		if (!entry.subgroup) throw new Error(`entry ${id} is not a group`);
		return entry.subgroup;
	}
	/** Create an entry in the root group or a nested group. */
	async create(options, parent = null, position = Infinity) {
		const group = this.resolveGroup(parent);
		const id = await group.create(options);
		const entry = this.resolve(id);
		group.data.splice(position, 0, entry.options);
		group.tree.write();
		return id;
	}
	/** Stop and remove an entry from its parent group. */
	async remove(id) {
		const entry = this.resolve(id);
		await entry.parent.remove(id);
		entry.parent.tree.write();
	}
	/** Update an entry and optionally move it to another group. */
	async update(id, options, parent, position) {
		const entry = this.resolve(id);
		const source = entry.parent;
		const sourceIndex = source.data.indexOf(entry.options);
		let target = source;
		if (parent !== void 0) {
			target = this.resolveGroup(parent);
			source.unlink(entry.options);
			target.data.splice(position ?? Infinity, 0, entry.options);
			entry.parent = target;
		}
		try {
			await entry.update(options, false, true);
		} catch (error) {
			if (parent !== void 0) {
				target.unlink(entry.options);
				source.data.splice(sourceIndex < 0 ? source.data.length : sourceIndex, 0, entry.options);
				entry.parent = source;
				try {
					await entry.update({}, false, true);
				} catch (rollbackError) {
					throw new AggregateError([error, rollbackError], `failed to roll back loader entry move ${id}`);
				}
			}
			throw error;
		}
		source.tree.write();
		if (target !== source) target.tree.write();
	}
	/** Import a plugin module from a specifier or `cordis:` builtin. */
	import(name, getOuterStack) {
		if (name.startsWith("cordis:")) return this.ctx.loader.builtins[name.slice(7)];
		return composeError(async (info) => {
			info.offset += 3;
			if (this.ctx.loader.internal) return await this.ctx.loader.internal.import(name, this.ctx.baseUrl, {});
			else if (name.startsWith(".")) return await import(
				/* @vite-ignore */
				new URL(name, this.ctx.baseUrl).href
);
			else return await import(
				/* @vite-ignore */
				name
);
		}, getOuterStack);
	}
};
//#endregion
//#region ../../../Core/vendor/loader/src/config/utils.ts
/** Evaluate a JavaScript expression against a loader context scope. */
const evaluate = new Function("ctx", "expr", `
  with (ctx) {
    return eval(expr)
  }
`);
/** Recursively replace YAML `!js` expression nodes with evaluated values. */
function interpolate(ctx, value) {
	if (isJsExpr(value)) return evaluate(ctx, value.__jsExpr);
	else if (!value || typeof value !== "object") return value;
	else if (Array.isArray(value)) return value.map((item) => interpolate(ctx, item));
	else return mapValues(value, (item) => interpolate(ctx, item));
}
/** Return true when a value is a serialized loader JavaScript expression. */
function isJsExpr(value) {
	return value instanceof Object && "__jsExpr" in value;
}
//#endregion
//#region ../../../Core/vendor/loader/src/config/entry.ts
function updateError(stage, options, cause) {
	const detail = cause instanceof Error ? cause.message : String(cause);
	return new Error(`failed to ${stage} loader entry ${options.id} (${options.name}): ${detail}`, { cause });
}
function takeEntries(object, keys) {
	const result = [];
	for (const key of keys) {
		if (!(key in object)) continue;
		result.push([key, object[key]]);
		delete object[key];
	}
	return result;
}
function sortKeys(object, prepend = ["id", "name"], append = ["config"]) {
	const part1 = takeEntries(object, prepend);
	const part2 = takeEntries(object, append);
	const rest = takeEntries(object, Object.keys(object)).sort(([a], [b]) => a.localeCompare(b));
	return Object.assign(object, Object.fromEntries([
		...part1,
		...rest,
		...part2
	]));
}
function replaceKeys(target, source) {
	for (const key of Object.keys(target)) Reflect.deleteProperty(target, key);
	return Object.assign(target, source);
}
/** One configured plugin node inside an `EntryTree`. */
var Entry = class Entry {
	loader;
	static key = Symbol.for("cordis.entry");
	ctx;
	fiber;
	parent;
	options = {};
	subgroup;
	subtree;
	_initTask;
	_disposing = 0;
	constructor(loader) {
		this.loader = loader;
		this.ctx = loader.ctx.extend({ [Entry.key]: this });
		this.context.emit("loader/entry-init", this);
	}
	get context() {
		return this.ctx;
	}
	get id() {
		let id = this.options.id;
		if (this.parent.tree.ctx.fiber.entry) id = this.parent.tree.ctx.fiber.entry.id + EntryTree.sep + id;
		return id;
	}
	/** True when this entry or any owning parent entry is disabled. */
	get disabled() {
		return this._disabled(this.options);
	}
	_disabled(options) {
		if (options.group) return false;
		if (this.disabledOf(options)) return true;
		let entry = this.parent.ctx.fiber.entry;
		while (entry) {
			if (this.disabledOf(entry.options)) return true;
			entry = entry.parent.ctx.fiber.entry;
		}
		return false;
	}
	/**
	* Effective disabled state: a `!!js` expression evaluates against the loader
	* context. The raw node stays in the options, so write-back keeps the form.
	*/
	disabledOf(options) {
		return isJsExpr(options.disabled) ? Boolean(this.evaluate(options.disabled.__jsExpr)) : Boolean(options.disabled);
	}
	evaluate(expr) {
		return evaluate(this.ctx, expr);
	}
	async _patchContext(diff) {
		await this.context.waterfall("loader/patch-context", this, async () => {
			Object.setPrototypeOf(this.ctx, this.parent.ctx);
			if (this.fiber?.uid && (diff.includes("config") || this.options.group)) await this.fiber.update(this.options.config, true);
		});
	}
	async refresh() {
		if (this.fiber) return;
		if (this.disabled) return;
		await this.init();
	}
	async _dispose(fiber = this.fiber) {
		if (!fiber) return;
		if (this.fiber === fiber) this.fiber = void 0;
		this._disposing += 1;
		try {
			await fiber.dispose();
		} finally {
			this._disposing -= 1;
		}
	}
	/** Merge new options, restart as needed, and persist through the parent tree. */
	async update(options, create = false, force = false) {
		const previousOptions = this.options;
		const legacy = { ...previousOptions };
		const candidate = create ? options : { ...previousOptions };
		if (!create) for (const [key, value] of Object.entries(options)) if (isNullable(value)) delete candidate[key];
		else candidate[key] = value;
		sortKeys(candidate);
		const diff = Object.keys({
			...candidate,
			...legacy
		}).filter((key) => !deepEqual(candidate[key], legacy[key]));
		if (!diff.length && !force) return;
		const commit = () => {
			if (create) return;
			this.options = replaceKeys(previousOptions, candidate);
		};
		const previous = this.fiber;
		if (!previous?.uid) {
			this.fiber = void 0;
			this.options = candidate;
			try {
				if (!this._disabled(candidate)) await this.init();
			} catch (error) {
				this.options = previousOptions;
				throw error;
			}
			commit();
			return;
		}
		if (this._disabled(candidate)) {
			this.options = candidate;
			try {
				await this._dispose(previous);
			} catch (error) {
				this.options = previousOptions;
				throw updateError("dispose", candidate, error);
			}
			commit();
			this.context.emit("loader/partial-dispose", this, legacy, true);
			return;
		}
		if (!diff.some((key) => key === "name" || key === "inject" || key === "group")) {
			this.options = candidate;
			try {
				await this._patchContext(diff);
			} catch (error) {
				this.options = previousOptions;
				try {
					await this._patchContext(diff);
				} catch (rollbackError) {
					throw updateError("rollback", legacy, new AggregateError([error, rollbackError]));
				}
				this.context.emit("loader/partial-dispose", this, candidate, true);
				throw updateError("apply", candidate, error);
			}
			commit();
			this.context.emit("loader/partial-dispose", this, legacy, true);
			return;
		}
		let plugin;
		try {
			plugin = diff.includes("name") ? this.loader.unwrapExports(await this.parent.tree.import(candidate.name, this.getOuterStack)) : previous.runtime.callback;
		} catch (error) {
			throw updateError("import", candidate, error);
		}
		const previousPlugin = previous.runtime.callback;
		this.options = candidate;
		try {
			await this._dispose(previous);
		} catch (error) {
			this.options = previousOptions;
			throw updateError("dispose", candidate, error);
		}
		try {
			await this._start(plugin);
		} catch (error) {
			this.options = previousOptions;
			try {
				await this._start(previousPlugin);
			} catch (rollbackError) {
				throw updateError("rollback", legacy, new AggregateError([error, rollbackError]));
			}
			this.context.emit("loader/partial-dispose", this, candidate, true);
			throw updateError("apply", candidate, error);
		}
		commit();
		this.context.emit("loader/partial-dispose", this, legacy, true);
	}
	getOuterStack = () => {
		let entry = this;
		const result = [];
		do {
			result.push(`    at ${entry.parent.tree.ctx.baseUrl}#${entry.options.id}`);
			entry = entry.parent.ctx.fiber.entry;
		} while (entry);
		return result;
	};
	/** Import and start the configured plugin if it is not already running. */
	async init() {
		try {
			await (this._initTask ??= this._init());
		} finally {
			this._initTask = void 0;
			if (!this.loader.getTasks().length) this.ctx.reflect.notify(["loader"]);
		}
		await this._await();
	}
	async _await() {
		try {
			await this.fiber?.await();
		} catch (error) {
			throw updateError("apply", this.options, error);
		}
	}
	async _init() {
		let plugin;
		try {
			plugin = this.loader.unwrapExports(await this.parent.tree.import(this.options.name, this.getOuterStack));
		} catch (error) {
			throw updateError("import", this.options, error);
		}
		try {
			await this._start(plugin);
		} catch (error) {
			throw updateError("apply", this.options, error);
		}
	}
	async _start(plugin) {
		let fiber;
		try {
			await this._patchContext([]);
			this.loader.showLog(this, "apply");
			fiber = this.fiber = this.ctx.registry.plugin(plugin, this.options.config, this.getOuterStack);
			await fiber.await();
		} catch (error) {
			await this._dispose(fiber);
			throw error;
		}
	}
};
Service.check;
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
//#region ../../core/scope/src/index.ts
/** Context tag written by {@link createScope}. */
const kScope = Symbol("dsh.scope");
/**
* The enclosing scope of each key. One relation powers both directions of
* scope nesting: registration views inherit DOWN the chain (a child scope
* sees its ancestors' layers — {@link ScopedLayers}), and event admission
* extends UP it (a listener tagged with an ancestor receives events dispatched
* to a descendant key — {@link scopeTarget}).
*/
const scopeParents = /* @__PURE__ */ new WeakMap();
/** Cycle-checked write shared by the bind and every rebind. */
function linkScopeParent(key, parent) {
	for (let cursor = parent; cursor !== void 0; cursor = scopeParents.get(cursor)) if (cursor === key) throw new Error("dsh-scope: scope parent link would form a cycle");
	scopeParents.set(key, parent);
}
/**
* Bind `parent` as `key`'s enclosing scope, once.
*
* A key that already has a parent throws: there is no open re-link path, so a
* scope's ancestry cannot be moved by anyone but the original binder, who
* alone receives the {@link ScopeParentBinding}. A link that would close a
* cycle is rejected, because every chain consumer walks parents to the root.
* @param key - the child scope key.
* @param parent - its enclosing scope key.
* @returns the binding that alone may re-link this key.
*/
function bindScopeParent(key, parent) {
	if (scopeParents.has(key)) throw new Error("dsh-scope: scope key is already bound to a parent; re-linking requires the binding returned by the original bind");
	linkScopeParent(key, parent);
	return { rebind(next) {
		linkScopeParent(key, next);
	} };
}
/**
* Read one key's enclosing scope.
* @param key - the scope key to inspect.
* @returns its parent key, or `undefined` for a root scope.
*/
function scopeParentOf(key) {
	return scopeParents.get(key);
}
/** Follow a Cordis fiber through asynchronous teardown even if its raw disposer was already claimed. */
async function quiesceFiber(fiber) {
	await Promise.resolve(fiber.dispose());
	while (fiber.inertia !== void 0) await fiber.inertia;
}
/** Shared no-op plugin used as the backing scope fiber. */
function scope() {}
/**
* Mint a scope under `ctx`. The scoped context inherits the minting plugin's
* dependency API and owns every registration made through it.
* @param ctx - active context whose dependency API the scope inherits.
* @param key - opaque identity used for listener routing.
* @param options - optional scope-chain placement.
* @returns the scoped context and exact/shared disposal boundaries.
*/
function createScope(ctx, key, options) {
	if (options?.parent !== void 0) bindScopeParent(key, options.parent);
	const fiber = ctx.plugin(scope);
	const scoped = fiber.ctx.extend({ [kScope]: key });
	let disposing;
	return {
		ctx: scoped,
		rawDispose: fiber.dispose,
		dispose: () => disposing ??= quiesceFiber(fiber)
	};
}
/**
* Read the nearest scope tag inherited by a context.
* @param ctx - context to inspect.
* @returns its scope key, or `undefined` for an unscoped context.
*/
function scopeOf(ctx) {
	return ctx[kScope];
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
/**
* Join path segments onto the resolved DeepSeek Harness home.
* @param segments - path segments appended to the Harness home; an empty list returns the home itself.
* @returns the normalized absolute joined path.
*/
function dshHomePath(...segments) {
	return join(resolveDshHome(), ...segments);
}
//#endregion
//#region ../../../Core/util/values/src/index.ts
/**
* Attach a caller-owned value as a non-enumerable, immutable symbol property.
* @param target - object that owns the value.
* @param key - caller-owned symbol key.
* @param value - value to retain on the target.
* @returns nothing; the property cannot be replaced or removed.
*/
function setSymbolValue(target, key, value) {
	Object.defineProperty(target, key, { value });
}
//#endregion
//#region ../../preset/agent-presets/src/settings-owner.ts
const SETTINGS_OWNER = Symbol.for("@deepseek-ai/dsh-agent-presets/compat-settings-owner");
/**
* Retain this service's original owner and private adapter operations.
* @param service - the presets service that owns this data.
* @param owner - the Cordis context that owns the service fiber.
* @param binding - the private source and writer operations.
*/
function retainSettingsOwner(service, owner, binding) {
	setSymbolValue(service, SETTINGS_OWNER, {
		owner,
		binding
	});
}
//#endregion
//#region ../../../../node_modules/.pnpm/js-yaml@4.3.2/node_modules/js-yaml/dist/js-yaml.mjs
function getDefaultExportFromCjs(x) {
	return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
}
var jsYaml = {};
var loader = {};
var common = {};
var hasRequiredCommon;
function requireCommon() {
	if (hasRequiredCommon) return common;
	hasRequiredCommon = 1;
	function isNothing(subject) {
		return typeof subject === "undefined" || subject === null;
	}
	function isObject(subject) {
		return typeof subject === "object" && subject !== null;
	}
	function toArray(sequence) {
		if (Array.isArray(sequence)) return sequence;
		else if (isNothing(sequence)) return [];
		return [sequence];
	}
	function extend(target, source) {
		if (source) {
			const sourceKeys = Object.keys(source);
			for (let index = 0, length = sourceKeys.length; index < length; index += 1) {
				const key = sourceKeys[index];
				target[key] = source[key];
			}
		}
		return target;
	}
	function repeat(string, count) {
		let result = "";
		for (let cycle = 0; cycle < count; cycle += 1) result += string;
		return result;
	}
	function isNegativeZero(number) {
		return number === 0 && Number.NEGATIVE_INFINITY === 1 / number;
	}
	common.isNothing = isNothing;
	common.isObject = isObject;
	common.toArray = toArray;
	common.repeat = repeat;
	common.isNegativeZero = isNegativeZero;
	common.extend = extend;
	return common;
}
var exception;
var hasRequiredException;
function requireException() {
	if (hasRequiredException) return exception;
	hasRequiredException = 1;
	function formatError(exception2, compact) {
		let where = "";
		const message = exception2.reason || "(unknown reason)";
		if (!exception2.mark) return message;
		if (exception2.mark.name) where += "in \"" + exception2.mark.name + "\" ";
		where += "(" + (exception2.mark.line + 1) + ":" + (exception2.mark.column + 1) + ")";
		if (!compact && exception2.mark.snippet) where += "\n\n" + exception2.mark.snippet;
		return message + " " + where;
	}
	function YAMLException2(reason, mark) {
		Error.call(this);
		this.name = "YAMLException";
		this.reason = reason;
		this.mark = mark;
		this.message = formatError(this, false);
		if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
		else this.stack = (/* @__PURE__ */ new Error()).stack || "";
	}
	YAMLException2.prototype = Object.create(Error.prototype);
	YAMLException2.prototype.constructor = YAMLException2;
	YAMLException2.prototype.toString = function toString(compact) {
		return this.name + ": " + formatError(this, compact);
	};
	exception = YAMLException2;
	return exception;
}
var snippet;
var hasRequiredSnippet;
function requireSnippet() {
	if (hasRequiredSnippet) return snippet;
	hasRequiredSnippet = 1;
	const common2 = requireCommon();
	function getLine(buffer, lineStart, lineEnd, position, maxLineLength) {
		let head = "";
		let tail = "";
		const maxHalfLength = Math.floor(maxLineLength / 2) - 1;
		if (position - lineStart > maxHalfLength) {
			head = " ... ";
			lineStart = position - maxHalfLength + head.length;
		}
		if (lineEnd - position > maxHalfLength) {
			tail = " ...";
			lineEnd = position + maxHalfLength - tail.length;
		}
		return {
			str: head + buffer.slice(lineStart, lineEnd).replace(/\t/g, "→") + tail,
			pos: position - lineStart + head.length
		};
	}
	function padStart(string, max) {
		return common2.repeat(" ", max - string.length) + string;
	}
	function makeSnippet(mark, options) {
		options = Object.create(options || null);
		if (!mark.buffer) return null;
		if (!options.maxLength) options.maxLength = 79;
		if (typeof options.indent !== "number") options.indent = 1;
		if (typeof options.linesBefore !== "number") options.linesBefore = 3;
		if (typeof options.linesAfter !== "number") options.linesAfter = 2;
		const re = /\r?\n|\r|\0/g;
		const lineStarts = [0];
		const lineEnds = [];
		let match;
		let foundLineNo = -1;
		while (match = re.exec(mark.buffer)) {
			lineEnds.push(match.index);
			lineStarts.push(match.index + match[0].length);
			if (mark.position <= match.index && foundLineNo < 0) foundLineNo = lineStarts.length - 2;
		}
		if (foundLineNo < 0) foundLineNo = lineStarts.length - 1;
		let result = "";
		const lineNoLength = Math.min(mark.line + options.linesAfter, lineEnds.length).toString().length;
		const maxLineLength = options.maxLength - (options.indent + lineNoLength + 3);
		for (let i = 1; i <= options.linesBefore; i++) {
			if (foundLineNo - i < 0) break;
			const line2 = getLine(mark.buffer, lineStarts[foundLineNo - i], lineEnds[foundLineNo - i], mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo - i]), maxLineLength);
			result = common2.repeat(" ", options.indent) + padStart((mark.line - i + 1).toString(), lineNoLength) + " | " + line2.str + "\n" + result;
		}
		const line = getLine(mark.buffer, lineStarts[foundLineNo], lineEnds[foundLineNo], mark.position, maxLineLength);
		result += common2.repeat(" ", options.indent) + padStart((mark.line + 1).toString(), lineNoLength) + " | " + line.str + "\n";
		result += common2.repeat("-", options.indent + lineNoLength + 3 + line.pos) + "^\n";
		for (let i = 1; i <= options.linesAfter; i++) {
			if (foundLineNo + i >= lineEnds.length) break;
			const line2 = getLine(mark.buffer, lineStarts[foundLineNo + i], lineEnds[foundLineNo + i], mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo + i]), maxLineLength);
			result += common2.repeat(" ", options.indent) + padStart((mark.line + i + 1).toString(), lineNoLength) + " | " + line2.str + "\n";
		}
		return result.replace(/\n$/, "");
	}
	snippet = makeSnippet;
	return snippet;
}
var type;
var hasRequiredType;
function requireType() {
	if (hasRequiredType) return type;
	hasRequiredType = 1;
	const YAMLException2 = requireException();
	const TYPE_CONSTRUCTOR_OPTIONS = [
		"kind",
		"multi",
		"resolve",
		"construct",
		"instanceOf",
		"predicate",
		"represent",
		"representName",
		"defaultStyle",
		"styleAliases"
	];
	const YAML_NODE_KINDS = [
		"scalar",
		"sequence",
		"mapping"
	];
	function compileStyleAliases(map2) {
		const result = {};
		if (map2 !== null) Object.keys(map2).forEach(function(style) {
			map2[style].forEach(function(alias) {
				result[String(alias)] = style;
			});
		});
		return result;
	}
	function Type2(tag, options) {
		options = options || {};
		Object.keys(options).forEach(function(name) {
			if (TYPE_CONSTRUCTOR_OPTIONS.indexOf(name) === -1) throw new YAMLException2("Unknown option \"" + name + "\" is met in definition of \"" + tag + "\" YAML type.");
		});
		this.options = options;
		this.tag = tag;
		this.kind = options["kind"] || null;
		this.resolve = options["resolve"] || function() {
			return true;
		};
		this.construct = options["construct"] || function(data) {
			return data;
		};
		this.instanceOf = options["instanceOf"] || null;
		this.predicate = options["predicate"] || null;
		this.represent = options["represent"] || null;
		this.representName = options["representName"] || null;
		this.defaultStyle = options["defaultStyle"] || null;
		this.multi = options["multi"] || false;
		this.styleAliases = compileStyleAliases(options["styleAliases"] || null);
		if (YAML_NODE_KINDS.indexOf(this.kind) === -1) throw new YAMLException2("Unknown kind \"" + this.kind + "\" is specified for \"" + tag + "\" YAML type.");
	}
	type = Type2;
	return type;
}
var schema$1;
var hasRequiredSchema;
function requireSchema() {
	if (hasRequiredSchema) return schema$1;
	hasRequiredSchema = 1;
	const YAMLException2 = requireException();
	const Type2 = requireType();
	function compileList(schema2, name) {
		const result = [];
		schema2[name].forEach(function(currentType) {
			let newIndex = result.length;
			result.forEach(function(previousType, previousIndex) {
				if (previousType.tag === currentType.tag && previousType.kind === currentType.kind && previousType.multi === currentType.multi) newIndex = previousIndex;
			});
			result[newIndex] = currentType;
		});
		return result;
	}
	function compileMap() {
		const result = {
			scalar: {},
			sequence: {},
			mapping: {},
			fallback: {},
			multi: {
				scalar: [],
				sequence: [],
				mapping: [],
				fallback: []
			}
		};
		function collectType(type2) {
			if (type2.multi) {
				result.multi[type2.kind].push(type2);
				result.multi["fallback"].push(type2);
			} else result[type2.kind][type2.tag] = result["fallback"][type2.tag] = type2;
		}
		for (let index = 0, length = arguments.length; index < length; index += 1) arguments[index].forEach(collectType);
		return result;
	}
	function Schema2(definition) {
		return this.extend(definition);
	}
	Schema2.prototype.extend = function extend(definition) {
		let implicit = [];
		let explicit = [];
		if (definition instanceof Type2) explicit.push(definition);
		else if (Array.isArray(definition)) explicit = explicit.concat(definition);
		else if (definition && (Array.isArray(definition.implicit) || Array.isArray(definition.explicit))) {
			if (definition.implicit) implicit = implicit.concat(definition.implicit);
			if (definition.explicit) explicit = explicit.concat(definition.explicit);
		} else throw new YAMLException2("Schema.extend argument should be a Type, [ Type ], or a schema definition ({ implicit: [...], explicit: [...] })");
		implicit.forEach(function(type2) {
			if (!(type2 instanceof Type2)) throw new YAMLException2("Specified list of YAML types (or a single Type object) contains a non-Type object.");
			if (type2.loadKind && type2.loadKind !== "scalar") throw new YAMLException2("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");
			if (type2.multi) throw new YAMLException2("There is a multi type in the implicit list of a schema. Multi tags can only be listed as explicit.");
		});
		explicit.forEach(function(type2) {
			if (!(type2 instanceof Type2)) throw new YAMLException2("Specified list of YAML types (or a single Type object) contains a non-Type object.");
		});
		const result = Object.create(Schema2.prototype);
		result.implicit = (this.implicit || []).concat(implicit);
		result.explicit = (this.explicit || []).concat(explicit);
		result.compiledImplicit = compileList(result, "implicit");
		result.compiledExplicit = compileList(result, "explicit");
		result.compiledTypeMap = compileMap(result.compiledImplicit, result.compiledExplicit);
		return result;
	};
	schema$1 = Schema2;
	return schema$1;
}
var str;
var hasRequiredStr;
function requireStr() {
	if (hasRequiredStr) return str;
	hasRequiredStr = 1;
	str = new (requireType())("tag:yaml.org,2002:str", {
		kind: "scalar",
		construct: function(data) {
			return data !== null ? data : "";
		}
	});
	return str;
}
var seq;
var hasRequiredSeq;
function requireSeq() {
	if (hasRequiredSeq) return seq;
	hasRequiredSeq = 1;
	seq = new (requireType())("tag:yaml.org,2002:seq", {
		kind: "sequence",
		construct: function(data) {
			return data !== null ? data : [];
		}
	});
	return seq;
}
var map;
var hasRequiredMap;
function requireMap() {
	if (hasRequiredMap) return map;
	hasRequiredMap = 1;
	map = new (requireType())("tag:yaml.org,2002:map", {
		kind: "mapping",
		construct: function(data) {
			return data !== null ? data : {};
		}
	});
	return map;
}
var failsafe;
var hasRequiredFailsafe;
function requireFailsafe() {
	if (hasRequiredFailsafe) return failsafe;
	hasRequiredFailsafe = 1;
	failsafe = new (requireSchema())({ explicit: [
		requireStr(),
		requireSeq(),
		requireMap()
	] });
	return failsafe;
}
var _null$3;
var hasRequired_null;
function require_null() {
	if (hasRequired_null) return _null$3;
	hasRequired_null = 1;
	const Type2 = requireType();
	function resolveYamlNull(data) {
		if (data === null) return true;
		const max = data.length;
		return max === 1 && data === "~" || max === 4 && (data === "null" || data === "Null" || data === "NULL");
	}
	function constructYamlNull() {
		return null;
	}
	function isNull(object) {
		return object === null;
	}
	_null$3 = new Type2("tag:yaml.org,2002:null", {
		kind: "scalar",
		resolve: resolveYamlNull,
		construct: constructYamlNull,
		predicate: isNull,
		represent: {
			canonical: function() {
				return "~";
			},
			lowercase: function() {
				return "null";
			},
			uppercase: function() {
				return "NULL";
			},
			camelcase: function() {
				return "Null";
			},
			empty: function() {
				return "";
			}
		},
		defaultStyle: "lowercase"
	});
	return _null$3;
}
var bool;
var hasRequiredBool;
function requireBool() {
	if (hasRequiredBool) return bool;
	hasRequiredBool = 1;
	const Type2 = requireType();
	function resolveYamlBoolean(data) {
		if (data === null) return false;
		const max = data.length;
		return max === 4 && (data === "true" || data === "True" || data === "TRUE") || max === 5 && (data === "false" || data === "False" || data === "FALSE");
	}
	function constructYamlBoolean(data) {
		return data === "true" || data === "True" || data === "TRUE";
	}
	function isBoolean(object) {
		return Object.prototype.toString.call(object) === "[object Boolean]";
	}
	bool = new Type2("tag:yaml.org,2002:bool", {
		kind: "scalar",
		resolve: resolveYamlBoolean,
		construct: constructYamlBoolean,
		predicate: isBoolean,
		represent: {
			lowercase: function(object) {
				return object ? "true" : "false";
			},
			uppercase: function(object) {
				return object ? "TRUE" : "FALSE";
			},
			camelcase: function(object) {
				return object ? "True" : "False";
			}
		},
		defaultStyle: "lowercase"
	});
	return bool;
}
var int;
var hasRequiredInt;
function requireInt() {
	if (hasRequiredInt) return int;
	hasRequiredInt = 1;
	const common2 = requireCommon();
	const Type2 = requireType();
	function isHexCode(c) {
		return c >= 48 && c <= 57 || c >= 65 && c <= 70 || c >= 97 && c <= 102;
	}
	function isOctCode(c) {
		return c >= 48 && c <= 55;
	}
	function isDecCode(c) {
		return c >= 48 && c <= 57;
	}
	function resolveYamlInteger(data) {
		if (data === null) return false;
		const max = data.length;
		let index = 0;
		let hasDigits = false;
		if (!max) return false;
		let ch = data[index];
		if (ch === "-" || ch === "+") ch = data[++index];
		if (ch === "0") {
			if (index + 1 === max) return true;
			ch = data[++index];
			if (ch === "b") {
				index++;
				for (; index < max; index++) {
					ch = data[index];
					if (ch !== "0" && ch !== "1") return false;
					hasDigits = true;
				}
				return hasDigits && isFinite(parseYamlInteger(data));
			}
			if (ch === "x") {
				index++;
				for (; index < max; index++) {
					if (!isHexCode(data.charCodeAt(index))) return false;
					hasDigits = true;
				}
				return hasDigits && isFinite(parseYamlInteger(data));
			}
			if (ch === "o") {
				index++;
				for (; index < max; index++) {
					if (!isOctCode(data.charCodeAt(index))) return false;
					hasDigits = true;
				}
				return hasDigits && isFinite(parseYamlInteger(data));
			}
		}
		for (; index < max; index++) {
			if (!isDecCode(data.charCodeAt(index))) return false;
			hasDigits = true;
		}
		if (!hasDigits) return false;
		return isFinite(parseYamlInteger(data));
	}
	function parseYamlInteger(data) {
		let value = data;
		let sign = 1;
		let ch = value[0];
		if (ch === "-" || ch === "+") {
			if (ch === "-") sign = -1;
			value = value.slice(1);
			ch = value[0];
		}
		if (value === "0") return 0;
		if (ch === "0") {
			if (value[1] === "b") return sign * parseInt(value.slice(2), 2);
			if (value[1] === "x") return sign * parseInt(value.slice(2), 16);
			if (value[1] === "o") return sign * parseInt(value.slice(2), 8);
		}
		return sign * parseInt(value, 10);
	}
	function constructYamlInteger(data) {
		return parseYamlInteger(data);
	}
	function isInteger(object) {
		return Object.prototype.toString.call(object) === "[object Number]" && object % 1 === 0 && !common2.isNegativeZero(object);
	}
	int = new Type2("tag:yaml.org,2002:int", {
		kind: "scalar",
		resolve: resolveYamlInteger,
		construct: constructYamlInteger,
		predicate: isInteger,
		represent: {
			binary: function(obj) {
				return obj >= 0 ? "0b" + obj.toString(2) : "-0b" + obj.toString(2).slice(1);
			},
			octal: function(obj) {
				return obj >= 0 ? "0o" + obj.toString(8) : "-0o" + obj.toString(8).slice(1);
			},
			decimal: function(obj) {
				return obj.toString(10);
			},
			hexadecimal: function(obj) {
				return obj >= 0 ? "0x" + obj.toString(16).toUpperCase() : "-0x" + obj.toString(16).toUpperCase().slice(1);
			}
		},
		defaultStyle: "decimal",
		styleAliases: {
			binary: [2, "bin"],
			octal: [8, "oct"],
			decimal: [10, "dec"],
			hexadecimal: [16, "hex"]
		}
	});
	return int;
}
var float;
var hasRequiredFloat;
function requireFloat() {
	if (hasRequiredFloat) return float;
	hasRequiredFloat = 1;
	const common2 = requireCommon();
	const Type2 = requireType();
	const YAML_FLOAT_PATTERN = /* @__PURE__ */ new RegExp("^(?:[-+]?(?:[0-9]+)(?:\\.[0-9]*)?(?:[eE][-+]?[0-9]+)?|\\.[0-9]+(?:[eE][-+]?[0-9]+)?|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$");
	const YAML_FLOAT_SPECIAL_PATTERN = /* @__PURE__ */ new RegExp("^(?:[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$");
	function resolveYamlFloat(data) {
		if (data === null) return false;
		if (!YAML_FLOAT_PATTERN.test(data)) return false;
		if (isFinite(parseFloat(data, 10))) return true;
		return YAML_FLOAT_SPECIAL_PATTERN.test(data);
	}
	function constructYamlFloat(data) {
		let value = data.toLowerCase();
		const sign = value[0] === "-" ? -1 : 1;
		if ("+-".indexOf(value[0]) >= 0) value = value.slice(1);
		if (value === ".inf") return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
		else if (value === ".nan") return NaN;
		return sign * parseFloat(value, 10);
	}
	const SCIENTIFIC_WITHOUT_DOT = /^[-+]?[0-9]+e/;
	function representYamlFloat(object, style) {
		if (isNaN(object)) switch (style) {
			case "lowercase": return ".nan";
			case "uppercase": return ".NAN";
			case "camelcase": return ".NaN";
		}
		else if (Number.POSITIVE_INFINITY === object) switch (style) {
			case "lowercase": return ".inf";
			case "uppercase": return ".INF";
			case "camelcase": return ".Inf";
		}
		else if (Number.NEGATIVE_INFINITY === object) switch (style) {
			case "lowercase": return "-.inf";
			case "uppercase": return "-.INF";
			case "camelcase": return "-.Inf";
		}
		else if (common2.isNegativeZero(object)) return "-0.0";
		const res = object.toString(10);
		return SCIENTIFIC_WITHOUT_DOT.test(res) ? res.replace("e", ".e") : res;
	}
	function isFloat(object) {
		return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 !== 0 || common2.isNegativeZero(object));
	}
	float = new Type2("tag:yaml.org,2002:float", {
		kind: "scalar",
		resolve: resolveYamlFloat,
		construct: constructYamlFloat,
		predicate: isFloat,
		represent: representYamlFloat,
		defaultStyle: "lowercase"
	});
	return float;
}
var json;
var hasRequiredJson;
function requireJson() {
	if (hasRequiredJson) return json;
	hasRequiredJson = 1;
	json = requireFailsafe().extend({ implicit: [
		require_null(),
		requireBool(),
		requireInt(),
		requireFloat()
	] });
	return json;
}
var core;
var hasRequiredCore;
function requireCore() {
	if (hasRequiredCore) return core;
	hasRequiredCore = 1;
	core = requireJson();
	return core;
}
var timestamp;
var hasRequiredTimestamp;
function requireTimestamp() {
	if (hasRequiredTimestamp) return timestamp;
	hasRequiredTimestamp = 1;
	const Type2 = requireType();
	const YAML_DATE_REGEXP = /* @__PURE__ */ new RegExp("^([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])$");
	const YAML_TIMESTAMP_REGEXP = /* @__PURE__ */ new RegExp("^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:[Tt]|[ \\t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\\.([0-9]*))?(?:[ \\t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?$");
	function resolveYamlTimestamp(data) {
		if (data === null) return false;
		if (YAML_DATE_REGEXP.exec(data) !== null) return true;
		if (YAML_TIMESTAMP_REGEXP.exec(data) !== null) return true;
		return false;
	}
	function constructYamlTimestamp(data) {
		let fraction = 0;
		let delta = null;
		let match = YAML_DATE_REGEXP.exec(data);
		if (match === null) match = YAML_TIMESTAMP_REGEXP.exec(data);
		if (match === null) throw new Error("Date resolve error");
		const year = +match[1];
		const month = +match[2] - 1;
		const day = +match[3];
		if (!match[4]) return new Date(Date.UTC(year, month, day));
		const hour = +match[4];
		const minute = +match[5];
		const second = +match[6];
		if (match[7]) {
			fraction = match[7].slice(0, 3);
			while (fraction.length < 3) fraction += "0";
			fraction = +fraction;
		}
		if (match[9]) {
			const tzHour = +match[10];
			const tzMinute = +(match[11] || 0);
			delta = (tzHour * 60 + tzMinute) * 6e4;
			if (match[9] === "-") delta = -delta;
		}
		const date = new Date(Date.UTC(year, month, day, hour, minute, second, fraction));
		if (delta) date.setTime(date.getTime() - delta);
		return date;
	}
	function representYamlTimestamp(object) {
		return object.toISOString();
	}
	timestamp = new Type2("tag:yaml.org,2002:timestamp", {
		kind: "scalar",
		resolve: resolveYamlTimestamp,
		construct: constructYamlTimestamp,
		instanceOf: Date,
		represent: representYamlTimestamp
	});
	return timestamp;
}
var merge;
var hasRequiredMerge;
function requireMerge() {
	if (hasRequiredMerge) return merge;
	hasRequiredMerge = 1;
	const Type2 = requireType();
	function resolveYamlMerge(data) {
		return data === "<<" || data === null;
	}
	merge = new Type2("tag:yaml.org,2002:merge", {
		kind: "scalar",
		resolve: resolveYamlMerge
	});
	return merge;
}
var binary;
var hasRequiredBinary;
function requireBinary() {
	if (hasRequiredBinary) return binary;
	hasRequiredBinary = 1;
	const Type2 = requireType();
	const BASE64_MAP = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=\n\r";
	function resolveYamlBinary(data) {
		if (data === null) return false;
		let bitlen = 0;
		const max = data.length;
		const map2 = BASE64_MAP;
		for (let idx = 0; idx < max; idx++) {
			const code = map2.indexOf(data.charAt(idx));
			if (code > 64) continue;
			if (code < 0) return false;
			bitlen += 6;
		}
		return bitlen % 8 === 0;
	}
	function constructYamlBinary(data) {
		const input = data.replace(/[\r\n=]/g, "");
		const max = input.length;
		const map2 = BASE64_MAP;
		let bits = 0;
		const result = [];
		for (let idx = 0; idx < max; idx++) {
			if (idx % 4 === 0 && idx) {
				result.push(bits >> 16 & 255);
				result.push(bits >> 8 & 255);
				result.push(bits & 255);
			}
			bits = bits << 6 | map2.indexOf(input.charAt(idx));
		}
		const tailbits = max % 4 * 6;
		if (tailbits === 0) {
			result.push(bits >> 16 & 255);
			result.push(bits >> 8 & 255);
			result.push(bits & 255);
		} else if (tailbits === 18) {
			result.push(bits >> 10 & 255);
			result.push(bits >> 2 & 255);
		} else if (tailbits === 12) result.push(bits >> 4 & 255);
		return new Uint8Array(result);
	}
	function representYamlBinary(object) {
		let result = "";
		let bits = 0;
		const max = object.length;
		const map2 = BASE64_MAP;
		for (let idx = 0; idx < max; idx++) {
			if (idx % 3 === 0 && idx) {
				result += map2[bits >> 18 & 63];
				result += map2[bits >> 12 & 63];
				result += map2[bits >> 6 & 63];
				result += map2[bits & 63];
			}
			bits = (bits << 8) + object[idx];
		}
		const tail = max % 3;
		if (tail === 0) {
			result += map2[bits >> 18 & 63];
			result += map2[bits >> 12 & 63];
			result += map2[bits >> 6 & 63];
			result += map2[bits & 63];
		} else if (tail === 2) {
			result += map2[bits >> 10 & 63];
			result += map2[bits >> 4 & 63];
			result += map2[bits << 2 & 63];
			result += map2[64];
		} else if (tail === 1) {
			result += map2[bits >> 2 & 63];
			result += map2[bits << 4 & 63];
			result += map2[64];
			result += map2[64];
		}
		return result;
	}
	function isBinary(obj) {
		return Object.prototype.toString.call(obj) === "[object Uint8Array]";
	}
	binary = new Type2("tag:yaml.org,2002:binary", {
		kind: "scalar",
		resolve: resolveYamlBinary,
		construct: constructYamlBinary,
		predicate: isBinary,
		represent: representYamlBinary
	});
	return binary;
}
var omap;
var hasRequiredOmap;
function requireOmap() {
	if (hasRequiredOmap) return omap;
	hasRequiredOmap = 1;
	const Type2 = requireType();
	const _hasOwnProperty = Object.prototype.hasOwnProperty;
	const _toString = Object.prototype.toString;
	function resolveYamlOmap(data) {
		if (data === null) return true;
		const objectKeys = {};
		const object = data;
		for (let index = 0, length = object.length; index < length; index += 1) {
			const pair = object[index];
			let pairHasKey = false;
			if (_toString.call(pair) !== "[object Object]") return false;
			let pairKey;
			for (pairKey in pair) if (_hasOwnProperty.call(pair, pairKey)) if (!pairHasKey) pairHasKey = true;
			else return false;
			if (!pairHasKey) return false;
			if (_hasOwnProperty.call(objectKeys, pairKey)) return false;
			Object.defineProperty(objectKeys, pairKey, { value: true });
		}
		return true;
	}
	function constructYamlOmap(data) {
		return data !== null ? data : [];
	}
	omap = new Type2("tag:yaml.org,2002:omap", {
		kind: "sequence",
		resolve: resolveYamlOmap,
		construct: constructYamlOmap
	});
	return omap;
}
var pairs;
var hasRequiredPairs;
function requirePairs() {
	if (hasRequiredPairs) return pairs;
	hasRequiredPairs = 1;
	const Type2 = requireType();
	const _toString = Object.prototype.toString;
	function resolveYamlPairs(data) {
		if (data === null) return true;
		const object = data;
		const result = new Array(object.length);
		for (let index = 0, length = object.length; index < length; index += 1) {
			const pair = object[index];
			if (_toString.call(pair) !== "[object Object]") return false;
			const keys = Object.keys(pair);
			if (keys.length !== 1) return false;
			result[index] = [keys[0], pair[keys[0]]];
		}
		return true;
	}
	function constructYamlPairs(data) {
		if (data === null) return [];
		const object = data;
		const result = new Array(object.length);
		for (let index = 0, length = object.length; index < length; index += 1) {
			const pair = object[index];
			const keys = Object.keys(pair);
			result[index] = [keys[0], pair[keys[0]]];
		}
		return result;
	}
	pairs = new Type2("tag:yaml.org,2002:pairs", {
		kind: "sequence",
		resolve: resolveYamlPairs,
		construct: constructYamlPairs
	});
	return pairs;
}
var set;
var hasRequiredSet;
function requireSet() {
	if (hasRequiredSet) return set;
	hasRequiredSet = 1;
	const Type2 = requireType();
	const _hasOwnProperty = Object.prototype.hasOwnProperty;
	function resolveYamlSet(data) {
		if (data === null) return true;
		const object = data;
		for (const key in object) if (_hasOwnProperty.call(object, key)) {
			if (object[key] !== null) return false;
		}
		return true;
	}
	function constructYamlSet(data) {
		return data !== null ? data : {};
	}
	set = new Type2("tag:yaml.org,2002:set", {
		kind: "mapping",
		resolve: resolveYamlSet,
		construct: constructYamlSet
	});
	return set;
}
var _default$1;
var hasRequired_default;
function require_default() {
	if (hasRequired_default) return _default$1;
	hasRequired_default = 1;
	_default$1 = requireCore().extend({
		implicit: [requireTimestamp(), requireMerge()],
		explicit: [
			requireBinary(),
			requireOmap(),
			requirePairs(),
			requireSet()
		]
	});
	return _default$1;
}
var hasRequiredLoader;
function requireLoader() {
	if (hasRequiredLoader) return loader;
	hasRequiredLoader = 1;
	const common2 = requireCommon();
	const YAMLException2 = requireException();
	const makeSnippet = requireSnippet();
	const DEFAULT_SCHEMA2 = require_default();
	const _hasOwnProperty = Object.prototype.hasOwnProperty;
	const CONTEXT_FLOW_IN = 1;
	const CONTEXT_FLOW_OUT = 2;
	const CONTEXT_BLOCK_IN = 3;
	const CONTEXT_BLOCK_OUT = 4;
	const CHOMPING_CLIP = 1;
	const CHOMPING_STRIP = 2;
	const CHOMPING_KEEP = 3;
	const PATTERN_NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
	const PATTERN_NON_ASCII_LINE_BREAKS = /[\x85\u2028\u2029]/;
	const PATTERN_FLOW_INDICATORS = /[,\[\]{}]/;
	const PATTERN_TAG_HANDLE = /^(?:!|!!|![0-9A-Za-z-]+!)$/;
	const PATTERN_TAG_URI = /^(?:!|[^,\[\]{}])(?:%[0-9a-f]{2}|[0-9a-z\-#;/?:@&=+$,_.!~*'()\[\]])*$/i;
	function _class(obj) {
		return Object.prototype.toString.call(obj);
	}
	function isEol(c) {
		return c === 10 || c === 13;
	}
	function isWhiteSpace(c) {
		return c === 9 || c === 32;
	}
	function isWsOrEol(c) {
		return c === 9 || c === 32 || c === 10 || c === 13;
	}
	function isFlowIndicator(c) {
		return c === 44 || c === 91 || c === 93 || c === 123 || c === 125;
	}
	function fromHexCode(c) {
		if (c >= 48 && c <= 57) return c - 48;
		const lc = c | 32;
		if (lc >= 97 && lc <= 102) return lc - 97 + 10;
		return -1;
	}
	function escapedHexLen(c) {
		if (c === 120) return 2;
		if (c === 117) return 4;
		if (c === 85) return 8;
		return 0;
	}
	function fromDecimalCode(c) {
		if (c >= 48 && c <= 57) return c - 48;
		return -1;
	}
	function simpleEscapeSequence(c) {
		switch (c) {
			case 48: return "\0";
			case 97: return "\x07";
			case 98: return "\b";
			case 116: return "	";
			case 9: return "	";
			case 110: return "\n";
			case 118: return "\v";
			case 102: return "\f";
			case 114: return "\r";
			case 101: return "\x1B";
			case 32: return " ";
			case 34: return "\"";
			case 47: return "/";
			case 92: return "\\";
			case 78: return "";
			case 95: return "\xA0";
			case 76: return "\u2028";
			case 80: return "\u2029";
			default: return "";
		}
	}
	function charFromCodepoint(c) {
		if (c <= 65535) return String.fromCharCode(c);
		return String.fromCharCode((c - 65536 >> 10) + 55296, (c - 65536 & 1023) + 56320);
	}
	function setProperty(object, key, value) {
		if (key === "__proto__") Object.defineProperty(object, key, {
			configurable: true,
			enumerable: true,
			writable: true,
			value
		});
		else object[key] = value;
	}
	const simpleEscapeCheck = new Array(256);
	const simpleEscapeMap = new Array(256);
	for (let i = 0; i < 256; i++) {
		simpleEscapeCheck[i] = simpleEscapeSequence(i) ? 1 : 0;
		simpleEscapeMap[i] = simpleEscapeSequence(i);
	}
	function State(input, options) {
		this.input = input;
		this.filename = options["filename"] || null;
		this.schema = options["schema"] || DEFAULT_SCHEMA2;
		this.onWarning = options["onWarning"] || null;
		this.legacy = options["legacy"] || false;
		this.json = options["json"] || false;
		this.listener = options["listener"] || null;
		this.maxDepth = typeof options["maxDepth"] === "number" ? options["maxDepth"] : 100;
		this.maxTotalMergeKeys = typeof options["maxTotalMergeKeys"] === "number" ? options["maxTotalMergeKeys"] : 1e4;
		this.implicitTypes = this.schema.compiledImplicit;
		this.typeMap = this.schema.compiledTypeMap;
		this.length = input.length;
		this.position = 0;
		this.line = 0;
		this.lineStart = 0;
		this.lineIndent = 0;
		this.depth = 0;
		this.totalMergeKeys = 0;
		this.firstTabInLine = -1;
		this.documents = [];
		this.anchorMapTransactions = [];
	}
	function generateError(state, message) {
		const mark = {
			name: state.filename,
			buffer: state.input.slice(0, -1),
			position: state.position,
			line: state.line,
			column: state.position - state.lineStart
		};
		mark.snippet = makeSnippet(mark);
		return new YAMLException2(message, mark);
	}
	function throwError(state, message) {
		throw generateError(state, message);
	}
	function throwWarning(state, message) {
		if (state.onWarning) state.onWarning.call(null, generateError(state, message));
	}
	function storeAnchor(state, name, value) {
		const transactions = state.anchorMapTransactions;
		if (transactions.length !== 0) {
			const transaction = transactions[transactions.length - 1];
			if (!_hasOwnProperty.call(transaction, name)) transaction[name] = {
				existed: _hasOwnProperty.call(state.anchorMap, name),
				value: state.anchorMap[name]
			};
		}
		state.anchorMap[name] = value;
	}
	function beginAnchorTransaction(state) {
		state.anchorMapTransactions.push(/* @__PURE__ */ Object.create(null));
	}
	function commitAnchorTransaction(state) {
		const transaction = state.anchorMapTransactions.pop();
		const transactions = state.anchorMapTransactions;
		if (transactions.length === 0) return;
		const parent = transactions[transactions.length - 1];
		const names = Object.keys(transaction);
		for (let index = 0, length = names.length; index < length; index += 1) {
			const name = names[index];
			if (!_hasOwnProperty.call(parent, name)) parent[name] = transaction[name];
		}
	}
	function rollbackAnchorTransaction(state) {
		const transaction = state.anchorMapTransactions.pop();
		const names = Object.keys(transaction);
		for (let index = names.length - 1; index >= 0; index -= 1) {
			const entry = transaction[names[index]];
			if (entry.existed) state.anchorMap[names[index]] = entry.value;
			else delete state.anchorMap[names[index]];
		}
	}
	function snapshotState(state) {
		return {
			position: state.position,
			line: state.line,
			lineStart: state.lineStart,
			lineIndent: state.lineIndent,
			firstTabInLine: state.firstTabInLine,
			tag: state.tag,
			anchor: state.anchor,
			kind: state.kind,
			result: state.result
		};
	}
	function restoreState(state, snapshot) {
		state.position = snapshot.position;
		state.line = snapshot.line;
		state.lineStart = snapshot.lineStart;
		state.lineIndent = snapshot.lineIndent;
		state.firstTabInLine = snapshot.firstTabInLine;
		state.tag = snapshot.tag;
		state.anchor = snapshot.anchor;
		state.kind = snapshot.kind;
		state.result = snapshot.result;
	}
	const directiveHandlers = {
		YAML: function handleYamlDirective(state, name, args) {
			if (state.version !== null) throwError(state, "duplication of %YAML directive");
			if (args.length !== 1) throwError(state, "YAML directive accepts exactly one argument");
			const match = /^([0-9]+)\.([0-9]+)$/.exec(args[0]);
			if (match === null) throwError(state, "ill-formed argument of the YAML directive");
			const major = parseInt(match[1], 10);
			const minor = parseInt(match[2], 10);
			if (major !== 1) throwError(state, "unacceptable YAML version of the document");
			state.version = args[0];
			state.checkLineBreaks = minor < 2;
			if (minor !== 1 && minor !== 2) throwWarning(state, "unsupported YAML version of the document");
		},
		TAG: function handleTagDirective(state, name, args) {
			let prefix;
			if (args.length !== 2) throwError(state, "TAG directive accepts exactly two arguments");
			const handle = args[0];
			prefix = args[1];
			if (!PATTERN_TAG_HANDLE.test(handle)) throwError(state, "ill-formed tag handle (first argument) of the TAG directive");
			if (_hasOwnProperty.call(state.tagMap, handle)) throwError(state, "there is a previously declared suffix for \"" + handle + "\" tag handle");
			if (!PATTERN_TAG_URI.test(prefix)) throwError(state, "ill-formed tag prefix (second argument) of the TAG directive");
			try {
				prefix = decodeURIComponent(prefix);
			} catch (err) {
				throwError(state, "tag prefix is malformed: " + prefix);
			}
			state.tagMap[handle] = prefix;
		}
	};
	function captureSegment(state, start, end, checkJson) {
		if (start < end) {
			const _result = state.input.slice(start, end);
			if (checkJson) for (let _position = 0, _length = _result.length; _position < _length; _position += 1) {
				const _character = _result.charCodeAt(_position);
				if (!(_character === 9 || _character >= 32 && _character <= 1114111)) throwError(state, "expected valid JSON character");
			}
			else if (PATTERN_NON_PRINTABLE.test(_result)) throwError(state, "the stream contains non-printable characters");
			state.result += _result;
		}
	}
	function chargeMergeWork(state) {
		state.totalMergeKeys++;
		if (state.maxTotalMergeKeys !== -1 && state.totalMergeKeys > state.maxTotalMergeKeys) throwError(state, "merge keys exceeded maxTotalMergeKeys (" + state.maxTotalMergeKeys + ")");
	}
	function mergeMappings(state, destination, source, overridableKeys) {
		if (!common2.isObject(source)) throwError(state, "cannot merge mappings; the provided source object is unacceptable");
		chargeMergeWork(state);
		const sourceKeys = Object.keys(source);
		for (let index = 0, quantity = sourceKeys.length; index < quantity; index += 1) {
			const key = sourceKeys[index];
			chargeMergeWork(state);
			if (!_hasOwnProperty.call(destination, key)) {
				setProperty(destination, key, source[key]);
				overridableKeys[key] = true;
			}
		}
	}
	function storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, startLine, startLineStart, startPos) {
		if (Array.isArray(keyNode)) {
			keyNode = Array.prototype.slice.call(keyNode);
			for (let index = 0, quantity = keyNode.length; index < quantity; index += 1) {
				if (Array.isArray(keyNode[index])) throwError(state, "nested arrays are not supported inside keys");
				if (typeof keyNode === "object" && _class(keyNode[index]) === "[object Object]") keyNode[index] = "[object Object]";
			}
		}
		if (typeof keyNode === "object" && _class(keyNode) === "[object Object]") keyNode = "[object Object]";
		keyNode = String(keyNode);
		if (_result === null) _result = {};
		if (keyTag === "tag:yaml.org,2002:merge") if (Array.isArray(valueNode)) {
			if (valueNode.length > 100) throwError(state, "abnormal merge sequence size");
			for (let index = 0, quantity = valueNode.length; index < quantity; index += 1) mergeMappings(state, _result, valueNode[index], overridableKeys);
		} else mergeMappings(state, _result, valueNode, overridableKeys);
		else {
			if (!state.json && !_hasOwnProperty.call(overridableKeys, keyNode) && _hasOwnProperty.call(_result, keyNode)) {
				state.line = startLine || state.line;
				state.lineStart = startLineStart || state.lineStart;
				state.position = startPos || state.position;
				throwError(state, "duplicated mapping key");
			}
			setProperty(_result, keyNode, valueNode);
			delete overridableKeys[keyNode];
		}
		return _result;
	}
	function readLineBreak(state) {
		const ch = state.input.charCodeAt(state.position);
		if (ch === 10) state.position++;
		else if (ch === 13) {
			state.position++;
			if (state.input.charCodeAt(state.position) === 10) state.position++;
		} else throwError(state, "a line break is expected");
		state.line += 1;
		state.lineStart = state.position;
		state.firstTabInLine = -1;
	}
	function skipSeparationSpace(state, allowComments, checkIndent) {
		let lineBreaks = 0;
		let ch = state.input.charCodeAt(state.position);
		while (ch !== 0) {
			while (isWhiteSpace(ch)) {
				if (ch === 9 && state.firstTabInLine === -1) state.firstTabInLine = state.position;
				ch = state.input.charCodeAt(++state.position);
			}
			if (allowComments && ch === 35) do
				ch = state.input.charCodeAt(++state.position);
			while (ch !== 10 && ch !== 13 && ch !== 0);
			if (isEol(ch)) {
				readLineBreak(state);
				ch = state.input.charCodeAt(state.position);
				lineBreaks++;
				state.lineIndent = 0;
				while (ch === 32) {
					state.lineIndent++;
					ch = state.input.charCodeAt(++state.position);
				}
			} else break;
		}
		if (checkIndent !== -1 && lineBreaks !== 0 && state.lineIndent < checkIndent) throwWarning(state, "deficient indentation");
		return lineBreaks;
	}
	function testDocumentSeparator(state) {
		let _position = state.position;
		let ch = state.input.charCodeAt(_position);
		if ((ch === 45 || ch === 46) && ch === state.input.charCodeAt(_position + 1) && ch === state.input.charCodeAt(_position + 2)) {
			_position += 3;
			ch = state.input.charCodeAt(_position);
			if (ch === 0 || isWsOrEol(ch)) return true;
		}
		return false;
	}
	function writeFoldedLines(state, count) {
		if (count === 1) state.result += " ";
		else if (count > 1) state.result += common2.repeat("\n", count - 1);
	}
	function readPlainScalar(state, nodeIndent, withinFlowCollection) {
		let captureStart;
		let captureEnd;
		let hasPendingContent;
		let _line;
		let _lineStart;
		let _lineIndent;
		const _kind = state.kind;
		const _result = state.result;
		let ch = state.input.charCodeAt(state.position);
		if (isWsOrEol(ch) || isFlowIndicator(ch) || ch === 35 || ch === 38 || ch === 42 || ch === 33 || ch === 124 || ch === 62 || ch === 39 || ch === 34 || ch === 37 || ch === 64 || ch === 96) return false;
		if (ch === 63 || ch === 45) {
			const following = state.input.charCodeAt(state.position + 1);
			if (isWsOrEol(following) || withinFlowCollection && isFlowIndicator(following)) return false;
		}
		state.kind = "scalar";
		state.result = "";
		captureStart = captureEnd = state.position;
		hasPendingContent = false;
		while (ch !== 0) {
			if (ch === 58) {
				const following = state.input.charCodeAt(state.position + 1);
				if (isWsOrEol(following) || withinFlowCollection && isFlowIndicator(following)) break;
			} else if (ch === 35) {
				if (isWsOrEol(state.input.charCodeAt(state.position - 1))) break;
			} else if (state.position === state.lineStart && testDocumentSeparator(state) || withinFlowCollection && isFlowIndicator(ch)) break;
			else if (isEol(ch)) {
				_line = state.line;
				_lineStart = state.lineStart;
				_lineIndent = state.lineIndent;
				skipSeparationSpace(state, false, -1);
				if (state.lineIndent >= nodeIndent) {
					hasPendingContent = true;
					ch = state.input.charCodeAt(state.position);
					continue;
				} else {
					state.position = captureEnd;
					state.line = _line;
					state.lineStart = _lineStart;
					state.lineIndent = _lineIndent;
					break;
				}
			}
			if (hasPendingContent) {
				captureSegment(state, captureStart, captureEnd, false);
				writeFoldedLines(state, state.line - _line);
				captureStart = captureEnd = state.position;
				hasPendingContent = false;
			}
			if (!isWhiteSpace(ch)) captureEnd = state.position + 1;
			ch = state.input.charCodeAt(++state.position);
		}
		captureSegment(state, captureStart, captureEnd, false);
		if (state.result) return true;
		state.kind = _kind;
		state.result = _result;
		return false;
	}
	function readSingleQuotedScalar(state, nodeIndent) {
		let captureStart;
		let captureEnd;
		let ch = state.input.charCodeAt(state.position);
		if (ch !== 39) return false;
		state.kind = "scalar";
		state.result = "";
		state.position++;
		captureStart = captureEnd = state.position;
		while ((ch = state.input.charCodeAt(state.position)) !== 0) if (ch === 39) {
			captureSegment(state, captureStart, state.position, true);
			ch = state.input.charCodeAt(++state.position);
			if (ch === 39) {
				captureStart = state.position;
				state.position++;
				captureEnd = state.position;
			} else return true;
		} else if (isEol(ch)) {
			captureSegment(state, captureStart, captureEnd, true);
			writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
			captureStart = captureEnd = state.position;
		} else if (state.position === state.lineStart && testDocumentSeparator(state)) throwError(state, "unexpected end of the document within a single quoted scalar");
		else {
			state.position++;
			if (!isWhiteSpace(ch)) captureEnd = state.position;
		}
		throwError(state, "unexpected end of the stream within a single quoted scalar");
	}
	function readDoubleQuotedScalar(state, nodeIndent) {
		let captureStart;
		let captureEnd;
		let tmp;
		let ch = state.input.charCodeAt(state.position);
		if (ch !== 34) return false;
		state.kind = "scalar";
		state.result = "";
		state.position++;
		captureStart = captureEnd = state.position;
		while ((ch = state.input.charCodeAt(state.position)) !== 0) if (ch === 34) {
			captureSegment(state, captureStart, state.position, true);
			state.position++;
			return true;
		} else if (ch === 92) {
			captureSegment(state, captureStart, state.position, true);
			ch = state.input.charCodeAt(++state.position);
			if (isEol(ch)) skipSeparationSpace(state, false, nodeIndent);
			else if (ch < 256 && simpleEscapeCheck[ch]) {
				state.result += simpleEscapeMap[ch];
				state.position++;
			} else if ((tmp = escapedHexLen(ch)) > 0) {
				let hexLength = tmp;
				let hexResult = 0;
				for (; hexLength > 0; hexLength--) {
					ch = state.input.charCodeAt(++state.position);
					if ((tmp = fromHexCode(ch)) >= 0) hexResult = (hexResult << 4) + tmp;
					else throwError(state, "expected hexadecimal character");
				}
				state.result += charFromCodepoint(hexResult);
				state.position++;
			} else throwError(state, "unknown escape sequence");
			captureStart = captureEnd = state.position;
		} else if (isEol(ch)) {
			captureSegment(state, captureStart, captureEnd, true);
			writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
			captureStart = captureEnd = state.position;
		} else if (state.position === state.lineStart && testDocumentSeparator(state)) throwError(state, "unexpected end of the document within a double quoted scalar");
		else {
			state.position++;
			if (!isWhiteSpace(ch)) captureEnd = state.position;
		}
		throwError(state, "unexpected end of the stream within a double quoted scalar");
	}
	function readFlowCollection(state, nodeIndent) {
		let readNext = true;
		let _line;
		let _lineStart;
		let _pos;
		const _tag = state.tag;
		let _result;
		const _anchor = state.anchor;
		let terminator;
		let isPair;
		let isExplicitPair;
		let isMapping;
		const overridableKeys = /* @__PURE__ */ Object.create(null);
		let keyNode;
		let keyTag;
		let valueNode;
		let ch = state.input.charCodeAt(state.position);
		if (ch === 91) {
			terminator = 93;
			isMapping = false;
			_result = [];
		} else if (ch === 123) {
			terminator = 125;
			isMapping = true;
			_result = {};
		} else return false;
		if (state.anchor !== null) storeAnchor(state, state.anchor, _result);
		ch = state.input.charCodeAt(++state.position);
		while (ch !== 0) {
			skipSeparationSpace(state, true, nodeIndent);
			ch = state.input.charCodeAt(state.position);
			if (ch === terminator) {
				state.position++;
				state.tag = _tag;
				state.anchor = _anchor;
				state.kind = isMapping ? "mapping" : "sequence";
				state.result = _result;
				return true;
			} else if (!readNext) throwError(state, "missed comma between flow collection entries");
			else if (ch === 44) throwError(state, "expected the node content, but found ','");
			keyTag = keyNode = valueNode = null;
			isPair = isExplicitPair = false;
			if (ch === 63) {
				if (isWsOrEol(state.input.charCodeAt(state.position + 1))) {
					isPair = isExplicitPair = true;
					state.position++;
					skipSeparationSpace(state, true, nodeIndent);
				}
			}
			_line = state.line;
			_lineStart = state.lineStart;
			_pos = state.position;
			composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
			keyTag = state.tag;
			keyNode = state.result;
			skipSeparationSpace(state, true, nodeIndent);
			ch = state.input.charCodeAt(state.position);
			if ((isExplicitPair || state.line === _line) && ch === 58) {
				isPair = true;
				ch = state.input.charCodeAt(++state.position);
				skipSeparationSpace(state, true, nodeIndent);
				composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
				valueNode = state.result;
			}
			if (isMapping) storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos);
			else if (isPair) _result.push(storeMappingPair(state, null, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos));
			else _result.push(keyNode);
			skipSeparationSpace(state, true, nodeIndent);
			ch = state.input.charCodeAt(state.position);
			if (ch === 44) {
				readNext = true;
				ch = state.input.charCodeAt(++state.position);
			} else readNext = false;
		}
		throwError(state, "unexpected end of the stream within a flow collection");
	}
	function readBlockScalar(state, nodeIndent) {
		let folding;
		let chomping = CHOMPING_CLIP;
		let didReadContent = false;
		let detectedIndent = false;
		let textIndent = nodeIndent;
		let emptyLines = 0;
		let atMoreIndented = false;
		let tmp;
		let ch = state.input.charCodeAt(state.position);
		if (ch === 124) folding = false;
		else if (ch === 62) folding = true;
		else return false;
		state.kind = "scalar";
		state.result = "";
		while (ch !== 0) {
			ch = state.input.charCodeAt(++state.position);
			if (ch === 43 || ch === 45) if (CHOMPING_CLIP === chomping) chomping = ch === 43 ? CHOMPING_KEEP : CHOMPING_STRIP;
			else throwError(state, "repeat of a chomping mode identifier");
			else if ((tmp = fromDecimalCode(ch)) >= 0) if (tmp === 0) throwError(state, "bad explicit indentation width of a block scalar; it cannot be less than one");
			else if (!detectedIndent) {
				textIndent = nodeIndent + tmp - 1;
				detectedIndent = true;
			} else throwError(state, "repeat of an indentation width identifier");
			else break;
		}
		if (isWhiteSpace(ch)) {
			do
				ch = state.input.charCodeAt(++state.position);
			while (isWhiteSpace(ch));
			if (ch === 35) do
				ch = state.input.charCodeAt(++state.position);
			while (!isEol(ch) && ch !== 0);
		}
		while (ch !== 0) {
			readLineBreak(state);
			state.lineIndent = 0;
			ch = state.input.charCodeAt(state.position);
			while ((!detectedIndent || state.lineIndent < textIndent) && ch === 32) {
				state.lineIndent++;
				ch = state.input.charCodeAt(++state.position);
			}
			if (!detectedIndent && state.lineIndent > textIndent) textIndent = state.lineIndent;
			if (isEol(ch)) {
				emptyLines++;
				continue;
			}
			if (!detectedIndent && textIndent === 0) throwError(state, "missing indentation for block scalar");
			if (state.lineIndent < textIndent) {
				if (chomping === CHOMPING_KEEP) state.result += common2.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
				else if (chomping === CHOMPING_CLIP) {
					if (didReadContent) state.result += "\n";
				}
				break;
			}
			if (folding) if (isWhiteSpace(ch)) {
				atMoreIndented = true;
				state.result += common2.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
			} else if (atMoreIndented) {
				atMoreIndented = false;
				state.result += common2.repeat("\n", emptyLines + 1);
			} else if (emptyLines === 0) {
				if (didReadContent) state.result += " ";
			} else state.result += common2.repeat("\n", emptyLines);
			else state.result += common2.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
			didReadContent = true;
			detectedIndent = true;
			emptyLines = 0;
			const captureStart = state.position;
			while (!isEol(ch) && ch !== 0) ch = state.input.charCodeAt(++state.position);
			captureSegment(state, captureStart, state.position, false);
		}
		return true;
	}
	function readBlockSequence(state, nodeIndent) {
		const _tag = state.tag;
		const _anchor = state.anchor;
		const _result = [];
		let detected = false;
		if (state.firstTabInLine !== -1) return false;
		if (state.anchor !== null) storeAnchor(state, state.anchor, _result);
		let ch = state.input.charCodeAt(state.position);
		while (ch !== 0) {
			if (state.firstTabInLine !== -1) {
				state.position = state.firstTabInLine;
				throwError(state, "tab characters must not be used in indentation");
			}
			if (ch !== 45) break;
			if (!isWsOrEol(state.input.charCodeAt(state.position + 1))) break;
			detected = true;
			state.position++;
			if (skipSeparationSpace(state, true, -1)) {
				if (state.lineIndent <= nodeIndent) {
					_result.push(null);
					ch = state.input.charCodeAt(state.position);
					continue;
				}
			}
			const _line = state.line;
			composeNode(state, nodeIndent, CONTEXT_BLOCK_IN, false, true);
			_result.push(state.result);
			skipSeparationSpace(state, true, -1);
			ch = state.input.charCodeAt(state.position);
			if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) throwError(state, "bad indentation of a sequence entry");
			else if (state.lineIndent < nodeIndent) break;
		}
		if (detected) {
			state.tag = _tag;
			state.anchor = _anchor;
			state.kind = "sequence";
			state.result = _result;
			return true;
		}
		return false;
	}
	function readBlockMapping(state, nodeIndent, flowIndent) {
		let allowCompact;
		let _keyLine;
		let _keyLineStart;
		let _keyPos;
		const _tag = state.tag;
		const _anchor = state.anchor;
		const _result = {};
		const overridableKeys = /* @__PURE__ */ Object.create(null);
		let keyTag = null;
		let keyNode = null;
		let valueNode = null;
		let atExplicitKey = false;
		let detected = false;
		if (state.firstTabInLine !== -1) return false;
		if (state.anchor !== null) storeAnchor(state, state.anchor, _result);
		let ch = state.input.charCodeAt(state.position);
		while (ch !== 0) {
			if (!atExplicitKey && state.firstTabInLine !== -1) {
				state.position = state.firstTabInLine;
				throwError(state, "tab characters must not be used in indentation");
			}
			const following = state.input.charCodeAt(state.position + 1);
			const _line = state.line;
			if ((ch === 63 || ch === 58) && isWsOrEol(following)) {
				if (ch === 63) {
					if (atExplicitKey) {
						storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
						keyTag = keyNode = valueNode = null;
					}
					detected = true;
					atExplicitKey = true;
					allowCompact = true;
				} else if (atExplicitKey) {
					atExplicitKey = false;
					allowCompact = true;
				} else throwError(state, "incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line");
				state.position += 1;
				ch = following;
			} else {
				_keyLine = state.line;
				_keyLineStart = state.lineStart;
				_keyPos = state.position;
				if (!composeNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true)) break;
				if (state.line === _line) {
					ch = state.input.charCodeAt(state.position);
					while (isWhiteSpace(ch)) ch = state.input.charCodeAt(++state.position);
					if (ch === 58) {
						ch = state.input.charCodeAt(++state.position);
						if (!isWsOrEol(ch)) throwError(state, "a whitespace character is expected after the key-value separator within a block mapping");
						if (atExplicitKey) {
							storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
							keyTag = keyNode = valueNode = null;
						}
						detected = true;
						atExplicitKey = false;
						allowCompact = false;
						keyTag = state.tag;
						keyNode = state.result;
					} else if (detected) throwError(state, "can not read an implicit mapping pair; a colon is missed");
					else {
						state.tag = _tag;
						state.anchor = _anchor;
						return true;
					}
				} else if (detected) throwError(state, "can not read a block mapping entry; a multiline key may not be an implicit key");
				else {
					state.tag = _tag;
					state.anchor = _anchor;
					return true;
				}
			}
			if (state.line === _line || state.lineIndent > nodeIndent) {
				if (atExplicitKey) {
					_keyLine = state.line;
					_keyLineStart = state.lineStart;
					_keyPos = state.position;
				}
				if (composeNode(state, nodeIndent, CONTEXT_BLOCK_OUT, true, allowCompact)) if (atExplicitKey) keyNode = state.result;
				else valueNode = state.result;
				if (!atExplicitKey) {
					storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _keyLine, _keyLineStart, _keyPos);
					keyTag = keyNode = valueNode = null;
				}
				skipSeparationSpace(state, true, -1);
				ch = state.input.charCodeAt(state.position);
			}
			if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) throwError(state, "bad indentation of a mapping entry");
			else if (state.lineIndent < nodeIndent) break;
		}
		if (atExplicitKey) storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
		if (detected) {
			state.tag = _tag;
			state.anchor = _anchor;
			state.kind = "mapping";
			state.result = _result;
		}
		return detected;
	}
	function readTagProperty(state) {
		let isVerbatim = false;
		let isNamed = false;
		let tagHandle;
		let tagName;
		let ch = state.input.charCodeAt(state.position);
		if (ch !== 33) return false;
		if (state.tag !== null) throwError(state, "duplication of a tag property");
		ch = state.input.charCodeAt(++state.position);
		if (ch === 60) {
			isVerbatim = true;
			ch = state.input.charCodeAt(++state.position);
		} else if (ch === 33) {
			isNamed = true;
			tagHandle = "!!";
			ch = state.input.charCodeAt(++state.position);
		} else tagHandle = "!";
		let _position = state.position;
		if (isVerbatim) {
			do
				ch = state.input.charCodeAt(++state.position);
			while (ch !== 0 && ch !== 62);
			if (state.position < state.length) {
				tagName = state.input.slice(_position, state.position);
				ch = state.input.charCodeAt(++state.position);
			} else throwError(state, "unexpected end of the stream within a verbatim tag");
		} else {
			while (ch !== 0 && !isWsOrEol(ch)) {
				if (ch === 33) if (!isNamed) {
					tagHandle = state.input.slice(_position - 1, state.position + 1);
					if (!PATTERN_TAG_HANDLE.test(tagHandle)) throwError(state, "named tag handle cannot contain such characters");
					isNamed = true;
					_position = state.position + 1;
				} else throwError(state, "tag suffix cannot contain exclamation marks");
				ch = state.input.charCodeAt(++state.position);
			}
			tagName = state.input.slice(_position, state.position);
			if (PATTERN_FLOW_INDICATORS.test(tagName)) throwError(state, "tag suffix cannot contain flow indicator characters");
		}
		if (tagName && !PATTERN_TAG_URI.test(tagName)) throwError(state, "tag name cannot contain such characters: " + tagName);
		try {
			tagName = decodeURIComponent(tagName);
		} catch (err) {
			throwError(state, "tag name is malformed: " + tagName);
		}
		if (isVerbatim) state.tag = tagName;
		else if (_hasOwnProperty.call(state.tagMap, tagHandle)) state.tag = state.tagMap[tagHandle] + tagName;
		else if (tagHandle === "!") state.tag = "!" + tagName;
		else if (tagHandle === "!!") state.tag = "tag:yaml.org,2002:" + tagName;
		else throwError(state, "undeclared tag handle \"" + tagHandle + "\"");
		return true;
	}
	function readAnchorProperty(state) {
		let ch = state.input.charCodeAt(state.position);
		if (ch !== 38) return false;
		if (state.anchor !== null) throwError(state, "duplication of an anchor property");
		ch = state.input.charCodeAt(++state.position);
		const _position = state.position;
		while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch)) ch = state.input.charCodeAt(++state.position);
		if (state.position === _position) throwError(state, "name of an anchor node must contain at least one character");
		state.anchor = state.input.slice(_position, state.position);
		return true;
	}
	function readAlias(state) {
		let ch = state.input.charCodeAt(state.position);
		if (ch !== 42) return false;
		ch = state.input.charCodeAt(++state.position);
		const _position = state.position;
		while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch)) ch = state.input.charCodeAt(++state.position);
		if (state.position === _position) throwError(state, "name of an alias node must contain at least one character");
		const alias = state.input.slice(_position, state.position);
		if (!_hasOwnProperty.call(state.anchorMap, alias)) throwError(state, "unidentified alias \"" + alias + "\"");
		state.result = state.anchorMap[alias];
		skipSeparationSpace(state, true, -1);
		return true;
	}
	function tryReadBlockMappingFromProperty(state, propertyStart, nodeIndent, flowIndent) {
		const fallbackState = snapshotState(state);
		beginAnchorTransaction(state);
		restoreState(state, propertyStart);
		state.tag = null;
		state.anchor = null;
		state.kind = null;
		state.result = null;
		if (readBlockMapping(state, nodeIndent, flowIndent) && state.kind === "mapping") {
			commitAnchorTransaction(state);
			return true;
		}
		rollbackAnchorTransaction(state);
		restoreState(state, fallbackState);
		return false;
	}
	function composeNode(state, parentIndent, nodeContext, allowToSeek, allowCompact) {
		let allowBlockScalars;
		let allowBlockCollections;
		let indentStatus = 1;
		let atNewLine = false;
		let hasContent = false;
		let propertyStart = null;
		let type2;
		let flowIndent;
		let blockIndent;
		if (state.depth >= state.maxDepth) throwError(state, "nesting exceeded maxDepth (" + state.maxDepth + ")");
		state.depth += 1;
		if (state.listener !== null) state.listener("open", state);
		state.tag = null;
		state.anchor = null;
		state.kind = null;
		state.result = null;
		const allowBlockStyles = allowBlockScalars = allowBlockCollections = CONTEXT_BLOCK_OUT === nodeContext || CONTEXT_BLOCK_IN === nodeContext;
		if (allowToSeek) {
			if (skipSeparationSpace(state, true, -1)) {
				atNewLine = true;
				if (state.lineIndent > parentIndent) indentStatus = 1;
				else if (state.lineIndent === parentIndent) indentStatus = 0;
				else if (state.lineIndent < parentIndent) indentStatus = -1;
			}
		}
		if (indentStatus === 1) while (true) {
			const ch = state.input.charCodeAt(state.position);
			const propertyState = snapshotState(state);
			if (atNewLine && (ch === 33 && state.tag !== null || ch === 38 && state.anchor !== null)) break;
			if (!readTagProperty(state) && !readAnchorProperty(state)) break;
			if (propertyStart === null) propertyStart = propertyState;
			if (skipSeparationSpace(state, true, -1)) {
				atNewLine = true;
				allowBlockCollections = allowBlockStyles;
				if (state.lineIndent > parentIndent) indentStatus = 1;
				else if (state.lineIndent === parentIndent) indentStatus = 0;
				else if (state.lineIndent < parentIndent) indentStatus = -1;
			} else allowBlockCollections = false;
		}
		if (allowBlockCollections) allowBlockCollections = atNewLine || allowCompact;
		if (indentStatus === 1 || CONTEXT_BLOCK_OUT === nodeContext) {
			if (CONTEXT_FLOW_IN === nodeContext || CONTEXT_FLOW_OUT === nodeContext) flowIndent = parentIndent;
			else flowIndent = parentIndent + 1;
			blockIndent = state.position - state.lineStart;
			if (indentStatus === 1) if (allowBlockCollections && (readBlockSequence(state, blockIndent) || readBlockMapping(state, blockIndent, flowIndent)) || readFlowCollection(state, flowIndent)) hasContent = true;
			else {
				const ch = state.input.charCodeAt(state.position);
				if (propertyStart !== null && allowBlockStyles && !allowBlockCollections && ch !== 124 && ch !== 62 && tryReadBlockMappingFromProperty(state, propertyStart, propertyStart.position - propertyStart.lineStart, flowIndent)) hasContent = true;
				else if (allowBlockScalars && readBlockScalar(state, flowIndent) || readSingleQuotedScalar(state, flowIndent) || readDoubleQuotedScalar(state, flowIndent)) hasContent = true;
				else if (readAlias(state)) {
					hasContent = true;
					if (state.tag !== null || state.anchor !== null) throwError(state, "alias node should not have any properties");
				} else if (readPlainScalar(state, flowIndent, CONTEXT_FLOW_IN === nodeContext)) {
					hasContent = true;
					if (state.tag === null) state.tag = "?";
				}
				if (state.anchor !== null) storeAnchor(state, state.anchor, state.result);
			}
			else if (indentStatus === 0) hasContent = allowBlockCollections && readBlockSequence(state, blockIndent);
		}
		if (state.tag === null) {
			if (state.anchor !== null) storeAnchor(state, state.anchor, state.result);
		} else if (state.tag === "?") {
			if (state.result !== null && state.kind !== "scalar") throwError(state, "unacceptable node kind for !<?> tag; it should be \"scalar\", not \"" + state.kind + "\"");
			for (let typeIndex = 0, typeQuantity = state.implicitTypes.length; typeIndex < typeQuantity; typeIndex += 1) {
				type2 = state.implicitTypes[typeIndex];
				if (type2.resolve(state.result)) {
					state.result = type2.construct(state.result);
					state.tag = type2.tag;
					if (state.anchor !== null) storeAnchor(state, state.anchor, state.result);
					break;
				}
			}
		} else if (state.tag !== "!") {
			if (_hasOwnProperty.call(state.typeMap[state.kind || "fallback"], state.tag)) type2 = state.typeMap[state.kind || "fallback"][state.tag];
			else {
				type2 = null;
				const typeList = state.typeMap.multi[state.kind || "fallback"];
				for (let typeIndex = 0, typeQuantity = typeList.length; typeIndex < typeQuantity; typeIndex += 1) if (state.tag.slice(0, typeList[typeIndex].tag.length) === typeList[typeIndex].tag) {
					type2 = typeList[typeIndex];
					break;
				}
			}
			if (!type2) throwError(state, "unknown tag !<" + state.tag + ">");
			if (state.result !== null && type2.kind !== state.kind) throwError(state, "unacceptable node kind for !<" + state.tag + "> tag; it should be \"" + type2.kind + "\", not \"" + state.kind + "\"");
			if (!type2.resolve(state.result, state.tag)) throwError(state, "cannot resolve a node with !<" + state.tag + "> explicit tag");
			else {
				state.result = type2.construct(state.result, state.tag);
				if (state.anchor !== null) storeAnchor(state, state.anchor, state.result);
			}
		}
		if (state.listener !== null) state.listener("close", state);
		state.depth -= 1;
		return state.tag !== null || state.anchor !== null || hasContent;
	}
	function readDocument(state) {
		const documentStart = state.position;
		let hasDirectives = false;
		let ch;
		state.version = null;
		state.checkLineBreaks = state.legacy;
		state.tagMap = /* @__PURE__ */ Object.create(null);
		state.anchorMap = /* @__PURE__ */ Object.create(null);
		while ((ch = state.input.charCodeAt(state.position)) !== 0) {
			skipSeparationSpace(state, true, -1);
			ch = state.input.charCodeAt(state.position);
			if (state.lineIndent > 0 || ch !== 37) break;
			hasDirectives = true;
			ch = state.input.charCodeAt(++state.position);
			let _position = state.position;
			while (ch !== 0 && !isWsOrEol(ch)) ch = state.input.charCodeAt(++state.position);
			const directiveName = state.input.slice(_position, state.position);
			const directiveArgs = [];
			if (directiveName.length < 1) throwError(state, "directive name must not be less than one character in length");
			while (ch !== 0) {
				while (isWhiteSpace(ch)) ch = state.input.charCodeAt(++state.position);
				if (ch === 35) {
					do
						ch = state.input.charCodeAt(++state.position);
					while (ch !== 0 && !isEol(ch));
					break;
				}
				if (isEol(ch)) break;
				_position = state.position;
				while (ch !== 0 && !isWsOrEol(ch)) ch = state.input.charCodeAt(++state.position);
				directiveArgs.push(state.input.slice(_position, state.position));
			}
			if (ch !== 0) readLineBreak(state);
			if (_hasOwnProperty.call(directiveHandlers, directiveName)) directiveHandlers[directiveName](state, directiveName, directiveArgs);
			else throwWarning(state, "unknown document directive \"" + directiveName + "\"");
		}
		skipSeparationSpace(state, true, -1);
		if (state.lineIndent === 0 && state.input.charCodeAt(state.position) === 45 && state.input.charCodeAt(state.position + 1) === 45 && state.input.charCodeAt(state.position + 2) === 45) {
			state.position += 3;
			skipSeparationSpace(state, true, -1);
		} else if (hasDirectives) throwError(state, "directives end mark is expected");
		composeNode(state, state.lineIndent - 1, CONTEXT_BLOCK_OUT, false, true);
		skipSeparationSpace(state, true, -1);
		if (state.checkLineBreaks && PATTERN_NON_ASCII_LINE_BREAKS.test(state.input.slice(documentStart, state.position))) throwWarning(state, "non-ASCII line breaks are interpreted as content");
		state.documents.push(state.result);
		if (state.position === state.lineStart && testDocumentSeparator(state)) {
			if (state.input.charCodeAt(state.position) === 46) {
				state.position += 3;
				skipSeparationSpace(state, true, -1);
			}
			return;
		}
		if (state.position < state.length - 1) throwError(state, "end of the stream or a document separator is expected");
	}
	function loadDocuments(input, options) {
		input = String(input);
		options = options || {};
		if (input.length !== 0) {
			if (input.charCodeAt(input.length - 1) !== 10 && input.charCodeAt(input.length - 1) !== 13) input += "\n";
			if (input.charCodeAt(0) === 65279) input = input.slice(1);
		}
		const state = new State(input, options);
		const nullpos = input.indexOf("\0");
		if (nullpos !== -1) {
			state.position = nullpos;
			throwError(state, "null byte is not allowed in input");
		}
		state.input += "\0";
		while (state.input.charCodeAt(state.position) === 32) {
			state.lineIndent += 1;
			state.position += 1;
		}
		while (state.position < state.length - 1) readDocument(state);
		return state.documents;
	}
	function loadAll2(input, iterator, options) {
		if (iterator !== null && typeof iterator === "object" && typeof options === "undefined") {
			options = iterator;
			iterator = null;
		}
		const documents = loadDocuments(input, options);
		if (typeof iterator !== "function") return documents;
		for (let index = 0, length = documents.length; index < length; index += 1) iterator(documents[index]);
	}
	function load2(input, options) {
		const documents = loadDocuments(input, options);
		if (documents.length === 0) return;
		else if (documents.length === 1) return documents[0];
		throw new YAMLException2("expected a single document in the stream, but found more");
	}
	loader.loadAll = loadAll2;
	loader.load = load2;
	return loader;
}
var dumper = {};
var hasRequiredDumper;
function requireDumper() {
	if (hasRequiredDumper) return dumper;
	hasRequiredDumper = 1;
	const common2 = requireCommon();
	const YAMLException2 = requireException();
	const DEFAULT_SCHEMA2 = require_default();
	const _toString = Object.prototype.toString;
	const _hasOwnProperty = Object.prototype.hasOwnProperty;
	const CHAR_BOM = 65279;
	const CHAR_TAB = 9;
	const CHAR_LINE_FEED = 10;
	const CHAR_CARRIAGE_RETURN = 13;
	const CHAR_SPACE = 32;
	const CHAR_EXCLAMATION = 33;
	const CHAR_DOUBLE_QUOTE = 34;
	const CHAR_SHARP = 35;
	const CHAR_PERCENT = 37;
	const CHAR_AMPERSAND = 38;
	const CHAR_SINGLE_QUOTE = 39;
	const CHAR_ASTERISK = 42;
	const CHAR_COMMA = 44;
	const CHAR_MINUS = 45;
	const CHAR_COLON = 58;
	const CHAR_EQUALS = 61;
	const CHAR_GREATER_THAN = 62;
	const CHAR_QUESTION = 63;
	const CHAR_COMMERCIAL_AT = 64;
	const CHAR_LEFT_SQUARE_BRACKET = 91;
	const CHAR_RIGHT_SQUARE_BRACKET = 93;
	const CHAR_GRAVE_ACCENT = 96;
	const CHAR_LEFT_CURLY_BRACKET = 123;
	const CHAR_VERTICAL_LINE = 124;
	const CHAR_RIGHT_CURLY_BRACKET = 125;
	const ESCAPE_SEQUENCES = {};
	ESCAPE_SEQUENCES[0] = "\\0";
	ESCAPE_SEQUENCES[7] = "\\a";
	ESCAPE_SEQUENCES[8] = "\\b";
	ESCAPE_SEQUENCES[9] = "\\t";
	ESCAPE_SEQUENCES[10] = "\\n";
	ESCAPE_SEQUENCES[11] = "\\v";
	ESCAPE_SEQUENCES[12] = "\\f";
	ESCAPE_SEQUENCES[13] = "\\r";
	ESCAPE_SEQUENCES[27] = "\\e";
	ESCAPE_SEQUENCES[34] = "\\\"";
	ESCAPE_SEQUENCES[92] = "\\\\";
	ESCAPE_SEQUENCES[133] = "\\N";
	ESCAPE_SEQUENCES[160] = "\\_";
	ESCAPE_SEQUENCES[8232] = "\\L";
	ESCAPE_SEQUENCES[8233] = "\\P";
	const DEPRECATED_BOOLEANS_SYNTAX = [
		"y",
		"Y",
		"yes",
		"Yes",
		"YES",
		"on",
		"On",
		"ON",
		"n",
		"N",
		"no",
		"No",
		"NO",
		"off",
		"Off",
		"OFF"
	];
	const DEPRECATED_BASE60_SYNTAX = /^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/;
	function compileStyleMap(schema2, map2) {
		if (map2 === null) return {};
		const result = {};
		const keys = Object.keys(map2);
		for (let index = 0, length = keys.length; index < length; index += 1) {
			let tag = keys[index];
			let style = String(map2[tag]);
			if (tag.slice(0, 2) === "!!") tag = "tag:yaml.org,2002:" + tag.slice(2);
			const type2 = schema2.compiledTypeMap["fallback"][tag];
			if (type2 && _hasOwnProperty.call(type2.styleAliases, style)) style = type2.styleAliases[style];
			result[tag] = style;
		}
		return result;
	}
	function encodeHex(character) {
		let handle;
		let length;
		const string = character.toString(16).toUpperCase();
		if (character <= 255) {
			handle = "x";
			length = 2;
		} else if (character <= 65535) {
			handle = "u";
			length = 4;
		} else if (character <= 4294967295) {
			handle = "U";
			length = 8;
		} else throw new YAMLException2("code point within a string may not be greater than 0xFFFFFFFF");
		return "\\" + handle + common2.repeat("0", length - string.length) + string;
	}
	const QUOTING_TYPE_SINGLE = 1;
	const QUOTING_TYPE_DOUBLE = 2;
	function State(options) {
		this.schema = options["schema"] || DEFAULT_SCHEMA2;
		this.indent = Math.max(1, options["indent"] || 2);
		this.noArrayIndent = options["noArrayIndent"] || false;
		this.skipInvalid = options["skipInvalid"] || false;
		this.flowLevel = common2.isNothing(options["flowLevel"]) ? -1 : options["flowLevel"];
		this.styleMap = compileStyleMap(this.schema, options["styles"] || null);
		this.sortKeys = options["sortKeys"] || false;
		this.lineWidth = options["lineWidth"] || 80;
		this.noRefs = options["noRefs"] || false;
		this.noCompatMode = options["noCompatMode"] || false;
		this.condenseFlow = options["condenseFlow"] || false;
		this.quotingType = options["quotingType"] === "\"" ? QUOTING_TYPE_DOUBLE : QUOTING_TYPE_SINGLE;
		this.forceQuotes = options["forceQuotes"] || false;
		this.replacer = typeof options["replacer"] === "function" ? options["replacer"] : null;
		this.implicitTypes = this.schema.compiledImplicit;
		this.explicitTypes = this.schema.compiledExplicit;
		this.tag = null;
		this.result = "";
		this.duplicates = [];
		this.usedDuplicates = null;
	}
	function indentString(string, spaces) {
		const ind = common2.repeat(" ", spaces);
		let position = 0;
		let result = "";
		const length = string.length;
		while (position < length) {
			let line;
			const next = string.indexOf("\n", position);
			if (next === -1) {
				line = string.slice(position);
				position = length;
			} else {
				line = string.slice(position, next + 1);
				position = next + 1;
			}
			if (line.length && line !== "\n") result += ind;
			result += line;
		}
		return result;
	}
	function generateNextLine(state, level) {
		return "\n" + common2.repeat(" ", state.indent * level);
	}
	function testImplicitResolving(state, str2) {
		for (let index = 0, length = state.implicitTypes.length; index < length; index += 1) if (state.implicitTypes[index].resolve(str2)) return true;
		return false;
	}
	function isWhitespace(c) {
		return c === CHAR_SPACE || c === CHAR_TAB;
	}
	function isPrintable(c) {
		return c >= 32 && c <= 126 || c >= 161 && c <= 55295 && c !== 8232 && c !== 8233 || c >= 57344 && c <= 65533 && c !== CHAR_BOM || c >= 65536 && c <= 1114111;
	}
	function isNsCharOrWhitespace(c) {
		return isPrintable(c) && c !== CHAR_BOM && c !== CHAR_CARRIAGE_RETURN && c !== CHAR_LINE_FEED;
	}
	function isPlainSafe(c, prev, inblock) {
		const cIsNsCharOrWhitespace = isNsCharOrWhitespace(c);
		const cIsNsChar = cIsNsCharOrWhitespace && !isWhitespace(c);
		return (inblock ? cIsNsCharOrWhitespace : cIsNsCharOrWhitespace && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET) && c !== CHAR_SHARP && !(prev === CHAR_COLON && !cIsNsChar) || isNsCharOrWhitespace(prev) && !isWhitespace(prev) && c === CHAR_SHARP || prev === CHAR_COLON && cIsNsChar;
	}
	function isPlainSafeFirst(c) {
		return isPrintable(c) && c !== CHAR_BOM && !isWhitespace(c) && c !== CHAR_MINUS && c !== CHAR_QUESTION && c !== CHAR_COLON && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET && c !== CHAR_SHARP && c !== CHAR_AMPERSAND && c !== CHAR_ASTERISK && c !== CHAR_EXCLAMATION && c !== CHAR_VERTICAL_LINE && c !== CHAR_EQUALS && c !== CHAR_GREATER_THAN && c !== CHAR_SINGLE_QUOTE && c !== CHAR_DOUBLE_QUOTE && c !== CHAR_PERCENT && c !== CHAR_COMMERCIAL_AT && c !== CHAR_GRAVE_ACCENT;
	}
	function isPlainSafeLast(c) {
		return !isWhitespace(c) && c !== CHAR_COLON;
	}
	function codePointAt(string, pos) {
		const first = string.charCodeAt(pos);
		let second;
		if (first >= 55296 && first <= 56319 && pos + 1 < string.length) {
			second = string.charCodeAt(pos + 1);
			if (second >= 56320 && second <= 57343) return (first - 55296) * 1024 + second - 56320 + 65536;
		}
		return first;
	}
	function needIndentIndicator(string) {
		return /^\n* /.test(string);
	}
	const STYLE_PLAIN = 1;
	const STYLE_SINGLE = 2;
	const STYLE_LITERAL = 3;
	const STYLE_FOLDED = 4;
	const STYLE_DOUBLE = 5;
	function chooseScalarStyle(string, singleLineOnly, indentPerLevel, lineWidth, testAmbiguousType, quotingType, forceQuotes, inblock) {
		let i;
		let char = 0;
		let prevChar = null;
		let hasLineBreak = false;
		let hasFoldableLine = false;
		const shouldTrackWidth = lineWidth !== -1;
		let previousLineBreak = -1;
		let plain = isPlainSafeFirst(codePointAt(string, 0)) && isPlainSafeLast(codePointAt(string, string.length - 1));
		if (singleLineOnly || forceQuotes) for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
			char = codePointAt(string, i);
			if (!isPrintable(char)) return STYLE_DOUBLE;
			plain = plain && isPlainSafe(char, prevChar, inblock);
			prevChar = char;
		}
		else {
			for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
				char = codePointAt(string, i);
				if (char === CHAR_LINE_FEED) {
					hasLineBreak = true;
					if (shouldTrackWidth) {
						hasFoldableLine = hasFoldableLine || i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
						previousLineBreak = i;
					}
				} else if (!isPrintable(char)) return STYLE_DOUBLE;
				plain = plain && isPlainSafe(char, prevChar, inblock);
				prevChar = char;
			}
			hasFoldableLine = hasFoldableLine || shouldTrackWidth && i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
		}
		if (!hasLineBreak && !hasFoldableLine) {
			if (plain && !forceQuotes && !testAmbiguousType(string)) return STYLE_PLAIN;
			return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
		}
		if (indentPerLevel > 9 && needIndentIndicator(string)) return STYLE_DOUBLE;
		if (!forceQuotes) return hasFoldableLine ? STYLE_FOLDED : STYLE_LITERAL;
		return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
	}
	function writeScalar(state, string, level, iskey, inblock) {
		state.dump = (function() {
			if (string.length === 0) return state.quotingType === QUOTING_TYPE_DOUBLE ? "\"\"" : "''";
			if (!state.noCompatMode) {
				if (DEPRECATED_BOOLEANS_SYNTAX.indexOf(string) !== -1 || DEPRECATED_BASE60_SYNTAX.test(string)) return state.quotingType === QUOTING_TYPE_DOUBLE ? "\"" + string + "\"" : "'" + string + "'";
			}
			const indent = state.indent * Math.max(1, level);
			const lineWidth = state.lineWidth === -1 ? -1 : Math.max(Math.min(state.lineWidth, 40), state.lineWidth - indent);
			const singleLineOnly = iskey || state.flowLevel > -1 && level >= state.flowLevel;
			function testAmbiguity(string2) {
				return testImplicitResolving(state, string2);
			}
			switch (chooseScalarStyle(string, singleLineOnly, state.indent, lineWidth, testAmbiguity, state.quotingType, state.forceQuotes && !iskey, inblock)) {
				case STYLE_PLAIN: return string;
				case STYLE_SINGLE: return "'" + string.replace(/'/g, "''") + "'";
				case STYLE_LITERAL: return "|" + blockHeader(string, state.indent) + dropEndingNewline(indentString(string, indent));
				case STYLE_FOLDED: return ">" + blockHeader(string, state.indent) + dropEndingNewline(indentString(foldString(string, lineWidth), indent));
				case STYLE_DOUBLE: return "\"" + escapeString(string) + "\"";
				default: throw new YAMLException2("impossible error: invalid scalar style");
			}
		})();
	}
	function blockHeader(string, indentPerLevel) {
		const indentIndicator = needIndentIndicator(string) ? String(indentPerLevel) : "";
		const clip = string[string.length - 1] === "\n";
		return indentIndicator + (clip && (string[string.length - 2] === "\n" || string === "\n") ? "+" : clip ? "" : "-") + "\n";
	}
	function dropEndingNewline(string) {
		return string[string.length - 1] === "\n" ? string.slice(0, -1) : string;
	}
	function foldString(string, width) {
		const lineRe = /(\n+)([^\n]*)/g;
		let result = (function() {
			let nextLF = string.indexOf("\n");
			nextLF = nextLF !== -1 ? nextLF : string.length;
			lineRe.lastIndex = nextLF;
			return foldLine(string.slice(0, nextLF), width);
		})();
		let prevMoreIndented = string[0] === "\n" || string[0] === " ";
		let moreIndented;
		let match;
		while (match = lineRe.exec(string)) {
			const prefix = match[1];
			const line = match[2];
			moreIndented = line[0] === " ";
			result += prefix + (!prevMoreIndented && !moreIndented && line !== "" ? "\n" : "") + foldLine(line, width);
			prevMoreIndented = moreIndented;
		}
		return result;
	}
	function foldLine(line, width) {
		if (line === "" || line[0] === " ") return line;
		const breakRe = / [^ ]/g;
		let match;
		let start = 0;
		let end;
		let curr = 0;
		let next = 0;
		let result = "";
		while (match = breakRe.exec(line)) {
			next = match.index;
			if (next - start > width) {
				end = curr > start ? curr : next;
				result += "\n" + line.slice(start, end);
				start = end + 1;
			}
			curr = next;
		}
		result += "\n";
		if (line.length - start > width && curr > start) result += line.slice(start, curr) + "\n" + line.slice(curr + 1);
		else result += line.slice(start);
		return result.slice(1);
	}
	function escapeString(string) {
		let result = "";
		let char = 0;
		for (let i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
			char = codePointAt(string, i);
			const escapeSeq = ESCAPE_SEQUENCES[char];
			if (!escapeSeq && isPrintable(char)) {
				result += string[i];
				if (char >= 65536) result += string[i + 1];
			} else result += escapeSeq || encodeHex(char);
		}
		return result;
	}
	function writeFlowSequence(state, level, object) {
		let _result = "";
		const _tag = state.tag;
		for (let index = 0, length = object.length; index < length; index += 1) {
			let value = object[index];
			if (state.replacer) value = state.replacer.call(object, String(index), value);
			if (writeNode(state, level, value, false, false) || typeof value === "undefined" && writeNode(state, level, null, false, false)) {
				if (_result !== "") _result += "," + (!state.condenseFlow ? " " : "");
				_result += state.dump;
			}
		}
		state.tag = _tag;
		state.dump = "[" + _result + "]";
	}
	function writeBlockSequence(state, level, object, compact) {
		let _result = "";
		const _tag = state.tag;
		for (let index = 0, length = object.length; index < length; index += 1) {
			let value = object[index];
			if (state.replacer) value = state.replacer.call(object, String(index), value);
			if (writeNode(state, level + 1, value, true, true, false, true) || typeof value === "undefined" && writeNode(state, level + 1, null, true, true, false, true)) {
				if (!compact || _result !== "") _result += generateNextLine(state, level);
				if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) _result += "-";
				else _result += "- ";
				_result += state.dump;
			}
		}
		state.tag = _tag;
		state.dump = _result || "[]";
	}
	function writeFlowMapping(state, level, object) {
		let _result = "";
		const _tag = state.tag;
		const objectKeyList = Object.keys(object);
		for (let index = 0, length = objectKeyList.length; index < length; index += 1) {
			let pairBuffer = "";
			if (_result !== "") pairBuffer += ", ";
			if (state.condenseFlow) pairBuffer += "\"";
			const objectKey = objectKeyList[index];
			let objectValue = object[objectKey];
			if (state.replacer) objectValue = state.replacer.call(object, objectKey, objectValue);
			if (!writeNode(state, level, objectKey, false, false)) continue;
			if (state.dump.length > 1024) pairBuffer += "? ";
			pairBuffer += state.dump + (state.condenseFlow ? "\"" : "") + ":" + (state.condenseFlow ? "" : " ");
			if (!writeNode(state, level, objectValue, false, false)) continue;
			pairBuffer += state.dump;
			_result += pairBuffer;
		}
		state.tag = _tag;
		state.dump = "{" + _result + "}";
	}
	function writeBlockMapping(state, level, object, compact) {
		let _result = "";
		const _tag = state.tag;
		const objectKeyList = Object.keys(object);
		if (state.sortKeys === true) objectKeyList.sort();
		else if (typeof state.sortKeys === "function") objectKeyList.sort(state.sortKeys);
		else if (state.sortKeys) throw new YAMLException2("sortKeys must be a boolean or a function");
		for (let index = 0, length = objectKeyList.length; index < length; index += 1) {
			let pairBuffer = "";
			if (!compact || _result !== "") pairBuffer += generateNextLine(state, level);
			const objectKey = objectKeyList[index];
			let objectValue = object[objectKey];
			if (state.replacer) objectValue = state.replacer.call(object, objectKey, objectValue);
			if (!writeNode(state, level + 1, objectKey, true, true, true)) continue;
			const explicitPair = state.tag !== null && state.tag !== "?" || state.dump && state.dump.length > 1024;
			if (explicitPair) if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) pairBuffer += "?";
			else pairBuffer += "? ";
			pairBuffer += state.dump;
			if (explicitPair) pairBuffer += generateNextLine(state, level);
			if (!writeNode(state, level + 1, objectValue, true, explicitPair)) continue;
			if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) pairBuffer += ":";
			else pairBuffer += ": ";
			pairBuffer += state.dump;
			_result += pairBuffer;
		}
		state.tag = _tag;
		state.dump = _result || "{}";
	}
	function detectType(state, object, explicit) {
		const typeList = explicit ? state.explicitTypes : state.implicitTypes;
		for (let index = 0, length = typeList.length; index < length; index += 1) {
			const type2 = typeList[index];
			if ((type2.instanceOf || type2.predicate) && (!type2.instanceOf || typeof object === "object" && object instanceof type2.instanceOf) && (!type2.predicate || type2.predicate(object))) {
				if (explicit) if (type2.multi && type2.representName) state.tag = type2.representName(object);
				else state.tag = type2.tag;
				else state.tag = "?";
				if (type2.represent) {
					const style = state.styleMap[type2.tag] || type2.defaultStyle;
					let _result;
					if (_toString.call(type2.represent) === "[object Function]") _result = type2.represent(object, style);
					else if (_hasOwnProperty.call(type2.represent, style)) _result = type2.represent[style](object, style);
					else throw new YAMLException2("!<" + type2.tag + "> tag resolver accepts not \"" + style + "\" style");
					state.dump = _result;
				}
				return true;
			}
		}
		return false;
	}
	function writeNode(state, level, object, block, compact, iskey, isblockseq) {
		state.tag = null;
		state.dump = object;
		if (!detectType(state, object, false)) detectType(state, object, true);
		const type2 = _toString.call(state.dump);
		const inblock = block;
		if (block) block = state.flowLevel < 0 || state.flowLevel > level;
		const objectOrArray = type2 === "[object Object]" || type2 === "[object Array]";
		let duplicateIndex;
		let duplicate;
		if (objectOrArray) {
			duplicateIndex = state.duplicates.indexOf(object);
			duplicate = duplicateIndex !== -1;
		}
		if (state.tag !== null && state.tag !== "?" || duplicate || state.indent !== 2 && level > 0) compact = false;
		if (duplicate && state.usedDuplicates[duplicateIndex]) state.dump = "*ref_" + duplicateIndex;
		else {
			if (objectOrArray && duplicate && !state.usedDuplicates[duplicateIndex]) state.usedDuplicates[duplicateIndex] = true;
			if (type2 === "[object Object]") if (block && Object.keys(state.dump).length !== 0) {
				writeBlockMapping(state, level, state.dump, compact);
				if (duplicate) state.dump = "&ref_" + duplicateIndex + state.dump;
			} else {
				writeFlowMapping(state, level, state.dump);
				if (duplicate) state.dump = "&ref_" + duplicateIndex + " " + state.dump;
			}
			else if (type2 === "[object Array]") if (block && state.dump.length !== 0) {
				if (state.noArrayIndent && !isblockseq && level > 0) writeBlockSequence(state, level - 1, state.dump, compact);
				else writeBlockSequence(state, level, state.dump, compact);
				if (duplicate) state.dump = "&ref_" + duplicateIndex + state.dump;
			} else {
				writeFlowSequence(state, level, state.dump);
				if (duplicate) state.dump = "&ref_" + duplicateIndex + " " + state.dump;
			}
			else if (type2 === "[object String]") {
				if (state.tag !== "?") writeScalar(state, state.dump, level, iskey, inblock);
			} else if (type2 === "[object Undefined]") return false;
			else {
				if (state.skipInvalid) return false;
				throw new YAMLException2("unacceptable kind of an object to dump " + type2);
			}
			if (state.tag !== null && state.tag !== "?") {
				let tagStr = encodeURI(state.tag[0] === "!" ? state.tag.slice(1) : state.tag).replace(/!/g, "%21");
				if (state.tag[0] === "!") tagStr = "!" + tagStr;
				else if (tagStr.slice(0, 18) === "tag:yaml.org,2002:") tagStr = "!!" + tagStr.slice(18);
				else tagStr = "!<" + tagStr + ">";
				state.dump = tagStr + " " + state.dump;
			}
		}
		return true;
	}
	function getDuplicateReferences(object, state) {
		const objects = [];
		const duplicatesIndexes = [];
		inspectNode(object, objects, duplicatesIndexes);
		const length = duplicatesIndexes.length;
		for (let index = 0; index < length; index += 1) state.duplicates.push(objects[duplicatesIndexes[index]]);
		state.usedDuplicates = new Array(length);
	}
	function inspectNode(object, objects, duplicatesIndexes) {
		if (object !== null && typeof object === "object") {
			const index = objects.indexOf(object);
			if (index !== -1) {
				if (duplicatesIndexes.indexOf(index) === -1) duplicatesIndexes.push(index);
			} else {
				objects.push(object);
				if (Array.isArray(object)) for (let i = 0, length = object.length; i < length; i += 1) inspectNode(object[i], objects, duplicatesIndexes);
				else {
					const objectKeyList = Object.keys(object);
					for (let i = 0, length = objectKeyList.length; i < length; i += 1) inspectNode(object[objectKeyList[i]], objects, duplicatesIndexes);
				}
			}
		}
	}
	function dump2(input, options) {
		options = options || {};
		const state = new State(options);
		if (!state.noRefs) getDuplicateReferences(input, state);
		let value = input;
		if (state.replacer) value = state.replacer.call({ "": value }, "", value);
		if (writeNode(state, 0, value, true, true)) return state.dump + "\n";
		return "";
	}
	dumper.dump = dump2;
	return dumper;
}
var hasRequiredJsYaml;
function requireJsYaml() {
	if (hasRequiredJsYaml) return jsYaml;
	hasRequiredJsYaml = 1;
	const loader2 = requireLoader();
	const dumper2 = requireDumper();
	function renamed(from, to) {
		return function() {
			throw new Error("Function yaml." + from + " is removed in js-yaml 4. Use yaml." + to + " instead, which is now safe by default.");
		};
	}
	jsYaml.Type = requireType();
	jsYaml.Schema = requireSchema();
	jsYaml.FAILSAFE_SCHEMA = requireFailsafe();
	jsYaml.JSON_SCHEMA = requireJson();
	jsYaml.CORE_SCHEMA = requireCore();
	jsYaml.DEFAULT_SCHEMA = require_default();
	jsYaml.load = loader2.load;
	jsYaml.loadAll = loader2.loadAll;
	jsYaml.dump = dumper2.dump;
	jsYaml.YAMLException = requireException();
	jsYaml.types = {
		binary: requireBinary(),
		float: requireFloat(),
		map: requireMap(),
		null: require_null(),
		pairs: requirePairs(),
		set: requireSet(),
		timestamp: requireTimestamp(),
		bool: requireBool(),
		int: requireInt(),
		merge: requireMerge(),
		omap: requireOmap(),
		seq: requireSeq(),
		str: requireStr()
	};
	jsYaml.safeLoad = renamed("safeLoad", "load");
	jsYaml.safeLoadAll = renamed("safeLoadAll", "loadAll");
	jsYaml.safeDump = renamed("safeDump", "dump");
	return jsYaml;
}
const yaml = /* @__PURE__ */ getDefaultExportFromCjs(requireJsYaml());
const { Type, Schema, FAILSAFE_SCHEMA, JSON_SCHEMA, CORE_SCHEMA, DEFAULT_SCHEMA, load, loadAll, dump, YAMLException, types, safeLoad, safeLoadAll, safeDump } = yaml;
//#endregion
//#region ../../../Core/vendor/include/src/index.ts
const JsExpr = new Type("tag:yaml.org,2002:js", {
	kind: "scalar",
	resolve: (data) => typeof data === "string",
	construct: (data) => ({ __jsExpr: data }),
	predicate: isJsExpr,
	represent: (data) => data["__jsExpr"]
});
/**
* The entry-list YAML dialect: `!!js` scalars round-trip as expression nodes
* the Loader evaluates at entry activation. Exported so config tooling
* (`dsh --dump-config`) parses and prints exactly the dialect this include
* mounts.
*/
const entryListSchema = JSON_SCHEMA.extend(JsExpr);
const schema = entryListSchema;
const writable = {
	".json": "application/json",
	".yaml": "application/yaml",
	".yml": "application/yaml"
};
const supported = new Set(Object.keys(writable));
const WRITE_RETRY_LIMIT = 10;
const WRITE_RETRY_DELAY_MS = 50;
function retryableWriteError(error) {
	const code = error?.code;
	return code === "EACCES" || code === "EBUSY" || code === "EPERM";
}
/**
* Apply patch lists to an entry list — THE patch semantics of this include,
* shared by mounting (`applyPatches`) and offline config tooling
* (`dsh --dump-config`) so a dump can never drift from what boots. The input
* is never mutated and the result is always detached from it (even with no
* patches): patching or mounting shared entry objects would bake earlier
* values into the cached parse, so repeated application (config hot-reloads)
* could never revert a removed or changed patch. Inserted entries are indexed
* as they are added, so a later patch in the same list can target a row an
* earlier patch inserted. A patch that matches nothing warns and is skipped.
* @param data - the parsed entry list (JSON-safe plain data).
* @param patches - the patch list to apply, in order.
* @param warn - sink for skipped-patch diagnostics (printf-style, `%C` = code).
* @returns a detached entry list with every applicable patch applied.
*/
function applyEntryPatches(data, patches, warn) {
	data = structuredClone(data);
	if (!patches?.length) return data;
	const entryMap = /* @__PURE__ */ new Map();
	const buildMap = (entries) => {
		for (const entry of entries) {
			if (entry.id) entryMap.set(entry.id, entry);
			if (entry.group && Array.isArray(entry.config)) buildMap(entry.config);
		}
	};
	buildMap(data);
	for (const patch of patches) {
		const { id, insert, name, ...overrides } = patch;
		if (insert) {
			if (id) {
				const target = entryMap.get(id);
				if (!target) {
					warn("patch insert: entry %C not found", id);
					continue;
				}
				if (!target.group) {
					warn("patch insert: entry %C is not a group", id);
					continue;
				}
				if (!Array.isArray(target.config)) target.config = [];
				target.config.push(...insert);
			} else data.push(...insert);
			buildMap(insert);
			continue;
		}
		if (!id) {
			warn("patch: id is required for non-insert patches");
			continue;
		}
		const target = entryMap.get(id);
		if (!target) {
			warn("patch: entry %C not found", id);
			continue;
		}
		if (name && name !== target.name) {
			warn("patch: name mismatch for %C (expected %C, got %C), skipping", id, target.name, name);
			continue;
		}
		for (const [key, value] of Object.entries(overrides)) {
			if (key === "id") continue;
			target[key] = value;
		}
	}
	return data;
}
var ConfigFileError = class extends Error {
	stage;
	constructor(stage, path, cause) {
		super(`failed to ${stage} config file ${path}`, { cause });
		this.stage = stage;
		this.name = "ConfigFileError";
	}
};
/** Loader entry tree backed by a YAML or JSON file. */
var Include = class extends EntryTree {
	config;
	static inject = ["loader"];
	static [EntryGroup.key] = true;
	filename;
	type;
	readonly;
	content;
	data;
	writeTask;
	pendingWrite;
	writeQueue = Promise.resolve();
	applyQueue = Promise.resolve();
	constructor(ctx, config) {
		super(ctx);
		this.config = config;
		this.enableLogs = config.enableLogs ?? ctx.fiber.entry?.parent.tree.enableLogs ?? false;
		this.filename = fileURLToPath(new URL(this.config.path, this.ctx.baseUrl));
		const ext = extname(this.filename);
		if (!supported.has(ext)) throw new Error(`extension "${ext}" not supported`);
		this.type = writable[ext];
		this.readonly = !this.type;
		this.ctx.baseUrl = new URL(".", pathToFileURL(this.filename)).href;
		ctx.on("internal/update", async (config, _, next) => {
			if (config.path !== this.config.path) return next();
			await this.enqueue(async () => {
				const data = this.applyPatches(this.data, config.patches);
				await this.root.update(data);
				this.config = config;
			});
		});
	}
	/**
	* Serialize one child-tree mutation behind every earlier one. The group's
	* transactional `update` is not reentrant: two concurrent applies (the init
	* apply racing an HMR-triggered refresh from the watcher's initial scan)
	* interleave create and rollback on the same entries and strand the include
	* fiber without settling, so every apply path funnels through this queue.
	* A predecessor's failure is its own caller's outcome and never gates the
	* next task.
	*/
	enqueue(task) {
		const run = this.applyQueue.then(task, task);
		this.applyQueue = run.then(() => {}, () => {});
		return run;
	}
	async checkAccess() {
		if (!this.type) return;
		try {
			await access(this.filename, constants.W_OK);
		} catch {
			this.readonly = true;
		}
	}
	async read(forced = false) {
		let content;
		try {
			content = await readFile(this.filename, "utf8");
		} catch (error) {
			throw new ConfigFileError("read", this.filename, error);
		}
		if (!forced && this.content === content) return;
		let data;
		try {
			if (this.type === "application/yaml") data = load(content, { schema });
			else if (this.type === "application/json") data = JSON.parse(content);
			else {
				const module = await import(
					/* @vite-ignore */
					this.filename
);
				data = module.default || module;
			}
		} catch (error) {
			throw new ConfigFileError("parse", this.filename, error);
		}
		if (!Array.isArray(data)) throw new ConfigFileError("validate", this.filename, /* @__PURE__ */ new TypeError("config file must be a top-level array"));
		return {
			content,
			data
		};
	}
	applyPatches(data, patches) {
		return applyEntryPatches(data, patches, (message, ...args) => {
			this.ctx.root.logger?.("loader").warn(message, ...args);
		});
	}
	async *[Service.init]() {
		let candidate;
		try {
			candidate = await this.read(true);
		} catch (error) {
			if (!(error instanceof ConfigFileError) || error.stage !== "read" || error.cause?.code !== "ENOENT") throw error;
			if (this.config.initial) {
				await this._writeFile(this.config.initial);
				candidate = await this.read(true);
			} else throw new Error(`config file not found: ${this.filename}`);
		}
		yield () => this.stop();
		await this.apply(candidate);
	}
	async stop() {
		await this.root.stop();
		await this.flushWrite();
	}
	/**
	* Re-read the file and transactionally refresh child entries when content changed.
	* @returns a promise resolving after the new tree commits, or immediately when unchanged.
	* @throws when reading, parsing, validation, application, or rollback fails; the last good tree remains active when rollback succeeds.
	*/
	async refresh() {
		await this.enqueue(async () => {
			const candidate = await this.read();
			if (!candidate) return;
			await this._apply(candidate);
		});
	}
	apply(candidate) {
		return this.enqueue(() => this._apply(candidate));
	}
	async _apply(candidate) {
		const data = this.applyPatches(candidate.data, this.config.patches);
		await this.root.update(data);
		this.content = candidate.content;
		this.data = candidate.data;
		await this.checkAccess();
	}
	async _writeFile(config) {
		if (this.readonly) throw new Error(`cannot overwrite readonly config`);
		if (this.type === "application/yaml") this.content = dump(config, { schema });
		else if (this.type === "application/json") this.content = JSON.stringify(config, null, 2);
		await writeFile(this.filename + ".tmp", this.content);
		for (let retry = 0;; retry++) try {
			await rename(this.filename + ".tmp", this.filename);
			return;
		} catch (error) {
			if (!retryableWriteError(error) || retry >= WRITE_RETRY_LIMIT) throw error;
			await setTimeout$1((retry + 1) * WRITE_RETRY_DELAY_MS);
		}
	}
	writeFile(config) {
		clearTimeout(this.writeTask);
		this.pendingWrite = config;
		this.writeTask = setTimeout(() => {
			this.flushWrite();
		}, 0);
	}
	flushWrite() {
		clearTimeout(this.writeTask);
		this.writeTask = void 0;
		const config = this.pendingWrite;
		this.pendingWrite = void 0;
		if (config === void 0) return this.writeQueue;
		const run = this.writeQueue.then(() => this._writeFile(config), () => this._writeFile(config));
		this.writeQueue = run;
		run.catch((error) => {
			this.ctx.root.logger?.("loader").warn("failed to write config file %C", this.filename);
			this.ctx.root.logger?.("loader").warn(error);
		});
		return run;
	}
	/** Schedule a write of the current root entry data. */
	write() {
		this.context.emit("loader/config-update");
		return this.writeFile(this.root.data);
	}
};
//#endregion
//#region ../../preset/agent-presets/src/metadata.ts
/**
* A preset's display metadata: the name and description a picker shows.
*
* It lives in its own file because the composition is a top-level list of
* plugin rows — YAML cannot carry sibling keys beside it, and faking a
* metadata row would hand the Loader something to load. Keeping it separate
* also keeps the composition exactly what its name says: a Cordis file the
* loader owns and the cordis preset can author.
*
* The file carries display text ONLY. `id` is the directory name and `trust`
* comes from the root a preset was discovered under, so neither is writable
* here — otherwise a locally authored preset could claim to be a shipped one.
*
* Every read failure degrades to no metadata. A preset whose display text is
* missing, malformed, or unreadable still mounts: presentation is not a
* capability, and a broken name must never become an agent that cannot start.
* @module @deepseek-ai/dsh-agent-presets/metadata
*/
/** The optional display-metadata file beside a preset's composition. */
const METADATA_FILE = "preset.yml";
/** A non-empty trimmed string, or undefined for anything else. */
function text(value) {
	if (typeof value !== "string") return void 0;
	const trimmed = value.trim();
	return trimmed === "" ? void 0 : trimmed;
}
/**
* Read one preset directory's display metadata.
*
* Absent, unparsable, and wrongly-shaped files are all the same answer —
* empty metadata — because the caller renders a picker, not a diagnostic.
* @param directory - the preset directory.
* @returns the display text the preset published, possibly empty.
*/
async function readPresetMetadata(directory) {
	let raw;
	try {
		raw = await readFile(join(directory, METADATA_FILE), "utf8");
	} catch {
		return {};
	}
	let parsed;
	try {
		parsed = yaml.load(raw);
	} catch {
		return {};
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
	const record = parsed;
	const name = text(record.name);
	const description = text(record.description);
	const order = typeof record.order === "number" && Number.isFinite(record.order) ? record.order : void 0;
	return {
		...name === void 0 ? {} : { name },
		...description === void 0 ? {} : { description },
		...order === void 0 ? {} : { order }
	};
}
/**
* Render display metadata as the file's contents.
*
* Absent fields are omitted rather than written empty, so a preset with no
* description does not ship a key that reads as an intentional blank.
* @param metadata - the display text to store.
* @returns the YAML document, or undefined when there is nothing to store.
*/
function renderPresetMetadata(metadata) {
	const name = text(metadata.name);
	const description = text(metadata.description);
	const { order } = metadata;
	if (name === void 0 && description === void 0 && order === void 0) return void 0;
	return yaml.dump({
		...name === void 0 ? {} : { name },
		...description === void 0 ? {} : { description },
		...order === void 0 ? {} : { order }
	}, { lineWidth: -1 });
}
//#endregion
//#region ../../preset/agent-presets/src/preset.ts
/**
* Ids a preset directory may use.
*
* The id becomes a path segment, so this is a containment boundary rather than
* a style rule: `..`, a separator, or an absolute-looking name would place the
* composition outside the root the deployment authorised. Discovery shares it:
* a directory whose name no copy could ever claim is not a preset slot.
*/
const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/;
//#endregion
//#region ../../preset/agent-presets/src/specifier.ts
/**
* How one composition row's `name` reaches a module.
*
* A preset composition is read by `Include`, which rewrites its context's
* `baseUrl` to the composition's own directory. That is right for a row
* naming a file the preset ships and wrong for a row naming a package: a
* locally authored preset lives under the user's home, where Node's upward
* `node_modules` walk never reaches the harness's own dependencies. Both the
* mount's import override and discovery's health check therefore have to
* classify a row's name before they can act on it, and they must classify it
* the same way — a row discovery resolves from one base and the mount imports
* from another would be reported healthy and then fail to load.
* @module @deepseek-ai/dsh-agent-presets/specifier
*/
/**
* Classify one row's `name`.
*
* An absolute filesystem path becomes a file URL here rather than at each
* call site, because Node's ESM resolver rejects a bare drive-letter path on
* Windows. A `file:` URL is already one and joins it: the Loader accepts both
* spellings for the same thing, and treating the URL as a package name would
* hand it to a resolver that only normalizes it, reporting a file that is not
* there as present. The `specifier` a caller receives is always the string to
* hand a resolver; only `kind` decides which base it goes with.
* @param name - the module specifier exactly as the row wrote it.
* @returns the classification, carrying the specifier to resolve.
*/
function classifyRowSpecifier(name) {
	if (name.startsWith("cordis:")) return {
		kind: "builtin",
		specifier: name
	};
	if (name.startsWith(".")) return {
		kind: "preset",
		specifier: name
	};
	if (name.startsWith("file:")) return {
		kind: "file",
		specifier: name
	};
	if (isAbsolute(name)) return {
		kind: "file",
		specifier: pathToFileURL(name).href
	};
	return {
		kind: "package",
		specifier: name
	};
}
//#endregion
//#region ../../preset/agent-presets/src/discovery.ts
/**
* Filesystem discovery of agent presets. A preset is a directory holding
* {@link COMPOSITION_FILE}, optionally beside a {@link METADATA_FILE} carrying
* its display text; the directory name is the preset id. Discovery
* re-reads the roots on every call so a preset authored while the process is
* running is visible without a restart.
*
* Discovery also owns preset HEALTH: a directory whose composition is
* missing or unloadable is reported as a broken roster row rather than
* skipped. A skipped directory would still occupy its id on disk — the copy
* path refuses the name while no surface shows anything to delete — and a
* malformed composition would otherwise read as an ordinary preset until the
* first session fails to mount it.
*
* Health is what every consumer reads before offering a preset — the pickers
* drop a broken row rather than defer the discovery to a failed session
* start — so it covers the way an authored preset actually rots: a row naming
* a package that was renamed or uninstalled. Resolving those names is a
* separate pass from the shape check and stops short of importing anything,
* so a composition is judged without running a line of plugin code.
* @module @deepseek-ai/dsh-agent-presets/discovery
*/
/** The composition file that makes a directory a preset. */
const COMPOSITION_FILE = "agent.cordis.yml";
/**
* Harness-home directory holding locally authored presets.
*
* This package owns the writable root the way `dsh-skill-filesystem` owns
* `<dshHome>/skills`: where a person's own presets go is the same place in
* every deployment that does not say otherwise, so a launcher that forgets to
* configure one still finds them.
*
* Package-internal on purpose: no consumer outside this package addresses the
* directory by name, and a test that imported it could not catch this value
* being wrong — the expected segment is spelled out where it is asserted.
*/
const USER_PRESET_DIR = ".agent-presets";
/**
* The shipped presets, bundled inside this package: the roster's built-in
* compositions travel with the machinery that mounts them, the way each
* preset's own skills travel inside its directory. Resolved relative to this
* module so both launch layouts work — `src/` under tsx and the bundled
* `lib/` sit one level below the package root.
*/
const SHIPPED_PRESET_ROOT = fileURLToPath(new URL("../presets/", import.meta.url));
/**
* Why `rows` cannot be an entry list, or undefined when it can.
*
* A shallow shape check, deliberately short of the loader's work: it does not
* resolve plugin names or apply configs. What it catches is the hand-edit
* that produces a file the loader cannot even begin with — and it must accept
* everything the loader accepts, which is why rows are only required to be
* maps carrying a plugin `name` (groups recurse into their own lists).
*
* Shared with the composition inventory, whose file reads race edits against
* the health verdict and must judge the raced content by the same rule.
* @param rows - the parsed composition document.
* @param at - row-path prefix for nested diagnostics, empty at the top level.
* @returns one human-readable reason, or undefined when the shape holds.
*/
function entryListProblem(rows, at = "") {
	if (!Array.isArray(rows)) return at === "" ? "the composition must be a top-level list of plugin rows" : `group ${at} must hold a list of plugin rows`;
	for (const [index, row] of rows.entries()) {
		const label = at === "" ? `row ${String(index + 1)}` : `${at} row ${String(index + 1)}`;
		if (typeof row !== "object" || row === null || Array.isArray(row)) return `${label} is not a plugin row (expected a map with a "name")`;
		const { name, group, config } = row;
		if (typeof name !== "string" || name === "") return `${label} names no plugin (a "name" string is required)`;
		if (group === true) {
			const nested = entryListProblem(config, label);
			if (nested !== void 0) return nested;
		}
	}
}
/**
* Whether a package name is installed anywhere above `base`.
*
* Node's own upward `node_modules` walk, stopping at the package directory:
* the question is whether the package is there at all, which is what a row
* naming a package a rename or an uninstall took away gets wrong. A pnpm
* store link answers through the symlink, and a link left dangling by a
* deleted checkout answers false — the shape a stale profile install leaves.
*
* `existsSync` rather than the async `stat`: the walk is a handful of lookups
* per package and runs on every roster read, where 150 promise round-trips
* cost more than the lookups they wrap.
* @param name - the package specifier, possibly carrying a subpath.
* @param base - the URL to walk up from.
* @returns true when the package directory is installed above `base`.
*/
function packageInstalled(name, base) {
	const pkg = name.split("/").slice(0, name.startsWith("@") ? 2 : 1).join("/");
	let dir = fileURLToPath(base);
	for (;;) {
		if (existsSync(join(dir, "node_modules", pkg, "package.json"))) return true;
		const parent = dirname(dir);
		if (parent === dir) return false;
		dir = parent;
	}
}
/**
* Whether one classified row names a module that exists, importing nothing.
*
* Each kind is checked by what actually answers it. A package name is looked
* up on disk — the same upward walk Node's own resolver starts with — and a
* relative or `file:` specifier is statted, because both name one file.
* Nothing is evaluated either way, so a row is judged without its plugin
* observing that discovery looked.
*
* `import.meta.resolve` is deliberately not the fallback for a name the disk
* lookup misses. Its `parentURL` argument only takes effect under
* `--experimental-import-meta-resolve`, which no launch passes, so it would
* resolve from THIS module rather than from the harness — reporting a
* dependency visible only to this package as healthy, and a plugin the mount
* can import as broken. The resolver that does honour an explicit parent is
* the Loader's internal one, whose `resolveSync` signature differs between
* Node 22 and 24 (`ModuleLoader.fromInternal` tags the raw object rather than
* normalising it); reaching into that for a case the walk already covers buys
* nothing a supported deployment needs, because every plugin a preset names
* is installed beside the roster.
*
* What that gives up: a package resolvable ONLY through a loader hook — an
* import map, or a tree with no `node_modules` at all — is reported broken.
* No supported install produces one.
* @param row - the classified specifier, from {@link classifyRowSpecifier}.
* @param presetBase - directory URL a preset-relative specifier resolves against.
* @param harnessBase - base URL a package name resolves against.
* @returns true when the row names something that can be imported.
*/
async function rowResolves(row, presetBase, harnessBase) {
	if (row.kind === "builtin") return true;
	if (row.kind === "package") return isBuiltin(row.specifier) || packageInstalled(row.specifier, harnessBase);
	return await isFile(fileURLToPath(row.kind === "file" ? new URL(row.specifier) : new URL(row.specifier, presetBase)));
}
/**
* Rows whose module cannot be resolved.
*
* Only rows that will certainly be started are checked, and the test is the
* Loader's own: it starts a row when `Boolean(options.disabled)` is false, so
* `disabled: 0` names a row that DOES start and must be checked. A `!!js`
* expression is an object and therefore truthy, which skips exactly the rows
* whose value only the loader context can decide. Skipping those trades a
* missed name for the failure that matters more: calling a usable preset
* broken makes it unselectable and uncopyable, which is worse than reporting
* the same stale row at mount time as before.
*
* Shape is the caller's precondition: {@link entryListProblem} has already
* proven every row is a map carrying a `name` string, and groups recurse the
* same way it does.
* @param rows - the parsed composition rows.
* @param presetBase - directory URL a preset-relative specifier resolves against.
* @param harnessBase - base URL a package name resolves against.
* @param at - row-path prefix for nested diagnostics, empty at the top level.
* @returns one entry per unresolvable row, in composition order.
*/
async function unresolvableRows(rows, presetBase, harnessBase, at = "") {
	const found = [];
	for (const [index, entry] of rows.entries()) {
		const row = entry;
		if (Boolean(row.disabled)) continue;
		const positional = at === "" ? `row ${String(index + 1)}` : `${at} row ${String(index + 1)}`;
		if (row.group === true) {
			found.push(...await unresolvableRows(row.config, presetBase, harnessBase, positional));
			continue;
		}
		if (await rowResolves(classifyRowSpecifier(row.name), presetBase, harnessBase)) continue;
		const label = typeof row.id === "string" && row.id !== "" ? `row "${row.id}"` : positional;
		found.push({
			label,
			name: row.name
		});
	}
	return found;
}
/**
* Why the composition at `path` cannot mount, or undefined when it looks
* loadable. Parsed with the loader's own YAML dialect ({@link entryListSchema},
* the one carrying `!!js`), so health can never call a composition broken
* that the loader would accept.
* @param path - absolute path of the composition file.
* @param harnessBase - base URL a row's package name resolves against.
* @returns one human-readable reason, or undefined when the file is loadable.
*/
async function compositionProblem(path, harnessBase) {
	let content;
	try {
		content = await readFile(path, "utf8");
	} catch {
		return `the composition file ${COMPOSITION_FILE} cannot be read`;
	}
	let rows;
	try {
		rows = load(content, { schema: entryListSchema });
	} catch (error) {
		return `the composition is not valid YAML: ${(error instanceof Error ? error.message : String(error)).replace(/\n[\s\S]*$/, "")}`;
	}
	const shape = entryListProblem(rows);
	if (shape !== void 0) return shape;
	const presetBase = new URL(".", pathToFileURL(path)).href;
	const unresolvable = await unresolvableRows(rows, presetBase, harnessBase);
	const [first] = unresolvable;
	if (first === void 0) return void 0;
	if (unresolvable.length === 1) return `${first.label} names a plugin that cannot be resolved: ${first.name}`;
	return `${String(unresolvable.length)} rows name plugins that cannot be resolved:\n` + unresolvable.map((row) => `- ${row.label}: ${row.name}`).join("\n");
}
/**
* Whether `path` names an existing regular file.
* @param path - absolute path to test.
* @returns true when the path resolves to a file.
*/
async function isFile(path) {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}
/**
* Scan one root for preset directories.
*
* An absent root yields no presets rather than throwing: the user root does
* not exist until the first locally authored preset, and naming a default
* that no root supplies already fails loud at resolution.
*
* Every directory whose name is a usable preset id is a roster row — broken
* when its composition is missing or unloadable. A directory named outside
* {@link PRESET_ID} is skipped instead: no copy could ever claim that name,
* so it blocks nothing, and reporting `.DS_Store`-grade residue as broken
* presets would teach users to ignore the marker.
* @param root - the directory and the trust its presets inherit.
* @param harnessBase - base URL a row's package name resolves against; the
* caller's own `ctx.baseUrl`, which is where the installed harness lives.
* @returns the root's presets ordered by id.
*/
async function scanRoot(root, harnessBase) {
	const dir = resolve(expandHomePath(root.path));
	let children;
	try {
		children = await readdir(dir, { withFileTypes: true });
	} catch (error) {
		if (error.code === "ENOENT") return [];
		throw new Error(`agent-presets: cannot read preset root ${dir}: ${String(error)}`, { cause: error });
	}
	const found = [];
	for (const child of children) {
		if (!child.isDirectory() || !PRESET_ID.test(child.name)) continue;
		const directory = join(dir, child.name);
		const path = join(directory, COMPOSITION_FILE);
		const broken = await isFile(path) ? await compositionProblem(path, harnessBase) : `the composition file ${COMPOSITION_FILE} is missing — the directory still occupies the id; delete it or restore the file`;
		const metadata = await readPresetMetadata(directory);
		found.push({
			id: child.name,
			trust: root.trust,
			path,
			...metadata,
			...broken === void 0 ? {} : { broken }
		});
	}
	return found.sort((left, right) => {
		const byOrder = (left.order ?? Number.POSITIVE_INFINITY) - (right.order ?? Number.POSITIVE_INFINITY);
		return byOrder === 0 ? left.id.localeCompare(right.id) : byOrder;
	});
}
/**
* Scan every root in precedence order.
* @param roots - roots in precedence order; an earlier root wins a duplicate id.
* @param harnessBase - base URL a row's package name resolves against.
* @returns every discovered preset, first-root-wins per id.
*/
async function discoverPresets(roots, harnessBase) {
	const byId = /* @__PURE__ */ new Map();
	for (const root of roots) for (const preset of await scanRoot(root, harnessBase)) {
		if (byId.has(preset.id)) continue;
		byId.set(preset.id, preset);
	}
	return [...byId.values()];
}
//#endregion
//#region ../../../Core/util/atomic-write/src/index.ts
/**
* Zero-dependency atomic file replacement and writer coordination.
* `writeFileAtomic` writes a random-suffix sibling with exclusive create and
* the caller's permission bits, then renames it over the target, so readers
* observe either the old or the new complete content and a replaced file ends
* up with exactly the stated mode. `withFileLock` serializes cross-process
* writers of one file through a `wx`-created `<file>.lock` sibling, so a
* read-modify-write cycle can never resurrect a state another writer just
* replaced; readers stay lock-free because the rename commit is atomic.
* @module @deepseek-ai/dsh-atomic-write
*/
const WINDOWS_TRANSIENT_RENAME_ERRORS = new Set([
	"EACCES",
	"EBUSY",
	"EPERM"
]);
const WINDOWS_RENAME_RETRY_INITIAL_MS = 20;
const WINDOWS_RENAME_RETRY_MAX_MS = 200;
const WINDOWS_RENAME_RETRY_LIMIT = 8;
/** Whether Windows reported temporary interference with an atomic replacement. */
function isTransientWindowsRenameError(error) {
	if (process.platform !== "win32") return false;
	return WINDOWS_TRANSIENT_RENAME_ERRORS.has(error?.code ?? "");
}
/** Replace the target after bounded retries for transient Windows interference. */
async function renameAtomicTemp(temp, filename) {
	let delay = WINDOWS_RENAME_RETRY_INITIAL_MS;
	for (let retries = 0;; retries += 1) {
		try {
			await rename(temp, filename);
			return;
		} catch (error) {
			if (!isTransientWindowsRenameError(error)) throw error;
			if (retries >= WINDOWS_RENAME_RETRY_LIMIT) throw error;
		}
		await new Promise((resolve) => setTimeout(resolve, delay));
		delay = Math.min(delay * 2, WINDOWS_RENAME_RETRY_MAX_MS);
	}
}
/**
* Replace `filename` with `content` in one atomic step, creating parent
* directories. The content is first written to a random-suffix sibling opened
* with exclusive create (`wx`): the open refuses to follow a symlink planted
* at the temp path, and the fresh inode carries `options.mode` through the
* rename, so replacing a wider-permission file narrows it without a chmod
* race. The rename also replaces a symlinked target itself instead of writing
* through to its referent, and the same-directory sibling keeps the rename on
* one filesystem. Windows replacement retries transient `EACCES`, `EBUSY`,
* and `EPERM` failures for a bounded interval while the complete temp file
* remains the rename source. On any remaining failure the temp file is
* removed and the failure rethrown. Crash durability (fsync) is out of scope.
* @param filename - final path receiving the content.
* @param content - complete next file content.
* @param options - permission bits for the replacement inode.
*/
async function writeFileAtomic(filename, content, options) {
	await mkdir(dirname(filename), {
		recursive: true,
		...options.dirMode === void 0 ? {} : { mode: options.dirMode }
	});
	const temp = `${filename}.${randomBytes(6).toString("hex")}.tmp`;
	try {
		await writeFile(temp, content, {
			mode: options.mode,
			flag: "wx"
		});
		await renameAtomicTemp(temp, filename);
	} catch (error) {
		await rm(temp, { force: true });
		throw error;
	}
}
//#endregion
//#region ../../preset/agent-presets/src/authoring.ts
/**
* Copying, reading, and deleting locally authored presets.
*
* Authoring is confined to a `user` root: the shipped `.system` set is part of
* the deployment, and letting a browser rewrite it would turn "reset to a known
* preset" into something the same caller could have broken first.
*
* The only authoring write is a whole-directory copy of an existing preset.
* No caller supplies composition text: the inputs are ids the host resolves
* against its own roots plus an optional display name, so authoring grants no
* capability the copied preset did not already carry.
* @module @deepseek-ai/dsh-agent-presets/authoring
*/
/**
* Refuse one authoring request the deployment does not allow.
* @param presetId - what the caller tried to change, for the diagnostic.
* @param reason - why authoring is refused.
* @returns the failure to throw.
*/
function notWritable(presetId, reason) {
	return new RemoteError("agent-preset/read-only", `agent-presets: preset "${presetId}" cannot be written: ${reason}`, {
		agentPreset: presetId,
		reason
	});
}
/**
* Refuse a copy onto an id something already occupies. Both the roster check
* and the on-disk check answer with it, so a taken id reads the same either way.
* @param presetId - the id that is already taken.
* @returns the failure to throw.
*/
function presetExists(presetId) {
	const reason = `preset "${presetId}" already exists — a copy never overwrites; delete the existing preset first or choose another id`;
	return new RemoteError("agent-preset/invalid", `agent-presets: ${reason}`, {
		agentPreset: presetId,
		reason
	});
}
/**
* The root locally authored presets are written to.
* @param roots - the configured roots in precedence order.
* @param presetId - the preset the caller is authoring, named by the refusal.
* @returns the absolute path of the first `user` root.
* @throws when the deployment configured no writable root.
*/
function writableRoot(roots, presetId) {
	const root = roots.find((candidate) => candidate.trust === "user");
	if (root === void 0) throw notWritable(presetId, "this deployment configures no user-writable preset root");
	return resolve(expandHomePath(root.path));
}
/**
* Read one preset's composition text.
* @param preset - the resolved preset.
* @returns the file's contents.
*/
async function readComposition(preset) {
	return await readFile(preset.path, "utf8");
}
/** Whether anything occupies the path (cp's own errorOnExist backstops races). */
async function occupied(path) {
	let present = true;
	try {
		await stat(path);
	} catch {
		present = false;
	}
	return present;
}
/**
* Re-tighten a copied tree to owner-only. A shipped preset is world-readable
* in its install and `cp` preserves that; the copy carries the same weight as
* the settings document beside it, so group/other access is stripped. A
* file's owner-execute bit survives — a preset may ship runnable helpers.
*/
async function tightenModes(dir) {
	await chmod(dir, 448);
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const target = join(dir, entry.name);
		if (entry.isDirectory()) await tightenModes(target);
		else
 /* v8 ignore next -- Windows exposes no POSIX owner-execute bit; the POSIX lane covers both file modes. */
		await chmod(target, ((await stat(target)).mode & 64) === 0 ? 384 : 448);
	}
}
/**
* Create a preset by copying an existing one's whole directory.
*
* The copy carries everything the source directory holds — composition,
* metadata, skill directories, assets — because a preset is its directory,
* not one file. Symlinks are dereferenced so the copy is self-contained
* rather than a set of links back into the install it was copied from.
*
* The copied metadata is then rewritten: the source's description is kept
* (the file is the author's to edit afterwards), but its name and roster
* `order` are not — a copy presenting itself identically to its source, or
* sorted into the shipped set's declared order, would make the roster stop
* distinguishing them. With no name given and no description to keep, the
* file is removed so the copy publishes nothing rather than a blank.
* @param roots - the configured roots; the first `user` one receives the copy.
* @param source - the resolved preset the copy starts from.
* @param id - the new preset's id, which becomes its directory name.
* @param name - display name for the copy; omitted falls back to the id.
* @returns the absolute path of the new preset directory.
* @throws when the id is unusable or already occupied on disk, or the
* deployment configures no writable root.
*/
async function copyComposition(roots, source, id, name) {
	if (!PRESET_ID.test(id)) {
		const reason = `preset id ${JSON.stringify(id)} must match ${String(PRESET_ID)} — the id is a directory name, so anything else could escape the preset root`;
		throw new RemoteError("agent-preset/invalid", `agent-presets: ${reason}`, {
			agentPreset: id,
			reason
		});
	}
	const dir = join(writableRoot(roots, id), id);
	if (await occupied(dir)) throw presetExists(id);
	try {
		await cp(dirname(source.path), dir, {
			recursive: true,
			dereference: true,
			force: false,
			errorOnExist: true
		});
		await tightenModes(dir);
		const rendered = renderPresetMetadata({
			...name === void 0 ? {} : { name },
			...source.description === void 0 ? {} : { description: source.description }
		});
		const metadataPath = join(dir, METADATA_FILE);
		if (rendered === void 0) await rm(metadataPath, { force: true });
		else await writeFileAtomic(metadataPath, rendered, {
			mode: 384,
			dirMode: 448
		});
	} catch (error) {
		await rm(dir, {
			recursive: true,
			force: true
		});
		throw error;
	}
	return dir;
}
/**
* Delete a locally authored preset.
*
* A shipped preset is refused: it belongs to the deployment. A preset a live
* session mounted is NOT refused — the composition was read at creation and is
* never re-read, so that session keeps running exactly as it was.
* @param roots - the configured roots.
* @param preset - the resolved preset to remove.
* @throws when the preset ships with the deployment or lies outside the writable root.
*/
async function deleteComposition(roots, preset) {
	if (preset.trust !== "user") throw notWritable(preset.id, "it ships with the deployment");
	const dir = join(writableRoot(roots, preset.id), preset.id);
	if (!isAbsolute(preset.path) || !preset.path.startsWith(dir)) throw notWritable(preset.id, "it does not live under the writable preset root");
	await rm(dir, {
		recursive: true,
		force: true
	});
}
//#endregion
//#region ../../preset/agent-presets/src/mount.ts
/**
* Mount one preset composition under an agent's scope context, then prove the
* result is usable before the agent is published.
*
* The scope context is what makes the composition per-session: entry contexts
* chain to the context the subtree was plugged into, so every `ctx.tools`
* and `ctx.systemPrompt` registration inside the preset files into that
* agent's layer and unwinds with it. Two guards make that safe. A row that
* never reached a usable state is rejected, because a directly-plugged subtree
* is absent from `ctx.loader.entries()` and no boot audit covers it. A row that
* published a service into the ROOT realm is rejected, because such a service
* is process-global rather than per-session and the second session mounting the
* same preset collides with the first.
* @module @deepseek-ai/dsh-agent-presets/mount
*/
/**
* Subtrees captured by config identity. A subtree plugged directly (rather than
* created as a loader entry) never links itself to an `Entry`, so this is the
* only handle to the rows it created; config objects are minted per mount, so
* concurrent mounts cannot collide.
*/
const mounted = /* @__PURE__ */ new WeakMap();
/**
* The base URL bare specifiers resolve against, per pending mount, keyed by the
* same config object. Recorded before the subtree is plugged, because `Include`
* rewrites its own context's `baseUrl` to the composition's directory and the
* pre-mount value is the only handle on where the harness itself lives.
*/
const harnessBase = /* @__PURE__ */ new WeakMap();
/**
* Include subclass that publishes its tree and fiber for the audit, and never
* writes to the file it read.
*/
var PresetTree = class extends Include {
	constructor(ctx, config) {
		super(ctx, config);
		const owner = this.ctx.fiber.entry;
		if (owner?.subtree === this) delete owner.subtree;
		mounted.set(config, {
			tree: this,
			fiber: ctx.fiber
		});
	}
	/**
	* Resolve a bare specifier from the harness rather than from the preset.
	*
	* `EntryTree.import()` resolves against the tree's own `baseUrl`, which
	* `Include` sets to the composition's directory. That is right for a
	* relative specifier — a preset's own files travel with it — and wrong for
	* a package name: a locally authored preset lives under the user's home,
	* where Node's upward `node_modules` walk never reaches the harness's own
	* dependencies, so every `@deepseek-ai/dsh-*` row would fail to import. The
	* mount records the host composition's base instead, which is inside the
	* installed harness, and bare names resolve from there. An absolute
	* filesystem path names neither base and becomes a file URL before Node's
	* ESM loader receives it, which is required for drive-letter paths on
	* Windows.
	*
	* {@link classifyRowSpecifier} makes that split, so discovery's health check
	* resolves every row from the same base this import uses.
	* @param name - the module specifier from the row.
	* @param getOuterStack - the loader's stack composer for import diagnostics.
	* @returns the imported module, or the `cordis:` builtin.
	*/
	import(name, getOuterStack) {
		const row = classifyRowSpecifier(name);
		const base = harnessBase.get(this.config);
		/* v8 ignore next -- every PresetTree is constructed by `mountPreset`, which records the base first */
		if (base === void 0) return super.import(row.specifier, getOuterStack);
		if (row.kind === "builtin" || row.kind === "preset") return super.import(row.specifier, getOuterStack);
		const internal = this.ctx.loader.internal;
		/* v8 ignore next -- Node always supplies the internal module loader; the branch keeps a
		hypothetical embedder from losing the row's name in a resolution error. */
		if (internal === void 0) return super.import(row.specifier, getOuterStack);
		return internal.import(row.specifier, base, {});
	}
	/**
	* A preset is an input, never a persistence target.
	*
	* The Loader writes a tree back through this method whenever it decides the
	* config changed — a plugin self-disposing is enough, and tearing an agent
	* down disposes its whole subtree. Inherited, that rewrites the preset file
	* with whatever the dying tree held, which in practice means truncating a
	* shipped composition to `[]` the first time a session ends. Persisting a
	* preset is also meaningless: nothing here is user state, and the same file
	* backs every session that names it.
	*
	* Dropping the write drops the `loader/config-update` the inherited method
	* emits with it. No consumer observes one for a preset subtree, and a
	* future "edit your preset while it runs" flow needs a deliberate
	* persistence path rather than this method's return.
	*/
	write() {}
};
const mounts = /* @__PURE__ */ new Set();
/**
* Drop every record whose subtree is gone.
*
* Records are pruned by observation rather than through a disposal hook
* because a subtree can be torn down by its owning agent, by a failed mount, or
* by the whole tree unloading, and a cleared `uid` is what all three share.
*
* Pruning therefore has to happen on a path this module owns. Reading is one
* such path, but not a reliable one: the only production reader is the
* invariant companion's service listener, and `dsh-invariants` is a
* development composition — a shipped host never loads it. Mounting is the
* other, and it is the one every session takes, which bounds the set at one
* generation of dead records rather than one per session ever composed. Each
* record would otherwise retain its whole disposed subtree: the fiber holds
* its config, and that config is the key its `EntryTree` is stored under.
*/
function pruneDisposedMounts() {
	for (const mount of mounts) if (mount.fiber.uid === null) mounts.delete(mount);
}
/**
* Every preset composition still installed, pruning fibers disposed since the
* last read.
*
* The record set is module state and therefore spans every Cordis runtime in
* the process; a reader that serves one runtime passes that runtime's root
* fiber so another runtime mounting the same preset id (a second embedded
* app, a test's second harness) never answers for it.
* @param within - when present, only mounts inside this fiber's subtree.
* @returns the live mounts.
*/
function livePresetMounts(within) {
	pruneDisposedMounts();
	const all = [...mounts];
	return within === void 0 ? all : all.filter((mount) => withinFiber(mount.fiber, within));
}
/**
* Whether `fiber` is `root` itself or is mounted anywhere inside its subtree.
*
* Membership is object identity. `uid` looks like a cheaper key but is a
* per-registry counter, so fibers in two different roots collide on it and a
* subtree in one runtime would be blamed for a service published in another.
* @param fiber - the fiber to locate.
* @param root - the subtree root to test membership against.
* @returns true when `fiber` belongs to `root`'s subtree.
*/
function withinFiber(fiber, root) {
	let current = fiber;
	while (true) {
		if (current === root) return true;
		const parent = current.parent.fiber;
		if (parent === current) return false;
		current = parent;
	}
}
/**
* Service names the mounted subtree published into the root realm.
*
* A provider without an `isolate` realm stores its implementation under the
* root's symbol for that name, which is exactly the comparison below; a
* provider inside an `isolate` realm stores under a realm-private symbol and
* is correctly absent here.
* @param ctx - any context of the runtime whose service store is inspected.
* @param mount - the mounted subtree's fiber.
* @returns the leaked service names in lexical order.
*/
function leakedServices(ctx, mount) {
	const store = ctx.reflect.store;
	const rootIsolate = ctx.root[Context.isolate];
	const leaked = [];
	for (const key of Object.getOwnPropertySymbols(store)) {
		const impl = store[key];
		/* v8 ignore next -- cordis deletes a store slot on disposal rather than
		clearing it, so an own symbol always resolves; the guard exists only
		because the store's index signature is optional. */
		if (impl === void 0) continue;
		if (!withinFiber(impl.fiber, mount)) continue;
		if (rootIsolate[impl.name] === key) leaked.push(impl.name);
	}
	return leaked.sort((left, right) => left.localeCompare(right));
}
/**
* The standing composition one agent is joined to.
*
* The agent's own key is parented to its preset's standing key, so the mount
* is found by matching that parent rather than by walking up from the agent —
* the mount is not under the agent's fiber. An agent that joined no preset —
* a deployment composing no roster, or a child agent before its join — has no
* parent link and resolves to undefined.
* @param agentCtx - the agent's scope context.
* @returns the mount the agent joined, or undefined when it joined none.
*/
function standingMountFor(agentCtx) {
	const agentKey = scopeOf(agentCtx);
	if (agentKey === void 0) return void 0;
	const standingKey = scopeParentOf(agentKey);
	if (standingKey === void 0) return void 0;
	return livePresetMounts().find((candidate) => candidate.key === standingKey);
}
/**
* One agent's instance of a service its preset mounted.
*
* A preset publishes a service behind an `isolate` realm so two sessions
* cannot collide, and an entry-local realm is invisible to everything outside
* the group — including the agent's own scope context and the host. That is
* right for the rows inside the group and wrong for one caller: a request that
* is ABOUT a session but arrives from outside it, which is every browser RPC
* the api-proxy serves.
*
* Ownership is the same relation {@link leakedServices} reads, inverted: there
* it names implementations a subtree published into the ROOT realm, here it
* names the one this subtree published anywhere. Fiber membership is object
* identity for the reason stated on {@link withinFiber}.
*
* This is READ addressing for a caller that already holds the agent. It is not
* a general host handle on a session's internals: a host row that `inject`s a
* service cannot use it, because injection resolves before any session exists
* and has no agent to key by — such a service belongs on the host plane.
* @param ctx - any context of the runtime whose service store is inspected.
* @param agent - the agent whose mounted composition to look inside.
* @param name - the service name as the preset's rows resolve it.
* @returns the agent's instance, or undefined when its preset mounts none.
*/
function serviceForAgent(ctx, agent, name) {
	const mount = standingMountFor(agent.ctx);
	if (mount === void 0) return void 0;
	const store = ctx.reflect.store;
	for (const key of Object.getOwnPropertySymbols(store)) {
		const impl = store[key];
		/* v8 ignore next -- cordis deletes a store slot on disposal rather than clearing it */
		if (impl === void 0) continue;
		if (impl.name !== name) continue;
		if (withinFiber(impl.fiber, mount.fiber)) return impl.value;
	}
}
/**
* Rows that did not reach a usable state, each rendered as one diagnostic line.
*
* A row whose module failed to import or whose plugin threw already rejects the
* mount through the loader; what remains observable here is a row still waiting
* for a service the composition never supplies.
* @param tree - the mounted subtree.
* @returns one line per unusable row, empty when every enabled row is usable.
*/
function inactiveRows(tree) {
	const lines = [];
	for (const entry of tree.entries()) {
		if (entry.disabled) continue;
		const fiber = entry.fiber;
		/* v8 ignore next 4 -- the loader rejects an entry whose module or plugin failed,
		so a settled tree never holds an enabled fiber-less entry; the branch exists
		only because `Entry.fiber` is declared optional. */
		if (fiber === void 0) {
			lines.push(`${entry.options.id} (${entry.options.name}): never started`);
			continue;
		}
		const missing = Object.keys(fiber.inject).filter((name) => fiber.ctx.get(name) === void 0);
		if (missing.length > 0) lines.push(`${entry.options.id} (${entry.options.name}): waiting for ${missing.join(", ")}`);
	}
	return lines;
}
/**
* The causes of `error` whose detail its own message does not already carry.
*
* `AggregateError` names none of its causes in its own message, so its
* `errors` are the branches. The Loader's per-row wrapper takes the opposite
* approach: it appends `cause.message` to the message it builds and keeps the
* cause only as `error.cause`, so following a plain chain would print every
* line twice. That leaves exactly one lossy shape — a wrapped row whose cause
* is an `AggregateError`. Its message ends with the aggregate's own line and
* drops the `errors` behind it, which is how a failed group reports as
* "loader entries failed to apply" and names none of the rows that failed.
* @param error - the failure to read branches from.
* @returns the branches to render beneath `error.message`, possibly empty.
*/
function detailBranches(error) {
	if (error instanceof AggregateError) return error.errors;
	return error.cause instanceof AggregateError ? error.cause.errors : [];
}
/**
* The reportable text of a mount failure.
*
* The loader reports several failed rows as one `AggregateError`, whose own
* message names none of them; without flattening, a composition that fails on
* two rows says only "loader entries failed to apply" and the operator has
* nothing to act on. Nested groups indent under the row that owns them, so a
* composition failing inside a group still names the rows rather than the
* group alone.
* @param error - the value the mount rejected with.
* @returns a single-line-per-cause description.
*/
function mountDetail(error) {
	/* v8 ignore next -- every path into the mount's catch throws an Error: the loader
	wraps a row's thrown value before it propagates, and this module's own
	rejections are Errors. The fallback keeps a hostile value readable. */
	if (!(error instanceof Error)) return String(error);
	const branches = detailBranches(error);
	if (branches.length === 0) return error.message;
	return [error.message, ...branches.map((branch) => `- ${mountDetail(branch).replaceAll("\n", "\n  ")}`)].join("\n");
}
/**
* Mount `preset` under `agentCtx` and return only once every row is usable.
*
* The subtree is owned by `agentCtx`'s fiber, so it unwinds with the agent and
* the caller receives no disposer. A rejection leaves nothing mounted.
* @param agentCtx - the agent's scope context, from the agent factory's `setup`.
* @param preset - the resolved preset to compose the agent from.
* @throws when `agentCtx` carries no scope, a row is unusable, or a row
* published a service into the root realm.
*/
async function mountPreset(agentCtx, preset) {
	if (scopeOf(agentCtx) === void 0) throw new Error(`agent-presets: refusing to mount preset "${preset.id}" into an unscoped context; its registrations would apply to every agent in the process`);
	const config = { path: pathToFileURL(preset.path).href };
	/* v8 ignore next -- the Loader sets `baseUrl` on the root before any scoped context derives from it */
	if (agentCtx.baseUrl !== void 0) harnessBase.set(config, agentCtx.baseUrl);
	pruneDisposedMounts();
	const handle = agentCtx.plugin(PresetTree, config);
	try {
		await handle.await();
		const subtree = mounted.get(config);
		/* v8 ignore next -- the subclass constructor runs before `await()` settles for every mounted tree */
		if (subtree === void 0) throw new Error("mounted subtree did not publish its entry tree");
		const { tree, fiber } = subtree;
		const unusable = inactiveRows(tree);
		if (unusable.length > 0) throw new Error(`${String(unusable.length)} row(s) did not activate:\n${unusable.join("\n")}`);
		const leaked = leakedServices(agentCtx, fiber);
		if (leaked.length > 0) throw new Error(`row(s) published process-global service(s) [${leaked.join(", ")}]; a preset service must sit behind an \`isolate\` realm or move to the host composition`);
		mounts.add({
			presetId: preset.id,
			fiber,
			tree,
			key: scopeOf(agentCtx)
		});
	} catch (error) {
		try {
			await handle.dispose();
		} catch {}
		const reason = `${mountDetail(error)} (${preset.path})`;
		throw new RemoteError("agent-preset/invalid", `agent-presets: preset "${preset.id}" failed to mount: ${reason}`, {
			agentPreset: preset.id,
			reason
		}, { cause: error });
	}
}
//#endregion
//#region ../../preset/agent-presets/src/composition-inventory.ts
/**
* Structured composition reads for plugin-listing surfaces: the plugin rows
* each preset names, with each row's effective enablement. A preset with a
* live standing mount answers from that mount's Loader entries — evaluated
* `disabled`, real root-fiber states; a preset no session has composed since
* boot answers from its composition file, with `!!js` disabled expressions
* evaluated through the caller-supplied Loader evaluator so the file answer
* matches the decision a mount on this host would make. A row whose
* expression the evaluator refuses stays `'conditional'`.
* @module @deepseek-ai/dsh-agent-presets/composition-inventory
*/
/**
* One `disabled` node's contribution to effective enablement, mirroring the
* Loader's own reading: a `!!js` expression is asked of the evaluator — a
* refusal (throw) leaves the decision to a mount — and anything else disables
* exactly when `Boolean(value)` does.
* @param value - the raw `disabled` node of one composition row.
* @param evaluateExpression - the Loader-context evaluator for `!!js` nodes.
* @returns true (disabled), false (enabled), or `'conditional'`.
*/
function disabledContribution(value, evaluateExpression) {
	if (isJsExpr(value)) try {
		return Boolean(evaluateExpression(value.__jsExpr));
	} catch {
		return "conditional";
	}
	return Boolean(value);
}
/**
* Combine an ancestor group's disabled state with a row's own, the way the
* Loader walks owning groups: any literal true disables, otherwise any
* expression leaves the decision to a mount.
* @param outer - the combined ancestor contribution.
* @param own - this row's contribution.
* @returns the row's effective disabled state.
*/
function combineDisabled(outer, own) {
	if (outer === true || own === true) return true;
	if (outer === "conditional" || own === "conditional") return "conditional";
	return false;
}
/**
* Flatten one parsed row list into plugin rows. Group rows are structural —
* the Loader reports a group entry as always enabled and lets children
* inherit its `disabled` — so only their children are emitted.
* @param rows - the parsed rows, shape-checked by the caller.
* @param outerDisabled - the combined ancestor-group disabled state.
* @param evaluateExpression - the Loader-context evaluator for `!!js` nodes.
* @param found - the accumulator receiving flattened rows.
*/
function flattenRows(rows, outerDisabled, evaluateExpression, found) {
	for (const value of rows) {
		const row = value;
		const disabled = combineDisabled(outerDisabled, disabledContribution(row.disabled, evaluateExpression));
		if (row.group === true) {
			flattenRows(row.config, disabled, evaluateExpression, found);
			continue;
		}
		found.push({
			entryId: typeof row.id === "string" && row.id !== "" ? row.id : null,
			moduleName: row.name,
			enabled: disabled === true ? false : disabled === "conditional" ? "conditional" : true,
			...isJsExpr(row.disabled) ? { condition: row.disabled.__jsExpr } : {}
		});
	}
}
/**
* Plugin rows of one composition file, for a preset with no live mount.
*
* Parsed with the Loader's own dialect ({@link entryListSchema}), so the rows
* reported are the rows a mount would start from. A file that stopped reading
* as a composition — discovery judged the preset healthy moments earlier, so
* only an edit racing this read gets here — answers as broken with the raced
* reason rather than dropping the rows silently.
* @param path - absolute path of the composition file.
* @param evaluateExpression - the Loader-context evaluator for `!!js` nodes.
* @returns flattened rows in composition order, or why they cannot be read.
*/
async function fileComposition(path, evaluateExpression) {
	let rows;
	try {
		rows = load(await readFile(path, "utf8"), { schema: entryListSchema });
	} catch (error) {
		/* v8 ignore next -- fs and js-yaml throw Errors for every failure here; the fallback keeps a hostile value readable */
		return { broken: error instanceof Error ? error.message : String(error) };
	}
	const problem = entryListProblem(rows);
	if (problem !== void 0) return { broken: problem };
	const found = [];
	flattenRows(rows, false, evaluateExpression, found);
	return { rows: found };
}
/**
* Plugin rows of one live standing composition, in Loader-entry order.
* @param tree - the standing mount's entry tree.
* @returns rows with the Loader's evaluated enablement and root-fiber states.
*/
function mountedCompositionRows(tree) {
	const found = [];
	for (const entry of tree.entries()) {
		if (entry.options.group) continue;
		found.push({
			entryId: entry.id,
			moduleName: entry.options.name,
			enabled: !entry.disabled,
			...isJsExpr(entry.options.disabled) ? { condition: entry.options.disabled.__jsExpr } : {},
			...entry.fiber === void 0 ? {} : { fiberState: entry.fiber.state }
		});
	}
	return found;
}
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
function jsonStringifyReplacer(_, value) {
	if (typeof value === "bigint") return value.toString();
	return value;
}
function nullish(input) {
	return input === null || input === void 0;
}
function cleanRegex(source) {
	const start = source.startsWith("^") ? 1 : 0;
	const end = source.endsWith("$") ? source.length - 1 : source.length;
	return source.slice(start, end);
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
function mergeDefs(...defs) {
	const mergedDescriptors = {};
	for (const def of defs) Object.assign(mergedDescriptors, Object.getOwnPropertyDescriptors(def));
	return Object.defineProperties({}, mergedDescriptors);
}
function slugify(input) {
	return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
const captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
function isObject(data) {
	return typeof data === "object" && data !== null && !Array.isArray(data);
}
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
Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, -Number.MAX_VALUE, Number.MAX_VALUE;
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
const _null$2 = /^null$/i;
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
//#region ../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/versions.js
const version = {
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
	inst._zod.version = version;
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
const $ZodNull = /*@__PURE__*/ $constructor("$ZodNull", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = _null$2;
	inst._zod.values = new Set([null]);
	inst._zod.parse = (payload, _ctx) => {
		const input = payload.value;
		if (input === null) return payload;
		payload.issues.push({
			expected: "null",
			code: "invalid_type",
			input,
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
function _null$1(Class, params) {
	return new Class({
		type: "null",
		...normalizeParams(params)
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
const nullProcessor = (_schema, ctx, json, _params) => {
	if (ctx.target === "openapi-3.0") {
		json.type = "string";
		json.nullable = true;
		json.enum = [null];
	} else json.type = "null";
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
const parse$1 = /* @__PURE__ */ _parse(ZodRealError);
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
	inst.parse = (data, params) => parse$1(inst, data, params, { callee: inst.parse });
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
const ZodNull = /*@__PURE__*/ $constructor("ZodNull", (inst, def) => {
	$ZodNull.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => nullProcessor(inst, ctx, json, params);
});
function _null(params) {
	return /* @__PURE__ */ _null$1(ZodNull, params);
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
//#region ../../preset/agent-presets/src/session.ts
const agentPresetSchema = union([string(), _null()]);
/** Current Session preset, initialized from its header and advanced by selection events. */
const agentPresetProjectionDefinition = {
	key: "agentPreset",
	stateSchema: agentPresetSchema,
	init: (header) => header.agentPreset ?? null,
	apply: (state, event) => event.type === "agent-preset/selected" ? event.data.agentPreset : state,
	wire: {
		viewSchema: agentPresetSchema,
		view: (state) => state
	},
	stateVersion: 1
};
//#endregion
//#region ../../preset/agent-presets/src/index.ts
/**
* Agent presets: each session composes its model-facing plugin set from one
* preset `cordis.yml`, mounted ONCE per preset under a standing scope and
* joined by every agent that names it.
*
* The standing mount is what makes a preset one composition rather than one
* per session: its plugin instances, tool registrations, prompt sections, and
* projection units exist exactly once, keyed per session inside the plugins
* themselves (they predate presets and were written for a shared world). An
* agent joins by having its scope key parented to the mount's
* ({@link bindScopeParent}), which makes the mount's registrations visible to
* that agent's views and the mount's listeners receive that agent's events —
* and a host reader with no agent at all (a cold transcript read) resolves
* the same standing registrations by preset id.
*
* This package owns the preset vocabulary, filesystem discovery, and the
* guarded standing mount. It does not decide when an agent is created — the
* agent factory's `setup(agentCtx)` hook is the one supported call site,
* because only there is the join installed while the agent is still
* unpublished, so a rejected composition rolls the whole creation back.
* @module @deepseek-ai/dsh-agent-presets
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
/** Settings namespace carrying the user's preset-picker preference and chosen default. */
const SETTINGS_NAMESPACE = "agent-presets";
/** Refuse an empty preset id before invoking a domain operation. */
function validatePresetId(value, field) {
	if (value.length === 0) throw new RemoteError("gateway/bad-request", `${field} must be a non-empty string`, {});
}
Schema$1.object({
	default: Schema$1.string(),
	modeSelectionEnabled: Schema$1.boolean()
});
(() => {
	let _classSuper = TypertRemoteService;
	let _instanceExtraInitializers = [];
	let _remoteExportList_decorators;
	let _readDocument_decorators;
	let _remoteExportCopy_decorators;
	let _remoteExportDelete_decorators;
	let _select_decorators;
	return class AgentPresets extends _classSuper {
		static {
			const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
			_remoteExportList_decorators = [Remote("list")];
			_readDocument_decorators = [Remote("read")];
			_remoteExportCopy_decorators = [Remote("copy")];
			_remoteExportDelete_decorators = [Remote("deletePreset")];
			_select_decorators = [Remote("select")];
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
			__esDecorate(this, null, _readDocument_decorators, {
				kind: "method",
				name: "readDocument",
				static: false,
				private: false,
				access: {
					has: (obj) => "readDocument" in obj,
					get: (obj) => obj.readDocument
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteExportCopy_decorators, {
				kind: "method",
				name: "remoteExportCopy",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteExportCopy" in obj,
					get: (obj) => obj.remoteExportCopy
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteExportDelete_decorators, {
				kind: "method",
				name: "remoteExportDelete",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteExportDelete" in obj,
					get: (obj) => obj.remoteExportDelete
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _select_decorators, {
				kind: "method",
				name: "select",
				static: false,
				private: false,
				access: {
					has: (obj) => "select" in obj,
					get: (obj) => obj.select
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
		config = __runInitializers(this, _instanceExtraInitializers);
		static inject = ["loader", "sessionProjections"];
		/** Runtime schema for the preset roster. */
		static Config = Schema$1.object({
			default: Schema$1.string().required(),
			roots: Schema$1.array(Schema$1.object({
				path: Schema$1.string().required(),
				trust: Schema$1.union(["system", "user"]).default("user")
			})).default([]),
			includeShippedRoot: Schema$1.boolean().default(true),
			includeUserRoot: Schema$1.boolean().default(true)
		});
		/**
		* The roots discovery and authoring actually scan: the package's shipped
		* root unless `includeShippedRoot` is false, then every configured root in
		* order, then the harness-home user root unless `includeUserRoot` is false.
		*
		* Derived once, because a root set that changed between `list()` and the
		* `copy()` acting on its answer would author into a directory the caller
		* never saw. The shipped root comes FIRST and the user root LAST because an
		* earlier root wins a duplicate id: a shipped preset shadows any directory
		* that claimed its name, and a configured root still shadows a locally
		* authored one.
		*/
		resolvedRoots;
		/**
		* Where a row's package name resolves from: the base URL of the composition
		* this roster was loaded by, which is inside the installed harness.
		*
		* Discovery needs it because a preset's own directory is the wrong base for
		* a package name — a locally authored preset lives under the user's home,
		* where Node's upward `node_modules` walk never reaches the harness's
		* dependencies. The mount already resolves rows this way; holding the same
		* base here is what lets health answer the question before a session does.
		*/
		harnessBase;
		/**
		* The user layer over `config.default`, present only while a settings
		* provider is composed. Held rather than snapshotted so a hot-reloaded
		* document takes effect without a restart.
		*/
		settings;
		/**
		* The settings service behind {@link settings}, held for the one write this
		* service makes: clearing a user default it has just deleted.
		*/
		settingsService;
		/**
		* The service's own untraced context. Methods invoked through the traceable
		* proxy see `this.ctx` rebound to the CALLER's context, which carries a
		* shadow; a subtree minted from it resolves every service through that
		* shadow's fiber instead of each entry's own inject store, so preset rows
		* would fail on the very services they declare. Standing mounts must hang
		* off the untraced original (the `jobs-local` selfCtx precedent).
		*/
		selfCtx;
		constructor(ctx, config) {
			super(ctx, "agentPresets");
			this.config = config;
			this.selfCtx = ctx;
			retainSettingsOwner(this, ctx, { bind: (scope, service) => {
				this.settings = scope;
				this.settingsService = service;
			} });
			const { baseUrl } = ctx;
			if (baseUrl === void 0) throw new Error("agent-presets: the roster needs `ctx.baseUrl` to resolve the plugins a composition names; compose it under a Loader, or set the base on the context this plugin is applied to");
			this.harnessBase = baseUrl;
			this.resolvedRoots = [
				...config.includeShippedRoot ? [{
					path: SHIPPED_PRESET_ROOT,
					trust: "system"
				}] : [],
				...config.roots,
				...config.includeUserRoot ? [{
					path: dshHomePath(USER_PRESET_DIR),
					trust: "user"
				}] : []
			];
			ctx.sessionProjections.register(agentPresetProjectionDefinition);
			ctx.on("agent/created", ({ agent }) => {
				if (this.resolvedRoots.length === 0) return;
				if (this.composedPreset(agent.ctx) !== void 0) return;
				ctx.logger.warn(`agent "${agent.id}" was published without joining an agent preset; its tools, prompt sections, and skill catalog resolve against the empty global layer (join through AgentPresets.mount() or composeFrom() in the agent factory setup)`);
			});
			ctx.on("session/event", (session, event) => {
				if (event.type !== "agent-preset/selected") return;
				ctx.emit("agent-preset/selected", session.id, event.data.agentPreset);
			});
		}
		/**
		* The preset id mounted when a caller names none.
		*
		* Read per call rather than cached: the settings document is hot-reloaded, so
		* changing the default takes effect on the next session created and leaves
		* every running session on the preset it was composed from.
		*/
		get defaultId() {
			return this.selectionPolicy().defaultId;
		}
		/** Read one internally consistent snapshot of the selection policy. */
		selectionPolicy() {
			const settings = this.settings?.get();
			if (settings === void 0) return {
				enabled: true,
				defaultId: this.config.default
			};
			const enabled = settings.modeSelectionEnabled;
			return {
				enabled,
				defaultId: enabled ? settings.default : this.config.default
			};
		}
		/**
		* Every preset the configured roots currently supply.
		* @returns the presets, first-root-wins per id.
		*/
		async list() {
			return await discoverPresets(this.resolvedRoots, this.harnessBase);
		}
		/**
		* The roster off the Host: {@link list} projected to path-free rows, with
		* the policy-effective default marked, this deployment's authoring
		* capability, and its mode-selection policy beside it.
		*
		* Whether a client can open a preset's directory is the Host's own opener
		* capability, not a roster property — a caller needing both joins them.
		* @returns the rows, authoring capability, and effective selection policy.
		*/
		async remoteExportList() {
			const policy = this.selectionPolicy();
			return {
				presets: (await this.list()).map((preset) => ({
					id: preset.id,
					trust: preset.trust,
					isDefault: preset.id === policy.defaultId,
					...preset.name === void 0 ? {} : { name: preset.name },
					...preset.description === void 0 ? {} : { description: preset.description },
					...preset.broken === void 0 ? {} : { broken: preset.broken }
				})),
				authorable: this.authorable,
				modeSelectionEnabled: policy.enabled
			};
		}
		/**
		* Every preset's composition as flattened plugin rows, for plugin-listing
		* surfaces beside the roster's own picker.
		*
		* A preset with a live standing mount answers from its newest generation's
		* Loader entries — the composition new sessions join — even when the file
		* behind it has since been edited into an unreadable state: the mount is
		* what sessions actually run, so the broken verdict only applies to a
		* preset nothing composed. One never composed since boot answers from its
		* file, with `!!js` disabled gates evaluated against the Loader context so
		* both answers reflect the same host. Reading never mounts: an unmounted
		* preset is parsed, not composed, so listing a preset's plugins cannot
		* activate them early. A composition that stopped reading between
		* discovery's health verdict and this read is reported broken with the
		* raced reason rather than dropped.
		* @returns one composition per roster preset, in roster order.
		*/
		async compositionInventory() {
			const defaultId = this.defaultId;
			const evaluateExpression = (expression) => evaluate(this.ctx.loader.ctx, expression);
			const rootFiber = this.ctx.root.fiber;
			const found = [];
			for (const preset of await this.list()) {
				const identity = {
					id: preset.id,
					trust: preset.trust,
					...preset.name === void 0 ? {} : { name: preset.name },
					isDefault: preset.id === defaultId
				};
				const mount = livePresetMounts(rootFiber).findLast((candidate) => candidate.presetId === preset.id);
				if (mount !== void 0) {
					found.push({
						...identity,
						rows: mountedCompositionRows(mount.tree)
					});
					continue;
				}
				if (preset.broken !== void 0) {
					found.push({
						...identity,
						broken: preset.broken,
						rows: []
					});
					continue;
				}
				const read = await fileComposition(preset.path, evaluateExpression);
				found.push("broken" in read ? {
					...identity,
					broken: read.broken,
					rows: []
				} : {
					...identity,
					rows: read.rows
				});
			}
			return found;
		}
		/**
		* Resolve one preset by id.
		*
		* A broken preset resolves — deleting one, reading one, and reporting one
		* all need the row — and the mounting paths refuse it AFTER resolution
		* through {@link resolveMountable}.
		* @param id - the preset id, or `undefined` for {@link defaultId}.
		* @returns the resolved preset.
		* @throws when no configured root supplies that id.
		*/
		async resolve(id) {
			const wanted = id ?? this.defaultId;
			const presets = await this.list();
			const found = presets.find((preset) => preset.id === wanted);
			if (found === void 0) {
				const available = presets.map((preset) => preset.id);
				throw new RemoteError("agent-preset/not-found", `agent-presets: preset "${wanted}" not found (available: ${available.join(", ") || "none"})`, {
					agentPreset: wanted,
					available
				});
			}
			return found;
		}
		/**
		* Resolve one preset that is about to compose an agent, refusing a broken
		* one with its discovery-reported reason. Failing here rather than inside
		* the loader keeps the answer the same for every unloadable shape — ghost
		* directory, unparsable YAML, rowless list — and spends no mount attempt
		* on a composition discovery already read as unusable.
		* @param id - the preset id, or `undefined` for {@link defaultId}.
		* @returns the resolved, mountable preset.
		* @throws when the preset is unknown or discovery reports it broken.
		*/
		async resolveMountable(id) {
			const preset = await this.resolve(id);
			if (preset.broken !== void 0) throw new RemoteError("agent-preset/invalid", `agent-presets: preset "${preset.id}" failed to mount: ${preset.broken}`, {
				agentPreset: preset.id,
				reason: preset.broken
			});
			return preset;
		}
		/**
		* Standing mounts by preset id, single-flight so two agents racing the
		* first use of one preset share one composition. A settled failure is
		* removed so a later session retries a preset whose file has been fixed; a
		* settled success serves until the composition FILE visibly changes — each
		* generation records its file stamp, and a stale stamp starts the next
		* generation for sessions created afterwards. Sessions already joined keep
		* the generation they run on; a superseded one is never disposed while the
		* process lives (reclaimed only by whole-tree teardown), so editing files
		* is bounded by how often compositions change, not by session count.
		*/
		standing = /* @__PURE__ */ new Map();
		/**
		* Parent bindings of the agents this roster composed, keyed by the agent's
		* scope key. The binding is dsh-scope's only re-link capability; holding it
		* here makes this service the sole authority that can move an agent between
		* standing compositions. WeakMap: entries die with their agents.
		*/
		bindings = /* @__PURE__ */ new WeakMap();
		/**
		* Compose one agent from a preset: ensure the preset's standing mount, then
		* parent the agent's scope key to it so the mount's registrations and
		* listeners cover this agent.
		*
		* Call from the agent factory's `setup(agentCtx)`; a rejection there rolls
		* the agent creation back, so a broken preset never yields a half-composed
		* session.
		* @param agentCtx - the agent's scope context.
		* @param id - the preset id, or `undefined` for {@link defaultId}.
		* @returns the preset that was composed, for the caller to record.
		* @throws when the preset is unknown or its composition is unusable.
		*/
		async mount(agentCtx, id) {
			const agentKey = scopeOf(agentCtx);
			if (agentKey === void 0) throw new Error("agent-presets: refusing to compose an unscoped context; the scope key is what joins an agent to its preset");
			const preset = await this.resolveMountable(id);
			const standing = await this.ensureStanding(preset);
			this.bindings.set(agentKey, bindScopeParent(agentKey, standing.key));
			return preset;
		}
		/**
		* Join one agent to the SAME standing composition another already runs on.
		*
		* This is how a child agent inherits its parent's capabilities. It is a bind,
		* not a mount: the parent's generation is already composed, so the child gets
		* that exact instance — the same plugin objects, the same tool registrations,
		* the same prompt sections. Re-resolving the parent's preset by id instead
		* would re-read the roster, and a composition file edited since the parent
		* started would hand the child a DIFFERENT generation than the one its
		* parent's history was produced under (and a preset deleted since would fail
		* the child outright while its parent keeps running).
		*
		* Synchronous, and with no composition failure mode of its own — it reads no
		* roster, mounts nothing, and touches no file — which is what lets a child
		* creation window use it: the two in-process subagent drivers compose their
		* children inside a synchronous `setup`. It still rejects a caller error, as
		* the `@throws` below record.
		*
		* A parent that joined no preset — a rosterless deployment — yields no join
		* and no error: there, the model-facing rows sit in the host composition and
		* the child already sees them through the global layer.
		* @param agentCtx - the joining agent's scope context.
		* @param parentCtx - the scope context of the agent whose composition to join.
		* @returns the preset id joined, or undefined when the parent joined none.
		* @throws when `agentCtx` carries no scope, or has already joined a preset.
		*/
		composeFrom(agentCtx, parentCtx) {
			const agentKey = scopeOf(agentCtx);
			if (agentKey === void 0) throw new Error("agent-presets: refusing to compose an unscoped context; the scope key is what joins an agent to its preset");
			const standing = standingMountFor(parentCtx);
			if (standing === void 0) return void 0;
			this.bindings.set(agentKey, bindScopeParent(agentKey, standing.key));
			return standing.presetId;
		}
		/**
		* The preset one live agent runs on.
		*
		* Read from the live scope chain rather than from the session, so it answers
		* for an agent whose session has not recorded a preset yet — a child agent
		* whose durable header is being built from its parent's composition.
		* @param agentCtx - the agent's scope context.
		* @returns the preset id, or undefined when the agent joined none.
		*/
		composedPreset(agentCtx) {
			return standingMountFor(agentCtx)?.presetId;
		}
		/**
		* The roots this roster scans, which is not `config.roots`: the package's
		* shipped root unless `includeShippedRoot` is false, every configured root
		* in order, then the harness-home user root unless `includeUserRoot` is
		* false. Read this — not the config field — to answer whether a roster is
		* composed at all, so one derivation decides it.
		*/
		get roots() {
			return this.resolvedRoots;
		}
		/** Whether this deployment has a root locally authored presets go to. */
		get authorable() {
			return this.resolvedRoots.some((root) => root.trust === "user");
		}
		/**
		* Read one preset's composition text.
		* @param id - the preset id.
		* @returns the composition exactly as stored.
		* @throws when no configured root supplies that id.
		*/
		async read(id) {
			return await readComposition(await this.resolve(id));
		}
		/**
		* One preset's composition text with the roster row it belongs to.
		* @param agentPreset - the preset id.
		* @returns the composition beside its trust and published metadata.
		* @throws {RemoteError} `gateway/bad-request` for an empty id, or
		* `agent-preset/not-found` when no configured root supplies it.
		*/
		async readDocument(agentPreset) {
			validatePresetId(agentPreset, "agentPreset");
			const preset = await this.resolve(agentPreset);
			return {
				agentPreset: preset.id,
				trust: preset.trust,
				content: await this.read(preset.id),
				...preset.name === void 0 ? {} : { name: preset.name },
				...preset.description === void 0 ? {} : { description: preset.description }
			};
		}
		/**
		* Create a locally authored preset by copying an existing one whole.
		*
		* Copy is the only authoring write. Composition text never crosses this
		* seam: the source is named by id and its directory is copied as it stands,
		* so the copy is exactly as loadable as its source and authoring grants no
		* capability the roster did not already carry. The copy is NOT mounted to
		* validate — a source that mounts today yields a copy that mounts today.
		* @param from - the preset the copy starts from; shipped presets are the
		* primary source, so any trust is accepted.
		* @param id - the new preset's id, which becomes its directory name.
		* @param name - display name for the copy; absent falls back to the id.
		* @throws when the source is unknown, the id is unusable or already taken,
		* or the deployment configures no writable root.
		*/
		async copy(from, id, name) {
			const source = await this.resolve(from);
			if ((await this.list()).some((preset) => preset.id === id)) throw presetExists(id);
			await copyComposition(this.resolvedRoots, source, id, name);
			this.standing.delete(id);
		}
		/**
		* Copy one preset through the Remote API.
		* @param from - the source preset id.
		* @param id - the new preset id.
		* @param name - the copy's optional display name.
		* @returns once the copy is stored.
		* @throws {RemoteError} with the corresponding stable preset code and
		* details when the copy is refused.
		*/
		async remoteExportCopy(from, id, name) {
			validatePresetId(from, "from");
			validatePresetId(id, "agentPreset");
			await this.copy(from, id, name);
		}
		/**
		* Delete a locally authored preset.
		*
		* @param id - the preset id.
		* @throws when the preset is unknown or ships with the deployment.
		*/
		async remove(id) {
			await deleteComposition(this.resolvedRoots, await this.resolve(id));
			this.standing.delete(id);
			if (this.settings?.get().default !== id) return;
			await this.settingsService?.mutate(SETTINGS_NAMESPACE, [{
				op: "unset",
				path: ["default"]
			}]);
		}
		/**
		* Delete one preset through the Remote API.
		* @param id - the preset id.
		* @returns once the preset is deleted.
		* @throws {RemoteError} with the corresponding stable preset code and
		* details when deletion is refused.
		*/
		async remoteExportDelete(id) {
			validatePresetId(id, "agentPreset");
			await this.remove(id);
		}
		/**
		* One agent's instance of a service its preset mounted.
		*
		* A preset publishes services behind `isolate` realms, which are invisible
		* outside the group that declares them — including to the host. This is how a
		* caller holding the agent reads one anyway: a request that is ABOUT a
		* session but arrives from outside it, which is every browser RPC.
		*
		* Read addressing only. A host row that `inject`s a service cannot use this,
		* because injection resolves before any session exists and has no agent to
		* key by; such a service belongs on the host plane instead.
		* @param agent - the agent whose composition to look inside.
		* @param name - the service name as the preset's rows resolve it.
		* @returns the agent's instance, or undefined when its preset mounts none.
		*/
		serviceFor(agent, name) {
			return serviceForAgent(this.ctx, agent, name);
		}
		/**
		* Re-link one agent to a different preset's standing composition.
		*
		* Only valid while the agent has produced nothing: swapping tools mid
		* conversation would leave logged tool calls the new composition cannot
		* make. The CALLER owns that check — this method does not read session
		* history.
		*
		* The swap is a parent re-link, not an unmount: standing mounts are shared
		* and permanent, so the old composition stays for its other agents and the
		* new one is ensured BEFORE the link moves. An unknown or unusable preset
		* therefore throws with the agent exactly as it was — there is no torn-down
		* state to restore. The re-link runs through the binding this roster kept
		* from the agent's mount — dsh-scope's only re-link authority. An agent
		* that never composed one has nothing to re-link: the switch is then the
		* agent's first bind, exactly a mount. A committed re-link emits
		* `tools/change` because changing the parent scope changes the Agent's
		* resolved tool set without adding or removing registry entries.
		* @param agentCtx - the agent's scope context.
		* @param id - the preset to compose the agent from instead.
		* @returns the preset now installed.
		* @throws when the preset is unknown or its composition is unusable.
		*/
		async recompose(agentCtx, id) {
			const agentKey = scopeOf(agentCtx);
			if (agentKey === void 0) throw new Error("agent-presets: refusing to recompose an unscoped context");
			const preset = await this.resolveMountable(id);
			const standing = await this.ensureStanding(preset);
			const binding = this.bindings.get(agentKey);
			if (binding === void 0) this.bindings.set(agentKey, bindScopeParent(agentKey, standing.key));
			else binding.rebind(standing.key);
			try {
				this.ctx.emit("tools/change");
			} catch (error) {
				this.ctx.logger.warn(`agent-presets: tools/change listener failed after recomposing an Agent: ${String(error)}`);
			}
			return preset;
		}
		/**
		* Serializes {@link select} per session. Two concurrent selects would both
		* pass the blank check, and the second re-link would then find the record
		* the first already replaced — leaving two compositions registered into one
		* agent layer. A client's `busy` flag is not enforcement: the wire is
		* reachable directly.
		*
		* Entries hold a failure-swallowing guard rather than the turn itself, so a
		* refused switch does not reject the next caller's chain.
		*/
		switches = /* @__PURE__ */ new Map();
		/**
		* Compose a blank session's agent from a different preset and record it.
		* @param agent - the session's live agent, resolved from the wire identity.
		* @param agentPreset - the preset to compose the agent from instead.
		* @returns the preset id that was recorded.
		* @throws {RemoteError} with `gateway/bad-request`, `agent-preset/locked`,
		* `agent-preset/not-found`, or `agent-preset/invalid` when refused.
		*/
		async select(agent, agentPreset) {
			validatePresetId(agentPreset, "agentPreset");
			const turn = (this.switches.get(agent.id) ?? Promise.resolve()).then(() => this.swap(agent, agentPreset));
			const guard = turn.catch(() => void 0);
			this.switches.set(agent.id, guard);
			try {
				return await turn;
			} finally {
				if (this.switches.get(agent.id) === guard) this.switches.delete(agent.id);
			}
		}
		/** One queued switch: re-check, recompose, then record what the agent runs. */
		async swap(agent, agentPreset) {
			const boundary = this.selfCtx.sessionProjections.stateOf(agent.session, "turnBoundary");
			if (boundary !== void 0 && (boundary.openTurnStartSeq !== null || boundary.lastTurn > 0)) throw new RemoteError("agent-preset/locked", `session "${agent.id}" has already started; its agent preset is fixed`, {
				sessionId: agent.id,
				agentPreset
			});
			const preset = await this.recompose(agent.ctx, agentPreset);
			agent.session.append("agent-preset/selected", { agentPreset: preset.id });
			return preset.id;
		}
		/**
		* The standing scope key of one preset, for a host reader with no agent.
		*
		* A cold transcript read resolves tool presenters against the composition
		* the session recorded, and the standing mount makes that possible without
		* resuming anything: ensuring the mount composes plugins but starts no
		* agent, no session, and no turn.
		* @param id - the preset id, or `undefined` for {@link defaultId}.
		* @returns the standing scope key readers pass as a registry view scope.
		* @throws when the preset is unknown or its composition is unusable.
		*/
		async standingKeyFor(id) {
			const preset = await this.resolveMountable(id);
			return (await this.ensureStanding(preset)).key;
		}
		/** Resolve (or create, single-flight) the standing mount of one preset. */
		async ensureStanding(preset) {
			const pending = this.standing.get(preset.id);
			if (pending !== void 0) {
				const mounted = await pending;
				const current = await compositionStamp(preset.path);
				if (current === void 0 || sameStamp(mounted.stamp, current)) return mounted;
				if (this.standing.get(preset.id) === pending) this.standing.delete(preset.id);
				return this.ensureStanding(preset);
			}
			const created = (async () => {
				const key = { agentPreset: preset.id };
				const scope = createScope(this.selfCtx, key);
				try {
					const stamp = await compositionStamp(preset.path);
					if (stamp === void 0) {
						const reason = `composition file is unreadable: ${preset.path}`;
						throw new RemoteError("agent-preset/invalid", `agent-presets: preset "${preset.id}" failed to mount: ${reason}`, {
							agentPreset: preset.id,
							reason
						});
					}
					await mountPreset(scope.ctx, preset);
					return {
						key,
						scope,
						stamp
					};
				} catch (error) {
					this.standing.delete(preset.id);
					await scope.dispose();
					throw error;
				}
			})();
			this.standing.set(preset.id, created);
			return created;
		}
	};
})();
/** Read one composition file's stamp, or undefined when it cannot be statted. */
async function compositionStamp(path) {
	try {
		const { mtimeMs, size } = await stat(path);
		return {
			mtimeMs,
			size
		};
	} catch {
		return;
	}
}
/** Whether two stamps name the same file state. */
function sameStamp(a, b) {
	return a.mtimeMs === b.mtimeMs && a.size === b.size;
}
//#endregion
export { standingMountFor };
