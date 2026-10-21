import { h as getSystemMessageText } from "./models-4COJlt5Q.js";
//#region ../../../../node_modules/.pnpm/@earendil-works+pi-ai@1.0.0_71d8dfff7c0445882abb8c414f4fc20f/node_modules/@earendil-works/pi-ai/dist/utils/pi-user-agent.js
function loadNodeOs() {
	if (typeof process === "undefined" || !(process.versions?.node || process.versions?.bun)) return null;
	return process.getBuiltinModule?.("node:os") ?? null;
}
const nodeOs = loadNodeOs();
function getPiUserAgent() {
	return nodeOs ? `pi (${nodeOs.platform()} ${nodeOs.release()}; ${nodeOs.arch()})` : "pi (browser)";
}
//#endregion
//#region ../../../../node_modules/.pnpm/@earendil-works+pi-ai@1.0.0_71d8dfff7c0445882abb8c414f4fc20f/node_modules/@earendil-works/pi-ai/dist/api/constrained-sampling.js
var UnsupportedStrictJsonSchemaError = class extends Error {};
const UNSUPPORTED_STRICT_SCHEMA_KEYS = [
	"$ref",
	"$defs",
	"definitions",
	"allOf",
	"oneOf",
	"patternProperties",
	"dependentSchemas",
	"dependencies",
	"unevaluatedProperties",
	"propertyNames",
	"contains",
	"prefixItems",
	"not",
	"if",
	"then",
	"else"
];
function isJsonSchemaObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isStructuredSchema(schema) {
	if (!isJsonSchemaObject(schema)) return false;
	const types = typeof schema.type === "string" ? [schema.type] : Array.isArray(schema.type) ? schema.type : [];
	return types.includes("object") || types.includes("array") || schema.properties !== void 0 || schema.items !== void 0;
}
function schemaAllowsNull(schema) {
	if (!isJsonSchemaObject(schema)) return false;
	if (schema.type === "null" || Array.isArray(schema.type) && schema.type.includes("null")) return true;
	if (schema.const === null || Array.isArray(schema.enum) && schema.enum.includes(null)) return true;
	return Array.isArray(schema.anyOf) && schema.anyOf.some((variant) => schemaAllowsNull(variant));
}
function makeJsonSchemaNodeStrict(schema, isUnsupportedKeyword) {
	if (!isJsonSchemaObject(schema)) throw new UnsupportedStrictJsonSchemaError("boolean schemas are unsupported");
	for (const key of UNSUPPORTED_STRICT_SCHEMA_KEYS) if (schema[key] !== void 0) throw new UnsupportedStrictJsonSchemaError(`${key} schemas are unsupported`);
	if (isUnsupportedKeyword) {
		for (const [key, value] of Object.entries(schema)) if (isUnsupportedKeyword(key, value)) throw new UnsupportedStrictJsonSchemaError(`${key}: ${JSON.stringify(value)} is unsupported`);
	}
	if (schema.anyOf !== void 0) {
		if (!Array.isArray(schema.anyOf) || schema.anyOf.length === 0) throw new UnsupportedStrictJsonSchemaError("anyOf must contain at least one schema");
		for (const variant of schema.anyOf) {
			if (isStructuredSchema(variant)) throw new UnsupportedStrictJsonSchemaError("object and array unions are unsupported");
			makeJsonSchemaNodeStrict(variant, isUnsupportedKeyword);
		}
	}
	if (schema.items !== void 0) {
		if (Array.isArray(schema.items)) throw new UnsupportedStrictJsonSchemaError("tuple schemas are unsupported");
		makeJsonSchemaNodeStrict(schema.items, isUnsupportedKeyword);
	}
	const isObjectSchema = schema.type === "object";
	if (schema.properties !== void 0 && !isObjectSchema) throw new UnsupportedStrictJsonSchemaError("properties require type object");
	if (!isObjectSchema) return;
	if (schema.additionalProperties !== void 0 && schema.additionalProperties !== false) throw new UnsupportedStrictJsonSchemaError("schema-valued or true additionalProperties is unsupported");
	if (schema.properties !== void 0 && !isJsonSchemaObject(schema.properties)) throw new UnsupportedStrictJsonSchemaError("object properties must be a schema map");
	if (schema.required !== void 0 && (!Array.isArray(schema.required) || schema.required.some((key) => typeof key !== "string"))) throw new UnsupportedStrictJsonSchemaError("object required must be a string array");
	const properties = schema.properties ?? {};
	const propertyNames = Object.keys(properties);
	const required = new Set(Array.isArray(schema.required) ? schema.required : []);
	if ([...required].some((key) => !propertyNames.includes(key))) throw new UnsupportedStrictJsonSchemaError("required contains an unknown property");
	for (const [key, property] of Object.entries(properties)) {
		makeJsonSchemaNodeStrict(property, isUnsupportedKeyword);
		if (!required.has(key) && !schemaAllowsNull(property)) properties[key] = { anyOf: [property, { type: "null" }] };
	}
	schema.required = propertyNames;
	schema.additionalProperties = false;
}
/** Convert a tool schema to the strict subset expected by provider constrained sampling. */
function makeStrictJsonSchema(schema, isUnsupportedKeyword) {
	const cloned = structuredClone(schema);
	if (!isJsonSchemaObject(cloned)) throw new UnsupportedStrictJsonSchemaError("root schema must have type object");
	makeJsonSchemaNodeStrict(cloned, isUnsupportedKeyword);
	if (cloned.type !== "object") throw new UnsupportedStrictJsonSchemaError("root schema must have type object");
	return cloned;
}
function getJsonSchemaToolParameters(tool, strict) {
	return strict === true ? makeStrictJsonSchema(tool.parameters) : tool.parameters;
}
function getGrammarToolInput(toolName, arguments_, inputProperty) {
	const input = arguments_[inputProperty];
	if (typeof input !== "string") throw new Error(`Grammar tool call "${toolName}" requires argument "${inputProperty}" to be a string.`);
	return input;
}
function appendGrammarToolInputJsonDelta(buffer, inputProperty, nextInput, close) {
	if (buffer.closed) {
		if (close && nextInput === buffer.input) return void 0;
		throw new Error(`grammar tool input for property "${inputProperty}" changed after it was closed`);
	}
	if (!nextInput.startsWith(buffer.input)) throw new Error(`grammar tool input for property "${inputProperty}" changed non-monotonically`);
	const inputDelta = nextInput.slice(buffer.input.length);
	if (!close && inputDelta.length === 0) return void 0;
	let delta = "";
	if (!buffer.started) {
		delta += `{${JSON.stringify(inputProperty)}:"`;
		buffer.started = true;
	}
	delta += JSON.stringify(inputDelta).slice(1, -1);
	buffer.input = nextInput;
	if (close) {
		delta += "\"}";
		buffer.closed = true;
	}
	return delta;
}
function inferGrammarInputProperty(tool) {
	const schema = tool.parameters;
	if (schema.type !== "object") throw new Error("grammar constrained sampling requires an object parameter schema");
	if (!Array.isArray(schema.required) || schema.required.length !== 1 || typeof schema.required[0] !== "string") throw new Error("grammar constrained sampling requires exactly one required string property");
	const inputProperty = schema.required[0];
	if (!schema.properties?.[inputProperty]) throw new Error(`grammar constrained sampling requires a properties entry for ${inputProperty}`);
	if (schema.properties[inputProperty]?.type !== "string") throw new Error(`grammar constrained sampling property ${inputProperty} must have type string`);
	return inputProperty;
}
/**
* Decide whether a JSON-schema tool is sent in strict mode. `isUnsupportedKeyword` lets a provider
* reject extra keywords its strict mode does not accept, so "prefer" tools fall back to non-strict.
*/
function resolveJsonSchemaStrictSampling(tool, supportsStrictMode, isUnsupportedKeyword) {
	const config = tool.constrainedSampling;
	if (!config || config.type !== "json_schema") return void 0;
	if (supportsStrictMode) try {
		makeStrictJsonSchema(tool.parameters, isUnsupportedKeyword);
		return true;
	} catch (error) {
		if (!(error instanceof UnsupportedStrictJsonSchemaError)) throw error;
		if (config.strict !== "require") return void 0;
		throw new Error(`Tool "${tool.name}" requires JSON-schema constrained sampling, but ${error.message}.`);
	}
	if (config.strict === "require") throw new Error(`Tool "${tool.name}" requires JSON-schema constrained sampling, but strict tools are unsupported.`);
}
function resolveGrammarConstrainedSampling(tool, supportsOpenAIGrammarTools) {
	const config = tool.constrainedSampling;
	if (!config || config.type !== "grammar") return;
	if (!supportsOpenAIGrammarTools) return;
	const larkDefinition = config.variants.openai_lark;
	const regexDefinition = config.variants.openai_regex;
	const hasLarkDefinition = typeof larkDefinition === "string" && larkDefinition.trim().length > 0;
	const hasRegexDefinition = typeof regexDefinition === "string" && regexDefinition.trim().length > 0;
	if (!hasLarkDefinition && !hasRegexDefinition) throw new Error(`Tool "${tool.name}" cannot use grammar constrained sampling: no supported grammar variant was provided.`);
	try {
		return {
			format: hasLarkDefinition ? "lark" : "regex",
			definition: hasLarkDefinition ? larkDefinition : regexDefinition,
			inputProperty: inferGrammarInputProperty(tool)
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Tool "${tool.name}" cannot use grammar constrained sampling: ${message}.`);
	}
}
function createGrammarToolInputProperties(tools, supportsOpenAIGrammarTools) {
	const properties = /* @__PURE__ */ new Map();
	for (const tool of tools ?? []) {
		const grammar = resolveGrammarConstrainedSampling(tool, supportsOpenAIGrammarTools);
		if (grammar) properties.set(tool.name, grammar.inputProperty);
	}
	return properties;
}
//#endregion
//#region ../../../../node_modules/.pnpm/@earendil-works+pi-ai@1.0.0_71d8dfff7c0445882abb8c414f4fc20f/node_modules/@earendil-works/pi-ai/dist/utils/estimate.js
const CHARS_PER_TOKEN = 4;
const ESTIMATED_IMAGE_CHARS = 4800;
function calculateContextTokens(usage) {
	return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}
function safeJsonStringify(value) {
	try {
		return JSON.stringify(value) ?? "undefined";
	} catch {
		return "[unserializable]";
	}
}
function estimateTextAndImageContentChars(content) {
	if (typeof content === "string") return content.length;
	let chars = 0;
	for (const block of content) chars += block.type === "text" ? block.text.length : ESTIMATED_IMAGE_CHARS;
	return chars;
}
function estimateTextTokens(text) {
	return Math.ceil(text.length / CHARS_PER_TOKEN);
}
function estimateTextAndImageContentTokens(content) {
	return Math.ceil(estimateTextAndImageContentChars(content) / CHARS_PER_TOKEN);
}
function estimateMessageTokens(message) {
	let chars = 0;
	if (message.role === "system") return estimateTextTokens(getSystemMessageText(message)) + estimateToolsTokens(message.toolsAdded) + estimateToolsTokens(message.toolsRemoved);
	if (message.role === "user") return estimateTextAndImageContentTokens(message.content);
	if (message.role === "toolResult") return estimateTextAndImageContentTokens(message.content);
	for (const block of message.content) if (block.type === "text") chars += block.text.length;
	else if (block.type === "thinking") chars += block.thinking.length;
	else chars += block.name.length + safeJsonStringify(block.arguments).length;
	return Math.ceil(chars / CHARS_PER_TOKEN);
}
function getLastAssistantUsageInfo(messages) {
	let latestPrefixTimestamp = Number.NEGATIVE_INFINITY;
	let usageInfo;
	for (let i = 0; i < messages.length; i++) {
		const message = messages[i];
		if (message.role === "assistant") {
			const assistant = message;
			if (assistant.timestamp >= latestPrefixTimestamp && assistant.stopReason !== "aborted" && assistant.stopReason !== "error" && calculateContextTokens(assistant.usage) > 0) usageInfo = {
				usage: assistant.usage,
				index: i
			};
		}
		latestPrefixTimestamp = Math.max(latestPrefixTimestamp, message.timestamp);
	}
	return usageInfo;
}
function estimateContextTokens(context) {
	const messages = "messages" in context ? context.messages : context;
	const usageInfo = getLastAssistantUsageInfo(messages);
	if (usageInfo) {
		const usageTokens = calculateContextTokens(usageInfo.usage);
		let trailingTokens = 0;
		for (let i = usageInfo.index + 1; i < messages.length; i++) trailingTokens += estimateMessageTokens(messages[i]);
		return {
			tokens: usageTokens + trailingTokens,
			usageTokens,
			trailingTokens,
			lastUsageIndex: usageInfo.index
		};
	}
	let tokens = 0;
	for (const message of messages) tokens += estimateMessageTokens(message);
	return {
		tokens,
		usageTokens: 0,
		trailingTokens: tokens,
		lastUsageIndex: null
	};
}
function estimateToolsTokens(tools) {
	if (!tools || tools.length === 0) return 0;
	return estimateTextTokens(safeJsonStringify(tools));
}
//#endregion
//#region ../../../../node_modules/.pnpm/@earendil-works+pi-ai@1.0.0_71d8dfff7c0445882abb8c414f4fc20f/node_modules/@earendil-works/pi-ai/dist/api/simple-options.js
const CONTEXT_SAFETY_TOKENS = 4096;
const MIN_MAX_TOKENS = 1;
function clampMaxTokensToContext(model, context, maxTokens) {
	if (model.contextWindow <= 0) return Math.max(MIN_MAX_TOKENS, maxTokens);
	const available = model.contextWindow - estimateContextTokens(context).tokens - CONTEXT_SAFETY_TOKENS;
	return Math.min(maxTokens, Math.max(MIN_MAX_TOKENS, available));
}
function buildBaseOptions(model, context, options, apiKey) {
	return {
		temperature: options?.temperature,
		samplingParams: options?.samplingParams,
		maxTokens: clampMaxTokensToContext(model, context, options?.maxTokens ?? model.maxTokens),
		signal: options?.signal,
		telemetryContext: options?.telemetryContext,
		apiKey: apiKey || options?.apiKey,
		fetch: options?.fetch,
		transport: options?.transport,
		cacheRetention: options?.cacheRetention,
		sessionId: options?.sessionId,
		headers: options?.headers,
		onPayload: options?.onPayload,
		onResponse: options?.onResponse,
		onProviderStreamEvent: options?.onProviderStreamEvent,
		timeoutMs: options?.timeoutMs,
		websocketConnectTimeoutMs: options?.websocketConnectTimeoutMs,
		maxRetries: options?.maxRetries,
		maxRetryDelayMs: options?.maxRetryDelayMs,
		metadata: options?.metadata,
		env: options?.env
	};
}
/** Tokens always left for the answer when a thinking budget shares the response ceiling. */
const MIN_ANSWER_TOKENS = 1024;
const DEFAULT_THINKING_BUDGETS = {
	minimal: 1024,
	low: 2048,
	medium: 8192,
	high: 16384
};
function clampReasoning(effort) {
	return effort === "xhigh" || effort === "max" ? "high" : effort;
}
function thinkingBudgetForLevel(reasoningLevel, customBudgets) {
	return {
		...DEFAULT_THINKING_BUDGETS,
		...customBudgets
	}[clampReasoning(reasoningLevel)];
}
/** Cap a thinking budget so at least MIN_ANSWER_TOKENS remain under a shared response ceiling. */
function clampThinkingBudgetToAnswerRoom(thinkingBudget, ceiling) {
	return Math.min(thinkingBudget, Math.max(0, ceiling - MIN_ANSWER_TOKENS));
}
function adjustMaxTokensForThinking(baseMaxTokens, modelMaxTokens, reasoningLevel, customBudgets) {
	let thinkingBudget = thinkingBudgetForLevel(reasoningLevel, customBudgets);
	const maxTokens = baseMaxTokens === void 0 ? modelMaxTokens : Math.min(baseMaxTokens + thinkingBudget, modelMaxTokens);
	if (maxTokens <= thinkingBudget) thinkingBudget = clampThinkingBudgetToAnswerRoom(thinkingBudget, maxTokens);
	return {
		maxTokens,
		thinkingBudget
	};
}
//#endregion
//#region ../../../../node_modules/.pnpm/@earendil-works+pi-ai@1.0.0_71d8dfff7c0445882abb8c414f4fc20f/node_modules/@earendil-works/pi-ai/dist/api/transform-messages.js
const NON_VISION_USER_IMAGE_PLACEHOLDER = "(image omitted: model does not support images)";
const NON_VISION_TOOL_IMAGE_PLACEHOLDER = "(tool image omitted: model does not support images)";
function replaceImagesWithPlaceholder(content, placeholder) {
	const result = [];
	let previousWasPlaceholder = false;
	for (const block of content) {
		if (block.type === "image") {
			if (!previousWasPlaceholder) result.push({
				type: "text",
				text: placeholder
			});
			previousWasPlaceholder = true;
			continue;
		}
		result.push(block);
		previousWasPlaceholder = block.text === placeholder;
	}
	return result;
}
function downgradeUnsupportedImages(messages, model) {
	if (model.input.includes("image")) return messages;
	return messages.map((msg) => {
		if (msg.role === "user" && Array.isArray(msg.content)) return {
			...msg,
			content: replaceImagesWithPlaceholder(msg.content, NON_VISION_USER_IMAGE_PLACEHOLDER)
		};
		if (msg.role === "toolResult") return {
			...msg,
			content: replaceImagesWithPlaceholder(msg.content, NON_VISION_TOOL_IMAGE_PLACEHOLDER)
		};
		return msg;
	});
}
/**
* Normalize tool call ID for cross-provider compatibility.
* OpenAI Responses API generates IDs that are 450+ chars with special characters like `|`.
* Anthropic APIs require IDs matching ^[a-zA-Z0-9_-]+$ (max 64 chars).
*/
function transformMessages(messages, model, normalizeToolCallId) {
	const toolCallIdMap = /* @__PURE__ */ new Map();
	const transformed = downgradeUnsupportedImages(messages.map((msg) => msg.content == null ? {
		...msg,
		content: []
	} : msg), model).map((msg) => {
		if (msg.role === "system" || msg.role === "user") return msg;
		if (msg.role === "toolResult") {
			const normalizedId = toolCallIdMap.get(msg.toolCallId);
			if (normalizedId && normalizedId !== msg.toolCallId) return {
				...msg,
				toolCallId: normalizedId
			};
			return msg;
		}
		if (msg.role === "assistant") {
			const assistantMsg = msg;
			const isSameModel = assistantMsg.provider === model.provider && assistantMsg.api === model.api && assistantMsg.model === model.id;
			const transformedContent = assistantMsg.content.flatMap((block) => {
				if (block.type === "thinking") {
					if (block.redacted) return isSameModel ? block : [];
					if (isSameModel && block.thinkingSignature) return block;
					if (!block.thinking || block.thinking.trim() === "") return [];
					if (isSameModel) return block;
					return {
						type: "text",
						text: block.thinking
					};
				}
				if (block.type === "text") {
					if (isSameModel) return block;
					return {
						type: "text",
						text: block.text
					};
				}
				if (block.type === "toolCall") {
					const toolCall = block;
					let normalizedToolCall = toolCall;
					if (!isSameModel && toolCall.thoughtSignature) {
						normalizedToolCall = { ...toolCall };
						delete normalizedToolCall.thoughtSignature;
					}
					if (!isSameModel && normalizeToolCallId) {
						const normalizedId = normalizeToolCallId(toolCall.id, model, assistantMsg);
						if (normalizedId !== toolCall.id) {
							toolCallIdMap.set(toolCall.id, normalizedId);
							normalizedToolCall = {
								...normalizedToolCall,
								id: normalizedId
							};
						}
					}
					return normalizedToolCall;
				}
				return block;
			});
			return {
				...assistantMsg,
				content: transformedContent
			};
		}
		return msg;
	});
	const result = [];
	let pendingToolCalls = [];
	let existingToolResultIds = /* @__PURE__ */ new Set();
	const heldSystemMessages = [];
	const closePendingToolCalls = () => {
		if (pendingToolCalls.length > 0) {
			for (const tc of pendingToolCalls) if (!existingToolResultIds.has(tc.id)) result.push({
				role: "toolResult",
				toolCallId: tc.id,
				toolName: tc.name,
				content: [{
					type: "text",
					text: "No result provided"
				}],
				isError: true,
				timestamp: Date.now()
			});
			pendingToolCalls = [];
			existingToolResultIds = /* @__PURE__ */ new Set();
		}
		result.push(...heldSystemMessages);
		heldSystemMessages.length = 0;
	};
	for (let i = 0; i < transformed.length; i++) {
		const msg = transformed[i];
		if (msg.role === "assistant") {
			closePendingToolCalls();
			const assistantMsg = msg;
			if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") continue;
			const toolCalls = assistantMsg.content.filter((b) => b.type === "toolCall");
			if (toolCalls.length > 0) {
				pendingToolCalls = toolCalls;
				existingToolResultIds = /* @__PURE__ */ new Set();
			}
			result.push(msg);
		} else if (msg.role === "toolResult") {
			existingToolResultIds.add(msg.toolCallId);
			result.push(msg);
		} else if (msg.role === "system") if (pendingToolCalls.length > 0) heldSystemMessages.push(msg);
		else result.push(msg);
		else if (msg.role === "user") {
			closePendingToolCalls();
			result.push(msg);
		} else result.push(msg);
	}
	closePendingToolCalls();
	return result;
}
//#endregion
export { clampThinkingBudgetToAnswerRoom as a, createGrammarToolInputProperties as c, resolveGrammarConstrainedSampling as d, resolveJsonSchemaStrictSampling as f, clampMaxTokensToContext as i, getGrammarToolInput as l, adjustMaxTokensForThinking as n, thinkingBudgetForLevel as o, getPiUserAgent as p, buildBaseOptions as r, appendGrammarToolInputJsonDelta as s, transformMessages as t, getJsonSchemaToolParameters as u };
