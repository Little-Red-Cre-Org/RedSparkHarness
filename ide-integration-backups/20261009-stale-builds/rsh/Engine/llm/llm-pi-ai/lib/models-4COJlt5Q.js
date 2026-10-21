import { i as AssistantMessageEventStream, r as formatThrownValue } from "./diagnostics-nBA5pPq5.js";
//#region ../../../../node_modules/.pnpm/@earendil-works+pi-ai@1.0.0_71d8dfff7c0445882abb8c414f4fc20f/node_modules/@earendil-works/pi-ai/dist/api/lazy.js
function createSetupErrorMessage(model, error) {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0
			}
		},
		stopReason: "error",
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp: Date.now()
	};
}
function hasResult(source) {
	return typeof source.result === "function";
}
async function forwardStream(target, source) {
	for await (const event of source) target.push(event);
	target.end(hasResult(source) ? await source.result() : void 0);
}
/**
* Returns a stream synchronously while running async setup (auth resolution,
* lazy module loading) behind it. Setup failures terminate the stream with an
* error event.
*/
function lazyStream(model, setup) {
	const outer = new AssistantMessageEventStream();
	setup().then((inner) => forwardStream(outer, inner)).catch((error) => {
		const message = createSetupErrorMessage(model, error);
		outer.push({
			type: "error",
			reason: "error",
			error: message
		});
		outer.end(message);
	});
	return outer;
}
function lazyApi(load, capabilities) {
	const api = {
		stream: (model, context, options) => lazyStream(model, async () => (await load()).stream(model, context, options)),
		streamSimple: (model, context, options) => lazyStream(model, async () => (await load()).streamSimple(model, context, options))
	};
	if (capabilities?.fetchDeferred) api.fetchDeferred = (model, handle, options) => lazyStream(model, async () => {
		const implementation = await load();
		if (!implementation.fetchDeferred) throw new Error("API does not support deferred responses");
		return implementation.fetchDeferred(model, handle, options);
	});
	if (capabilities?.cancelDeferred) api.cancelDeferred = async (model, handle, options) => {
		const implementation = await load();
		if (!implementation.cancelDeferred) throw new Error("API cannot cancel deferred responses");
		await implementation.cancelDeferred(model, handle, options);
	};
	return api;
}
//#endregion
//#region ../../../../node_modules/.pnpm/@earendil-works+pi-ai@1.0.0_71d8dfff7c0445882abb8c414f4fc20f/node_modules/@earendil-works/pi-ai/dist/auth/context.js
var __rewriteRelativeImportExtension = function(path, preserveJsx) {
	if (typeof path === "string" && /^\.\.?\//.test(path)) return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function(m, tsx, d, ext, cm) {
		return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : d + ext + "." + cm.toLowerCase() + "js";
	});
	return path;
};
const importNodeModule = (specifier) => import(__rewriteRelativeImportExtension(specifier));
function getProcessEnv() {
	return globalThis.process?.env;
}
/**
* Default auth context: env vars from `process.env` (undefined in browsers),
* file existence via node:fs (always false in browsers).
*/
function defaultProviderAuthContext() {
	return {
		async env(name) {
			const value = getProcessEnv()?.[name];
			return typeof value === "string" && value.trim().length > 0 ? value : void 0;
		},
		async fileExists(path) {
			try {
				const fs = await importNodeModule("node:fs/promises");
				let resolved = path;
				if (resolved.startsWith("~")) resolved = (await importNodeModule("node:os")).homedir() + resolved.slice(1);
				await fs.access(resolved);
				return true;
			} catch {
				return false;
			}
		}
	};
}
//#endregion
//#region ../../../../node_modules/.pnpm/@earendil-works+pi-ai@1.0.0_71d8dfff7c0445882abb8c414f4fc20f/node_modules/@earendil-works/pi-ai/dist/utils/abort.js
function abortReason(signal) {
	if (signal.reason !== void 0) return signal.reason;
	const error = /* @__PURE__ */ new Error("The operation was aborted");
	error.name = "AbortError";
	return error;
}
/** Create an operation-local signal for public APIs whose signal is optional. */
function operationSignal(signal) {
	return signal ?? new AbortController().signal;
}
/**
* Stop waiting for an operation when its signal aborts while continuing to
* observe the abandoned promise so a later rejection is always handled.
*/
function raceWithAbortSignal(operation, signal) {
	if (signal.aborted) {
		operation.catch(() => {});
		return Promise.reject(abortReason(signal));
	}
	return new Promise((resolve, reject) => {
		let settled = false;
		const cleanup = () => signal.removeEventListener("abort", onAbort);
		const onAbort = () => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(abortReason(signal));
		};
		signal.addEventListener("abort", onAbort, { once: true });
		operation.then((value) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(value);
		}, (error) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error);
		});
		if (signal.aborted) onAbort();
	});
}
//#endregion
//#region ../../../../node_modules/.pnpm/@earendil-works+pi-ai@1.0.0_71d8dfff7c0445882abb8c414f4fc20f/node_modules/@earendil-works/pi-ai/dist/auth/credential-store.js
/**
* Default in-memory credential store. Apps inject persistent stores.
* Keyed by `Provider.id`, one credential per provider; see `CredentialStore`.
* Writes are serialized per provider through a promise chain.
*/
var InMemoryCredentialStore = class {
	credentials = /* @__PURE__ */ new Map();
	chains = /* @__PURE__ */ new Map();
	/** Serialize tasks per provider id without releasing the chain before active work settles. */
	enqueue(providerId, task, options) {
		const signal = operationSignal(options?.signal);
		const previous = this.chains.get(providerId) ?? Promise.resolve();
		const queued = (async () => {
			await previous.catch(() => {});
			signal.throwIfAborted();
			return task();
		})();
		const tail = queued.catch(() => {});
		this.chains.set(providerId, tail);
		tail.then(() => {
			if (this.chains.get(providerId) === tail) this.chains.delete(providerId);
		});
		return raceWithAbortSignal(queued, signal);
	}
	async read(providerId, options) {
		options?.signal?.throwIfAborted();
		return this.credentials.get(providerId);
	}
	async list(options) {
		options?.signal?.throwIfAborted();
		return [...this.credentials].map(([providerId, credential]) => ({
			providerId,
			type: credential.type
		}));
	}
	modify(providerId, fn, options) {
		return this.enqueue(providerId, async () => {
			const current = this.credentials.get(providerId);
			const next = await fn(current);
			options?.signal?.throwIfAborted();
			if (next !== void 0) this.credentials.set(providerId, next);
			return next ?? current;
		}, options);
	}
	delete(providerId, options) {
		return this.enqueue(providerId, async () => {
			this.credentials.delete(providerId);
		}, options);
	}
};
//#endregion
//#region ../../../../node_modules/.pnpm/@earendil-works+pi-ai@1.0.0_71d8dfff7c0445882abb8c414f4fc20f/node_modules/@earendil-works/pi-ai/dist/utils/models-error.js
var ModelsError = class extends Error {
	code;
	constructor(code, message, options) {
		super(withCauseDetail(message, options?.cause), options);
		this.name = "ModelsError";
		this.code = code;
	}
};
/** Callers surface `error.message` only, so keep the underlying reason in it. */
function withCauseDetail(message, cause) {
	if (cause === void 0 || cause === null) return message;
	const detail = formatThrownValue(cause).trim();
	if (!detail || message.includes(detail)) return message;
	return `${message}: ${detail}`;
}
//#endregion
//#region ../../../../node_modules/.pnpm/@earendil-works+pi-ai@1.0.0_71d8dfff7c0445882abb8c414f4fc20f/node_modules/@earendil-works/pi-ai/dist/auth/resolve.js
/**
* Auth resolution shared by all operations in a `Models` collection.
* A stored credential owns the provider: ambient/env is consulted only when
* nothing is stored. No silent env fallback after a failed refresh or for a
* credential type without a matching handler.
*/
function resolveProviderAuth(provider, credentials, authContext, overrides) {
	const signal = operationSignal(overrides?.signal);
	return raceWithAbortSignal(resolveProviderAuthWithSignal(provider, credentials, authContext, overrides, signal), signal);
}
async function resolveProviderAuthWithSignal(provider, credentials, authContext, overrides, signal) {
	signal.throwIfAborted();
	const requestAuthContext = overrides?.env ? overlayEnvAuthContext(authContext, overrides.env) : authContext;
	if (overrides?.apiKey !== void 0 && provider.auth.apiKey) return resolveApiKey(requestAuthContext, provider.auth.apiKey, provider.id, {
		type: "api_key",
		key: overrides.apiKey,
		env: overrides.env
	}, signal);
	const stored = await readCredential(credentials, provider.id, signal);
	if (stored) {
		if (stored.type === "oauth" && provider.auth.oauth) return resolveStoredOAuth(credentials, provider.id, provider.auth.oauth, stored, signal, overrides?.minOAuthValidityMs);
		if (stored.type === "api_key" && provider.auth.apiKey) {
			const credential = overrides?.env ? {
				...stored,
				env: {
					...stored.env,
					...overrides.env
				}
			} : stored;
			return resolveApiKey(requestAuthContext, provider.auth.apiKey, provider.id, credential, signal);
		}
		return;
	}
	return provider.auth.apiKey ? resolveApiKey(requestAuthContext, provider.auth.apiKey, provider.id, void 0, signal) : void 0;
}
function overlayEnvAuthContext(base, env) {
	return {
		env: async (name) => env[name] || await base.env(name),
		fileExists: (path) => base.fileExists(path)
	};
}
const DEFAULT_OAUTH_MINIMUM_VALIDITY_MS = 300 * 1e3;
const DEFAULT_OAUTH_REFRESH_TIMEOUT_MS = 15e3;
/**
* OAuth resolution with double-checked locking: tokens with less than five
* minutes remaining lock, re-check expiry under the lock, refresh once
* globally, and persist the rotated credential before release.
*/
async function resolveStoredOAuth(credentials, providerId, oauth, stored, signal, minOAuthValidityMs) {
	const minimumValidityMs = Math.max(DEFAULT_OAUTH_MINIMUM_VALIDITY_MS, minOAuthValidityMs ?? 0);
	const expiresSoon = (credential) => Date.now() + minimumValidityMs >= credential.expires;
	let credential = stored;
	if (expiresSoon(credential)) {
		let post;
		try {
			post = await credentials.modify(providerId, async (current) => {
				if (current?.type !== "oauth") return void 0;
				if (!expiresSoon(current)) return void 0;
				try {
					const refreshSignal = AbortSignal.any([signal, AbortSignal.timeout(DEFAULT_OAUTH_REFRESH_TIMEOUT_MS)]);
					return await oauth.refresh(current, refreshSignal);
				} catch (error) {
					throw new ModelsError("oauth", `OAuth refresh failed for ${providerId}`, { cause: error });
				}
			}, { signal });
		} catch (error) {
			if (error instanceof ModelsError) throw error;
			throw new ModelsError("auth", `Credential store modify failed for ${providerId}`, { cause: error });
		}
		if (post?.type !== "oauth") return void 0;
		credential = post;
		if (minOAuthValidityMs !== void 0 && expiresSoon(credential)) throw new ModelsError("oauth", `OAuth refresh returned a token that expires too soon for ${providerId}`);
	}
	try {
		return {
			auth: await oauth.toAuth(credential),
			source: "OAuth"
		};
	} catch (error) {
		throw new ModelsError("oauth", `OAuth auth derivation failed for ${providerId}`, { cause: error });
	}
}
async function resolveApiKey(authContext, apiKey, providerId, credential, signal) {
	try {
		return await apiKey.resolve({
			ctx: authContext,
			credential,
			signal
		});
	} catch (error) {
		throw new ModelsError("auth", `API key auth failed for provider ${providerId}`, { cause: error });
	}
}
async function readCredential(credentials, providerId, signal) {
	try {
		return await credentials.read(providerId, { signal });
	} catch (error) {
		throw new ModelsError("auth", `Credential store read failed for ${providerId}`, { cause: error });
	}
}
//#endregion
//#region ../../../../node_modules/.pnpm/@earendil-works+pi-ai@1.0.0_71d8dfff7c0445882abb8c414f4fc20f/node_modules/@earendil-works/pi-ai/dist/models-store.js
var InMemoryModelsStore = class {
	entries = /* @__PURE__ */ new Map();
	async read(providerId, options) {
		options?.signal?.throwIfAborted();
		const entry = this.entries.get(providerId);
		return entry ? structuredClone(entry) : void 0;
	}
	async write(providerId, entry, options) {
		options?.signal?.throwIfAborted();
		this.entries.set(providerId, structuredClone(entry));
	}
	async delete(providerId, options) {
		options?.signal?.throwIfAborted();
		this.entries.delete(providerId);
	}
};
//#endregion
//#region ../../../../node_modules/.pnpm/@earendil-works+pi-ai@1.0.0_71d8dfff7c0445882abb8c414f4fc20f/node_modules/@earendil-works/pi-ai/dist/utils/model-operations.js
/** The type of a model. Models without `type` are chat models. */
function getModelType(model) {
	return model.type ?? "chat";
}
/** Runtime-checked model type narrowing, including legacy chat models without `type`. */
function isModelType(model, type) {
	return getModelType(model) === type;
}
function assertChatModel(model) {
	if (!isModelType(model, "chat")) throw new ModelsError("provider", `Model ${model.provider}/${model.id} is not a chat model`);
}
function assertImageModel(model) {
	if (!isModelType(model, "image")) throw new ModelsError("provider", `Model ${model.provider}/${model.id} is not an image model`);
}
function assertClassifierModel(model) {
	if (!isModelType(model, "classifier")) throw new ModelsError("provider", `Model ${model.provider}/${model.id} is not a classifier model`);
}
function imageErrorResult(model, error, aborted = false) {
	return {
		api: model.api,
		provider: model.provider,
		model: model.id,
		output: [],
		stopReason: aborted ? "aborted" : "error",
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp: Date.now()
	};
}
function classifierErrorResult(model, error, aborted = false) {
	return {
		api: model.api,
		provider: model.provider,
		model: model.id,
		answers: {},
		stopReason: aborted ? "aborted" : "error",
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp: Date.now()
	};
}
//#endregion
//#region ../../../../node_modules/.pnpm/@earendil-works+pi-ai@1.0.0_71d8dfff7c0445882abb8c414f4fc20f/node_modules/@earendil-works/pi-ai/dist/utils/text.js
/** Extract and join text from message content. */
function contentText(content, separator = "\n") {
	if (typeof content === "string") return content;
	return content.filter((block) => block.type === "text").map((block) => block.text).join(separator);
}
/** Render a system message as a complete prompt: its content followed by its sections. */
function getSystemMessageText(message) {
	const parts = [contentText(message.content)];
	for (const text of Object.values(message.sections ?? {})) if (text !== null) parts.push(text);
	return parts.filter((part) => part.length > 0).join("\n\n");
}
/**
* Render a later system message for APIs that accept system messages mid-conversation.
* Section changes are framed by name so the model can relate them to the leading prompt.
* This framing is request-time only and may change between versions.
*/
function renderSystemMessageUpdate(message) {
	const parts = [];
	const text = contentText(message.content);
	if (text.length > 0) parts.push(text);
	for (const [name, value] of Object.entries(message.sections ?? {})) parts.push(value === null ? `Removed system prompt section "${name}".` : `Updated system prompt section "${name}":\n\n${value}`);
	return parts.join("\n\n");
}
//#endregion
//#region ../../../../node_modules/.pnpm/@earendil-works+pi-ai@1.0.0_71d8dfff7c0445882abb8c414f4fc20f/node_modules/@earendil-works/pi-ai/dist/utils/transcript.js
/**
* Build the leading system message for a prompt and tool set. Returns undefined when
* both are empty, so an empty transcript stays empty.
*/
function createInitialSystemMessage(systemPrompt, tools) {
	const hasSystemPrompt = systemPrompt !== void 0 && systemPrompt.length > 0;
	const hasTools = tools !== void 0 && tools.length > 0;
	if (!hasSystemPrompt && !hasTools) return void 0;
	return {
		role: "system",
		content: systemPrompt ?? "",
		...hasTools ? { toolsAdded: tools } : {},
		timestamp: 0
	};
}
/**
* Fold `Context.systemPrompt` and `Context.tools` into a leading system message.
* This is the only entry point that produces a {@link TranscriptContext}; every
* provider-facing function expects the result.
*/
function normalizeContext(context) {
	const initialMessage = createInitialSystemMessage(context.systemPrompt, context.tools);
	return { messages: initialMessage ? [initialMessage, ...context.messages] : context.messages };
}
function isSystemMessage(message) {
	return message.role === "system";
}
/** Return the leading system message, if the transcript starts with one. */
function getInitialSystemMessage(messages) {
	const first = messages[0];
	return first && isSystemMessage(first) ? first : void 0;
}
/** Drop the leading system message for APIs that carry the prompt outside the message list. */
function withoutInitialSystemMessage(messages) {
	return getInitialSystemMessage(messages) ? messages.slice(1) : messages;
}
/** Resolve the tools available after applying every transcript delta in order. */
function getCurrentTools(messages) {
	const tools = /* @__PURE__ */ new Map();
	for (const message of messages) {
		if (!isSystemMessage(message)) continue;
		for (const tool of message.toolsRemoved ?? []) tools.delete(tool.name);
		for (const tool of message.toolsAdded ?? []) tools.set(tool.name, tool);
	}
	return [...tools.values()];
}
/**
* Replay every system message into one leading system message holding the current
* prompt and tools. Later `content` is appended to the base prompt, `sections` are
* patched by name, and tools are resolved with {@link getCurrentTools}.
*/
function getCurrentSystemMessage(messages) {
	const content = [];
	const sections = /* @__PURE__ */ new Map();
	let timestamp;
	for (const message of messages) {
		if (!isSystemMessage(message)) continue;
		timestamp ??= message.timestamp;
		const text = contentText(message.content);
		if (text.length > 0) content.push(text);
		for (const [name, value] of Object.entries(message.sections ?? {})) if (value === null) sections.delete(name);
		else sections.set(name, value);
	}
	const tools = getCurrentTools(messages);
	if (timestamp === void 0 && tools.length === 0) return void 0;
	return {
		role: "system",
		content: content.join("\n\n"),
		...sections.size > 0 ? { sections: Object.fromEntries(sections) } : {},
		...tools.length > 0 ? { toolsAdded: tools } : {},
		timestamp: timestamp ?? 0
	};
}
/**
* Rebuild the transcript for APIs without mid-conversation system messages: the replayed
* system message leads, and every later system message is dropped.
*/
function collapseSystemMessages(context) {
	const head = getCurrentSystemMessage(context.messages);
	const messages = context.messages.filter((message) => message.role !== "system");
	return { messages: head ? [head, ...messages] : messages };
}
/** Keep later system messages in place when the model accepts them; otherwise collapse them. */
function resolveTranscript(context, supportsMidConvoSystemMessages) {
	return supportsMidConvoSystemMessages ? context : collapseSystemMessages(context);
}
/** Strip executable and display-only fields from a tool before transcript comparison or persistence. */
function toToolDeclaration(tool) {
	return {
		name: tool.name,
		description: tool.description,
		parameters: JSON.parse(JSON.stringify(tool.parameters)),
		...tool.constrainedSampling === void 0 ? {} : { constrainedSampling: tool.constrainedSampling }
	};
}
/**
* Whether two tools declare the same interface to the model.
*
* Both sides go through {@link toToolDeclaration} first: its JSON round-trip drops the
* typebox symbol keys and `undefined` fields that a structural comparison would see, and
* builds both objects with the same key order, so comparing the serialized declarations
* is exact. This avoids a deep-equal dependency in a browser-safe package.
*/
function declarationsEqual(left, right) {
	return JSON.stringify(toToolDeclaration(left)) === JSON.stringify(toToolDeclaration(right));
}
/** Every definition referenced by transcript tool state, in first-declaration order. */
function getDeclaredTools(messages) {
	const definitions = /* @__PURE__ */ new Map();
	for (const message of messages) {
		if (!isSystemMessage(message)) continue;
		for (const tool of message.toolsAdded ?? []) definitions.set(tool.name, tool);
	}
	return [...definitions.values()];
}
/**
* Whether a tool name was declared twice with different definitions. Transports that
* reference tools by name (Anthropic `tool_addition`/`tool_removal`) cannot express that.
*/
function hasToolRedefinitions(messages) {
	const declared = /* @__PURE__ */ new Map();
	for (const message of messages) {
		if (!isSystemMessage(message)) continue;
		for (const tool of message.toolsAdded ?? []) {
			const previous = declared.get(tool.name);
			if (previous !== void 0 && !declarationsEqual(previous, tool)) return true;
			declared.set(tool.name, tool);
		}
	}
	return false;
}
/** Whether tool history contains a removal or same-name redeclaration that an addition-only transport cannot replay. */
function hasNonAdditiveToolChanges(messages) {
	const declared = /* @__PURE__ */ new Set();
	for (const message of messages) {
		if (!isSystemMessage(message)) continue;
		if ((message.toolsRemoved?.length ?? 0) > 0) return true;
		for (const tool of message.toolsAdded ?? []) {
			if (declared.has(tool.name)) return true;
			declared.add(tool.name);
		}
	}
	return false;
}
/**
* Split tool declarations between the top-level request field and in-place additions.
* Transports that can anchor additions at a system message keep the initial tools at the
* top and load later ones where they appear; that only works when no tool was removed or
* redeclared, so everything else sends the current tool list.
*/
function resolveTranscriptTools(messages, supportsToolAdditions) {
	const anchorsAdditions = supportsToolAdditions && !hasNonAdditiveToolChanges(messages);
	return {
		requestTools: anchorsAdditions ? getInitialSystemMessage(messages)?.toolsAdded ?? [] : getCurrentTools(messages),
		anchorsAdditions
	};
}
//#endregion
//#region ../../../../node_modules/.pnpm/@earendil-works+pi-ai@1.0.0_71d8dfff7c0445882abb8c414f4fc20f/node_modules/@earendil-works/pi-ai/dist/models.js
const KNOWN_MODEL_TYPES = {
	chat: true,
	image: true,
	classifier: true
};
/** Models from stores and remote sources may have types that only newer versions know. */
function hasKnownModelType(model) {
	return Object.hasOwn(KNOWN_MODEL_TYPES, getModelType(model));
}
/** Drops stored models whose type this version does not know. */
function withKnownModelTypes(entry) {
	return {
		...entry,
		models: entry.models.filter(hasKnownModelType)
	};
}
function mergeHeaders(base, override) {
	if (!base && !override) return void 0;
	const merged = { ...base };
	for (const [name, value] of Object.entries(override ?? {})) {
		const lowerName = name.toLowerCase();
		for (const existingName of Object.keys(merged)) if (existingName.toLowerCase() === lowerName) delete merged[existingName];
		merged[name] = value;
	}
	return merged;
}
var ModelsImpl = class {
	providers = /* @__PURE__ */ new Map();
	credentials;
	modelsStore;
	authContext;
	refreshGenerations = /* @__PURE__ */ new Map();
	refreshControllers = /* @__PURE__ */ new Map();
	publicationChains = /* @__PURE__ */ new Map();
	constructor(options) {
		this.credentials = options?.credentials ?? new InMemoryCredentialStore();
		this.modelsStore = options?.modelsStore ?? new InMemoryModelsStore();
		this.authContext = options?.authContext ?? defaultProviderAuthContext();
	}
	setProvider(provider) {
		this.supersedeProviderRefresh(provider.id);
		this.providers.set(provider.id, provider);
	}
	deleteProvider(id) {
		this.supersedeProviderRefresh(id);
		this.providers.delete(id);
	}
	clearProviders() {
		for (const id of new Set([...this.providers.keys(), ...this.refreshControllers.keys()])) this.supersedeProviderRefresh(id);
		this.providers.clear();
	}
	getProviders() {
		return Array.from(this.providers.values());
	}
	getProvider(id) {
		return this.providers.get(id);
	}
	getModels(provider) {
		if (provider !== void 0) {
			const entry = this.providers.get(provider);
			if (!entry) return [];
			try {
				return entry.getModels();
			} catch {
				return [];
			}
		}
		const models = [];
		for (const entry of this.providers.values()) try {
			models.push(...entry.getModels());
		} catch {}
		return models;
	}
	getAllModels(provider) {
		if (provider !== void 0) {
			const entry = this.providers.get(provider);
			if (!entry) return [];
			try {
				return entry.getAllModels?.() ?? entry.getModels();
			} catch {
				return [];
			}
		}
		const models = [];
		for (const entry of this.providers.values()) try {
			models.push(...entry.getAllModels?.() ?? entry.getModels());
		} catch {}
		return models;
	}
	getModelsOfType(type, provider) {
		return this.getAllModels(provider).filter((model) => isModelType(model, type));
	}
	getModel(provider, id) {
		return this.getModels(provider).find((model) => model.id === id);
	}
	getModelOfType(type, provider, id) {
		return this.getModelsOfType(type, provider).find((model) => model.id === id);
	}
	supersedeProviderRefresh(providerId) {
		const generation = (this.refreshGenerations.get(providerId) ?? 0) + 1;
		this.refreshGenerations.set(providerId, generation);
		const previous = this.refreshControllers.get(providerId);
		if (previous) {
			this.refreshControllers.delete(providerId);
			previous.abort();
		}
		return generation;
	}
	beginProviderRefresh(providerId) {
		const generation = this.supersedeProviderRefresh(providerId);
		const controller = new AbortController();
		this.refreshControllers.set(providerId, controller);
		return {
			generation,
			controller
		};
	}
	publishProviderModels(providerId, generation, signal, publication) {
		const previous = this.publicationChains.get(providerId) ?? Promise.resolve();
		const queued = (async () => {
			await previous.catch(() => {});
			if (signal.aborted || this.refreshGenerations.get(providerId) !== generation) return false;
			if (publication.persist === null) await this.modelsStore.delete(providerId, { signal });
			else if (publication.persist !== void 0) await this.modelsStore.write(providerId, structuredClone(publication.persist), { signal });
			if (signal.aborted || this.refreshGenerations.get(providerId) !== generation) return false;
			publication.update?.();
			return true;
		})();
		const tail = queued.catch(() => {});
		this.publicationChains.set(providerId, tail);
		tail.then(() => {
			if (this.publicationChains.get(providerId) === tail) this.publicationChains.delete(providerId);
		});
		return raceWithAbortSignal(queued, signal);
	}
	async runProviderRefreshPhase(provider, credential, allowNetwork, force, generation, signal) {
		const stored = await this.modelsStore.read(provider.id, { signal });
		await provider.refreshModels({
			credential,
			stored: stored ? withKnownModelTypes(structuredClone(stored)) : void 0,
			publish: (publication) => this.publishProviderModels(provider.id, generation, signal, publication),
			allowNetwork,
			force: allowNetwork ? force : void 0,
			signal
		});
	}
	async refresh(options = {}) {
		const allowNetwork = options.allowNetwork ?? true;
		const callerSignal = operationSignal(options.signal);
		const errors = /* @__PURE__ */ new Map();
		if (callerSignal.aborted) return {
			aborted: true,
			errors
		};
		const selected = options.providers ? new Set(options.providers) : void 0;
		const refreshable = Array.from(this.providers.values()).filter((provider) => provider.refreshModels !== void 0 && (!selected || selected.has(provider.id)));
		const refresh = Promise.all(refreshable.map(async (provider) => {
			const { generation, controller } = this.beginProviderRefresh(provider.id);
			const signal = AbortSignal.any([callerSignal, controller.signal]);
			const operation = (async () => {
				let storedCredential;
				let credentialError;
				try {
					storedCredential = await this.readCredential(provider.id, signal);
				} catch (error) {
					credentialError = error;
				}
				await this.runProviderRefreshPhase(provider, storedCredential, false, void 0, generation, signal);
				if (credentialError !== void 0) throw credentialError;
				if (!allowNetwork || signal.aborted) return;
				const credential = await this.resolveRefreshCredential(provider, storedCredential, signal);
				if (!credential) return;
				await this.runProviderRefreshPhase(provider, credential, true, options.force, generation, signal);
			})();
			try {
				await raceWithAbortSignal(operation, signal);
			} catch (error) {
				if (!signal.aborted) errors.set(provider.id, error instanceof Error ? error : new ModelsError("model_source", `Model refresh failed for ${provider.id}`, { cause: error }));
			} finally {
				if (this.refreshControllers.get(provider.id) === controller) this.refreshControllers.delete(provider.id);
			}
		}));
		try {
			await raceWithAbortSignal(refresh, callerSignal);
		} catch (error) {
			if (!callerSignal.aborted) throw error;
		}
		return {
			aborted: callerSignal.aborted,
			errors: new Map(errors)
		};
	}
	async resolveRefreshCredential(provider, stored, signal) {
		if (stored?.type === "oauth") {
			const oauth = provider.auth.oauth;
			if (!oauth) return void 0;
			if (Date.now() < stored.expires) return stored;
			if (signal.aborted) return void 0;
			const post = await this.credentials.modify(provider.id, async (current) => {
				if (current?.type !== "oauth" || Date.now() < current.expires) return void 0;
				return oauth.refresh(current, signal);
			}, { signal });
			return post?.type === "oauth" ? post : void 0;
		}
		const apiKey = provider.auth.apiKey;
		if (!apiKey) return void 0;
		const credential = stored?.type === "api_key" ? stored : void 0;
		const result = await apiKey.resolve({
			ctx: this.authContext,
			credential,
			signal
		});
		if (!result) return void 0;
		return {
			type: "api_key",
			key: result.auth.apiKey,
			env: result.env
		};
	}
	async readCredential(providerId, signal) {
		try {
			return await this.credentials.read(providerId, { signal });
		} catch (error) {
			throw new ModelsError("auth", `Credential store read failed for ${providerId}`, { cause: error });
		}
	}
	async checkProviderAuth(provider, credential, signal) {
		if (credential?.type === "oauth") return provider.auth.oauth ? {
			source: "OAuth",
			type: "oauth"
		} : void 0;
		const apiKey = provider.auth.apiKey;
		if (!apiKey) return void 0;
		if (apiKey.check) try {
			return await apiKey.check({
				ctx: this.authContext,
				credential: credential?.type === "api_key" ? credential : void 0,
				signal
			});
		} catch (error) {
			throw new ModelsError("auth", `API key auth check failed for provider ${provider.id}`, { cause: error });
		}
		const resolution = await resolveProviderAuth(provider, this.credentials, this.authContext, { signal });
		return resolution ? {
			source: resolution.source,
			type: "api_key"
		} : void 0;
	}
	checkAuth(providerId, options) {
		const signal = operationSignal(options?.signal);
		return raceWithAbortSignal((async () => {
			signal.throwIfAborted();
			const provider = this.providers.get(providerId);
			if (!provider) return void 0;
			return this.checkProviderAuth(provider, await this.readCredential(providerId, signal), signal);
		})(), signal);
	}
	async getAuthenticatedProviders(providerId, signal) {
		signal.throwIfAborted();
		const providers = providerId ? [this.providers.get(providerId)].filter((entry) => entry !== void 0) : this.getProviders();
		return (await Promise.all(providers.map(async (provider) => {
			const credential = await this.readCredential(provider.id, signal);
			return {
				provider,
				credential,
				auth: await this.checkProviderAuth(provider, credential, signal)
			};
		}))).filter((entry) => entry.auth !== void 0);
	}
	getAvailable(providerId, options) {
		const signal = operationSignal(options?.signal);
		return raceWithAbortSignal((async () => {
			return (await this.getAuthenticatedProviders(providerId, signal)).flatMap(({ provider, credential }) => {
				const models = provider.getModels();
				return provider.filterModels?.(models, credential) ?? models;
			});
		})(), signal);
	}
	async getAvailableOfType(type, providerId, options) {
		return (await this.getAllAvailable(providerId, options)).filter((model) => isModelType(model, type));
	}
	getAllAvailable(providerId, options) {
		const signal = operationSignal(options?.signal);
		return raceWithAbortSignal((async () => {
			return (await this.getAuthenticatedProviders(providerId, signal)).flatMap(({ provider, credential }) => {
				const models = provider.getAllModels?.() ?? provider.getModels();
				if (provider.filterAllModels) return provider.filterAllModels(models, credential);
				if (!provider.filterModels) return models;
				const availableChatIds = new Set(provider.filterModels(provider.getModels(), credential).map((model) => model.id));
				return models.filter((model) => !isModelType(model, "chat") || availableChatIds.has(model.id));
			});
		})(), signal);
	}
	async getAuth(providerOrModel, overrides) {
		const signal = operationSignal(overrides?.signal);
		const providerId = typeof providerOrModel === "string" ? providerOrModel : providerOrModel.provider;
		const provider = this.providers.get(providerId);
		if (!provider) return void 0;
		const result = await resolveProviderAuth(provider, this.credentials, this.authContext, {
			...overrides,
			signal
		});
		if (!result || typeof providerOrModel === "string" || !providerOrModel.headers) return result;
		return {
			...result,
			auth: {
				...result.auth,
				headers: mergeHeaders(result.auth.headers, providerOrModel.headers)
			}
		};
	}
	async login(providerId, type, interaction, options) {
		const signal = operationSignal(interaction.signal);
		signal.throwIfAborted();
		const provider = this.providers.get(providerId);
		if (!provider) throw new ModelsError("provider", `Unknown provider: ${providerId}`);
		const method = type === "oauth" ? provider.auth.oauth : provider.auth.apiKey;
		if (!method?.login) throw new ModelsError("auth", `${provider.name} does not support ${type} login`);
		const credential = await raceWithAbortSignal(method.login({
			...interaction,
			signal
		}, options), signal);
		let mutationStarted = false;
		let markMutationStarted;
		const started = new Promise((resolve) => {
			markMutationStarted = resolve;
		});
		const mutation = this.credentials.modify(providerId, async () => {
			mutationStarted = true;
			markMutationStarted?.();
			return credential;
		}, { signal });
		mutation.catch(() => {});
		try {
			await new Promise((resolve, reject) => {
				const onAbort = () => {
					if (!mutationStarted) reject(signal.reason);
				};
				signal.addEventListener("abort", onAbort, { once: true });
				Promise.race([started, mutation]).then(() => {
					signal.removeEventListener("abort", onAbort);
					resolve();
				}, (error) => {
					signal.removeEventListener("abort", onAbort);
					reject(error);
				});
				if (signal.aborted) onAbort();
			});
			await mutation;
		} catch (error) {
			signal.throwIfAborted();
			throw new ModelsError("auth", `Credential store modify failed for ${providerId}`, { cause: error });
		}
		return credential;
	}
	async logout(providerId, options) {
		const signal = operationSignal(options?.signal);
		signal.throwIfAborted();
		try {
			await this.credentials.delete(providerId, { signal });
		} catch (error) {
			signal.throwIfAborted();
			throw new ModelsError("auth", `Credential store delete failed for ${providerId}`, { cause: error });
		}
	}
	requireProvider(model) {
		const provider = this.providers.get(model.provider);
		if (!provider) throw new ModelsError("provider", `Unknown provider: ${model.provider}`);
		return provider;
	}
	requireChatProvider(model) {
		assertChatModel(model);
		return this.requireProvider(model);
	}
	async applyAuth(model, options) {
		this.requireProvider(model);
		const resolution = await this.getAuth(model, {
			apiKey: options?.apiKey,
			env: options?.env,
			signal: options?.signal
		});
		if (!resolution) throw new ModelsError("auth", `Provider is not configured: ${model.provider}`);
		const auth = resolution.auth;
		const apiKey = options?.apiKey ?? auth.apiKey;
		let headers = mergeHeaders(auth.headers, options?.headers);
		if (options?.transformHeaders) headers = await options.transformHeaders(headers ?? {});
		const env = resolution.env || options?.env ? {
			...resolution.env ?? {},
			...options?.env ?? {}
		} : void 0;
		const requestModel = auth.baseUrl ? {
			...model,
			baseUrl: auth.baseUrl
		} : model;
		const { transformHeaders: _transformHeaders, ...providerOptions } = options ?? {};
		return {
			requestModel,
			requestOptions: {
				...providerOptions,
				apiKey,
				headers,
				env
			}
		};
	}
	stream(model, context, options) {
		const transcript = normalizeContext(context);
		return lazyStream(model, async () => {
			const provider = this.requireChatProvider(model);
			const { requestModel, requestOptions } = await this.applyAuth(model, options);
			return provider.stream(requestModel, transcript, requestOptions);
		});
	}
	async complete(model, context, options) {
		return this.stream(model, context, options).result();
	}
	streamSimple(model, context, options) {
		const transcript = normalizeContext(context);
		return lazyStream(model, async () => {
			const provider = this.requireChatProvider(model);
			const { requestModel, requestOptions } = await this.applyAuth(model, options);
			return provider.streamSimple(requestModel, transcript, requestOptions);
		});
	}
	async completeSimple(model, context, options) {
		return this.streamSimple(model, context, options).result();
	}
	streamDeferred(model, handle, options) {
		return lazyStream(model, async () => {
			const provider = this.requireChatProvider(model);
			if (!provider.fetchDeferred) throw new ModelsError("provider", `Provider ${model.provider} does not support deferred responses`);
			const { requestModel, requestOptions } = await this.applyAuth(model, options);
			return provider.fetchDeferred(requestModel, handle, requestOptions);
		});
	}
	async fetchDeferred(model, handle, options) {
		return this.streamDeferred(model, handle, options).result();
	}
	async cancelDeferred(model, handle, options) {
		const provider = this.requireChatProvider(model);
		if (!provider.cancelDeferred) throw new ModelsError("provider", `Provider ${model.provider} does not support deferred responses`);
		const { requestModel, requestOptions } = await this.applyAuth(model, options);
		await provider.cancelDeferred(requestModel, handle, requestOptions);
	}
	async generateImages(model, context, options) {
		try {
			assertImageModel(model);
			const provider = this.requireProvider(model);
			if (!provider.generateImages) throw new ModelsError("provider", `Provider ${model.provider} does not support image generation`);
			const { requestModel, requestOptions } = await this.applyAuth(model, options);
			return await provider.generateImages(requestModel, context, requestOptions);
		} catch (error) {
			return imageErrorResult(model, error, options?.signal?.aborted);
		}
	}
	async classify(model, context, options) {
		try {
			assertClassifierModel(model);
			const provider = this.requireProvider(model);
			if (!provider.classify) throw new ModelsError("provider", `Provider ${model.provider} does not support classification`);
			const { requestModel, requestOptions } = await this.applyAuth(model, options);
			return await provider.classify(requestModel, context, requestOptions);
		} catch (error) {
			return classifierErrorResult(model, error, options?.signal?.aborted);
		}
	}
};
function createModels(options) {
	return new ModelsImpl(options);
}
/**
* Builds a provider from parts. Built-in provider factories and models.json
* custom providers both go through this. A single `api` streams all chat
* models; an `api` map dispatches on `model.api`, and a model whose api has
* no entry produces a stream error. One-shot operation maps dispatch on
* `model.api` the same way. At least one concrete implementation across
* `api`/`images`/`classifiers` is required; empty maps are rejected.
*/
function createProvider(input) {
	const single = input.api && typeof input.api.stream === "function" ? input.api : void 0;
	const byApi = single || !input.api ? void 0 : input.api;
	const images = input.images;
	const classifiers = input.classifiers;
	const streams = single ? [single] : Object.values(byApi ?? {}).filter((entry) => entry !== void 0);
	const imageImplementations = Object.values(images ?? {}).filter((entry) => entry !== void 0);
	const classifierImplementations = Object.values(classifiers ?? {}).filter((entry) => entry !== void 0);
	if (streams.length === 0 && imageImplementations.length === 0 && classifierImplementations.length === 0) throw new Error(`Provider ${input.id}: at least one of "api", "images", or "classifiers" is required.`);
	const baselineModels = input.models;
	let dynamicModels = [];
	const fetchModels = input.fetchModels;
	const currentModels = () => {
		const merged = [...baselineModels];
		for (const model of dynamicModels) {
			const index = merged.findIndex((entry) => getModelType(entry) === getModelType(model) && entry.id === model.id);
			if (index >= 0) merged[index] = model;
			else merged.push(model);
		}
		return merged;
	};
	const apiFor = (model) => single ?? byApi?.[model.api];
	const dispatch = (model, run) => {
		const streams = apiFor(model);
		if (!streams) return lazyStream(model, async () => {
			throw new ModelsError("stream", `Provider ${input.id} has no API implementation for "${model.api}"`);
		});
		return run(streams);
	};
	const provider = {
		id: input.id,
		name: input.name ?? input.id,
		baseUrl: input.baseUrl,
		headers: input.headers,
		auth: input.auth,
		getModels: () => currentModels().filter((model) => isModelType(model, "chat")),
		getAllModels: currentModels,
		refreshModels: fetchModels ? async (context) => {
			if (context.stored) {
				const restored = context.stored.models.filter((model) => model.provider === input.id).map((model) => model);
				if (!await context.publish({ update: () => {
					dynamicModels = restored;
				} })) return;
			}
			if (!context.allowNetwork || context.signal.aborted) return;
			const fetched = await fetchModels(context);
			if (context.signal.aborted) return;
			const refreshed = fetched.filter(hasKnownModelType);
			await context.publish({
				persist: {
					models: refreshed,
					checkedAt: Date.now()
				},
				update: () => {
					dynamicModels = refreshed;
				}
			});
		} : void 0,
		filterModels: input.filterModels,
		filterAllModels: input.filterAllModels,
		stream: (model, context, options) => dispatch(model, (streams) => streams.stream(model, context, options)),
		streamSimple: (model, context, options) => dispatch(model, (streams) => streams.streamSimple(model, context, options))
	};
	if (streams.some((entry) => entry.fetchDeferred !== void 0)) provider.fetchDeferred = (model, handle, options) => lazyStream(model, async () => {
		const implementation = apiFor(model);
		if (!implementation?.fetchDeferred) throw new ModelsError("provider", `Provider ${input.id} does not support deferred responses for "${model.api}"`);
		return implementation.fetchDeferred(model, handle, options);
	});
	if (streams.some((entry) => entry.cancelDeferred !== void 0)) provider.cancelDeferred = async (model, handle, options) => {
		const implementation = apiFor(model);
		if (!implementation?.cancelDeferred) throw new ModelsError("provider", `Provider ${input.id} cannot cancel deferred responses for "${model.api}"`);
		await implementation.cancelDeferred(model, handle, options);
	};
	if (images && imageImplementations.length > 0) provider.generateImages = async (model, context, options) => {
		const implementation = images[model.api];
		if (!implementation) return imageErrorResult(model, new ModelsError("provider", `Provider ${input.id} has no image generation implementation for "${model.api}"`));
		return implementation.generateImages(model, context, options);
	};
	if (classifiers && classifierImplementations.length > 0) provider.classify = async (model, context, options) => {
		const implementation = classifiers[model.api];
		if (!implementation) return classifierErrorResult(model, new ModelsError("provider", `Provider ${input.id} has no classifier implementation for "${model.api}"`));
		return implementation.classify(model, context, options);
	};
	return provider;
}
function calculateCost(model, usage) {
	const inputTokens = usage.input + usage.cacheRead + usage.cacheWrite;
	let rates = model.cost;
	let matchedThreshold = -1;
	for (const tier of model.cost.tiers ?? []) if (inputTokens > tier.inputTokensAbove && tier.inputTokensAbove > matchedThreshold) {
		rates = tier;
		matchedThreshold = tier.inputTokensAbove;
	}
	const longWrite = usage.cacheWrite1h ?? 0;
	const shortWrite = usage.cacheWrite - longWrite;
	usage.cost.input = rates.input / 1e6 * usage.input;
	usage.cost.output = rates.output / 1e6 * usage.output;
	usage.cost.cacheRead = rates.cacheRead / 1e6 * usage.cacheRead;
	usage.cost.cacheWrite = (rates.cacheWrite * shortWrite + rates.input * 2 * longWrite) / 1e6;
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
	return usage.cost;
}
const EXTENDED_THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
function getSupportedThinkingLevels(model) {
	if (!model.reasoning) return ["off"];
	return EXTENDED_THINKING_LEVELS.filter((level) => {
		const mapped = model.thinkingLevelMap?.[level];
		if (mapped === null) return false;
		if (level === "xhigh" || level === "max") return mapped !== void 0;
		return true;
	});
}
function clampThinkingLevel(model, level) {
	const availableLevels = getSupportedThinkingLevels(model);
	if (availableLevels.includes(level)) return level;
	const requestedIndex = EXTENDED_THINKING_LEVELS.indexOf(level);
	if (requestedIndex === -1) return availableLevels[0] ?? "off";
	for (let i = requestedIndex; i < EXTENDED_THINKING_LEVELS.length; i++) {
		const candidate = EXTENDED_THINKING_LEVELS[i];
		if (availableLevels.includes(candidate)) return candidate;
	}
	for (let i = requestedIndex - 1; i >= 0; i--) {
		const candidate = EXTENDED_THINKING_LEVELS[i];
		if (availableLevels.includes(candidate)) return candidate;
	}
	return availableLevels[0] ?? "off";
}
//#endregion
export { lazyApi as _, getSupportedThinkingLevels as a, getDeclaredTools as c, normalizeContext as d, resolveTranscript as f, renderSystemMessageUpdate as g, getSystemMessageText as h, createProvider as i, getInitialSystemMessage as l, withoutInitialSystemMessage as m, clampThinkingLevel as n, collapseSystemMessages as o, resolveTranscriptTools as p, createModels as r, getCurrentTools as s, calculateCost as t, hasToolRedefinitions as u };
