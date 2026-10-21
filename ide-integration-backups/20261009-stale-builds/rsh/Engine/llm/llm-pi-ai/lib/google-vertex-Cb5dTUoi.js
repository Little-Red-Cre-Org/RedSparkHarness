import { i as AssistantMessageEventStream } from "./diagnostics-nBA5pPq5.js";
import { h as getSystemMessageText, l as getInitialSystemMessage, n as clampThinkingLevel, o as collapseSystemMessages, s as getCurrentTools, t as calculateCost } from "./models-4COJlt5Q.js";
import { t as getProviderEnvValue } from "./provider-env-D6IsMTzC.js";
import { n as providerHeadersToRecord } from "./headers-Est0Pah9.js";
import { p as getPiUserAgent, r as buildBaseOptions } from "./transform-messages-CthSPk1V.js";
import { t as sanitizeSurrogates } from "./sanitize-unicode-Dgsx_2K2.js";
import { n as normalizeProviderError, t as formatProviderError } from "./error-body-CZID2ePw.js";
import { a as mapStopReason, c as retainThoughtSignature, d as toGoogleSdkThinkingLevel, f as toGoogleThinkingLevel, h as ResourceScope, i as isThinkingPart, l as retryGoogleRequest, m as GoogleGenAI, n as convertTools, o as resolveGoogleFunctionCallingMode, p as usesGoogleThinkingLevel, r as getDisabledGoogleThinkingConfig, s as resolveGoogleThinkingLevel, t as convertMessages, u as supportsGoogleStrictToolSampling } from "./google-shared-C-ObXKyn.js";
//#region ../../../../node_modules/.pnpm/@earendil-works+pi-ai@1.0.0_71d8dfff7c0445882abb8c414f4fc20f/node_modules/@earendil-works/pi-ai/dist/api/google-vertex.js
const API_VERSION = "v1";
const GCP_VERTEX_CREDENTIALS_MARKER = "gcp-vertex-credentials";
let toolCallCounter = 0;
const stream = (model, context, options) => {
	const stream = new AssistantMessageEventStream();
	const normalizedContext = collapseSystemMessages(context);
	(async () => {
		const output = {
			role: "assistant",
			content: [],
			api: "google-vertex",
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
			stopReason: "pending",
			timestamp: Date.now()
		};
		try {
			if (options?.fetch && options.fetch !== globalThis.fetch) throw new Error("Custom fetch is not supported by the Google Vertex adapter");
			const apiKey = resolveApiKey(options);
			const client = apiKey ? createClientWithApiKey(model, apiKey, options?.headers) : createClient(model, resolveProject(options), resolveLocation(options), options?.headers, options?.env);
			let params = buildParams(model, normalizedContext, options);
			const nextParams = await options?.onPayload?.(params, model);
			if (nextParams !== void 0) params = nextParams;
			const googleStream = await retryGoogleRequest(() => client.models.generateContentStream(params), options);
			stream.push({
				type: "start",
				partial: output
			});
			let currentBlock = null;
			const blocks = output.content;
			const blockIndex = () => blocks.length - 1;
			for await (const chunk of googleStream) {
				await options?.onProviderStreamEvent?.(chunk, model);
				output.responseId ||= chunk.responseId;
				const candidate = chunk.candidates?.[0];
				if (candidate?.content?.parts) for (const part of candidate.content.parts) {
					if (part.text !== void 0) {
						const isThinking = isThinkingPart(part);
						if (!currentBlock || isThinking && currentBlock.type !== "thinking" || !isThinking && currentBlock.type !== "text") {
							if (currentBlock) if (currentBlock.type === "text") stream.push({
								type: "text_end",
								contentIndex: blocks.length - 1,
								content: currentBlock.text,
								partial: output
							});
							else stream.push({
								type: "thinking_end",
								contentIndex: blockIndex(),
								content: currentBlock.thinking,
								partial: output
							});
							if (isThinking) {
								currentBlock = {
									type: "thinking",
									thinking: "",
									thinkingSignature: void 0
								};
								output.content.push(currentBlock);
								stream.push({
									type: "thinking_start",
									contentIndex: blockIndex(),
									partial: output
								});
							} else {
								currentBlock = {
									type: "text",
									text: ""
								};
								output.content.push(currentBlock);
								stream.push({
									type: "text_start",
									contentIndex: blockIndex(),
									partial: output
								});
							}
						}
						if (currentBlock.type === "thinking") {
							currentBlock.thinking += part.text;
							currentBlock.thinkingSignature = retainThoughtSignature(currentBlock.thinkingSignature, part.thoughtSignature);
							stream.push({
								type: "thinking_delta",
								contentIndex: blockIndex(),
								delta: part.text,
								partial: output
							});
						} else {
							currentBlock.text += part.text;
							currentBlock.textSignature = retainThoughtSignature(currentBlock.textSignature, part.thoughtSignature);
							stream.push({
								type: "text_delta",
								contentIndex: blockIndex(),
								delta: part.text,
								partial: output
							});
						}
					}
					if (part.functionCall) {
						if (currentBlock) {
							if (currentBlock.type === "text") stream.push({
								type: "text_end",
								contentIndex: blockIndex(),
								content: currentBlock.text,
								partial: output
							});
							else stream.push({
								type: "thinking_end",
								contentIndex: blockIndex(),
								content: currentBlock.thinking,
								partial: output
							});
							currentBlock = null;
						}
						const providedId = part.functionCall.id;
						const toolCall = {
							type: "toolCall",
							id: !providedId || output.content.some((b) => b.type === "toolCall" && b.id === providedId) ? `${part.functionCall.name}_${Date.now()}_${++toolCallCounter}` : providedId,
							name: part.functionCall.name || "",
							arguments: part.functionCall.args ?? {},
							...part.thoughtSignature && { thoughtSignature: part.thoughtSignature }
						};
						output.content.push(toolCall);
						stream.push({
							type: "toolcall_start",
							contentIndex: blockIndex(),
							partial: output
						});
						stream.push({
							type: "toolcall_delta",
							contentIndex: blockIndex(),
							delta: JSON.stringify(toolCall.arguments),
							partial: output
						});
						stream.push({
							type: "toolcall_end",
							contentIndex: blockIndex(),
							toolCall,
							partial: output
						});
					}
				}
				if (candidate?.finishReason) {
					output.rawStopReason = candidate.finishReason;
					output.stopReason = mapStopReason(candidate.finishReason);
					if (output.content.some((b) => b.type === "toolCall") && output.stopReason === "stop") output.stopReason = "toolUse";
				}
				if (chunk.usageMetadata) {
					output.usage = {
						input: (chunk.usageMetadata.promptTokenCount || 0) - (chunk.usageMetadata.cachedContentTokenCount || 0),
						output: (chunk.usageMetadata.candidatesTokenCount || 0) + (chunk.usageMetadata.thoughtsTokenCount || 0),
						cacheRead: chunk.usageMetadata.cachedContentTokenCount || 0,
						cacheWrite: 0,
						reasoning: chunk.usageMetadata.thoughtsTokenCount || 0,
						totalTokens: chunk.usageMetadata.totalTokenCount || 0,
						cost: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							total: 0
						}
					};
					calculateCost(model, output.usage);
				}
			}
			if (currentBlock) if (currentBlock.type === "text") stream.push({
				type: "text_end",
				contentIndex: blockIndex(),
				content: currentBlock.text,
				partial: output
			});
			else stream.push({
				type: "thinking_end",
				contentIndex: blockIndex(),
				content: currentBlock.thinking,
				partial: output
			});
			if (options?.signal?.aborted) throw new Error("Request was aborted");
			if (output.stopReason === "pending") throw new Error("Google Vertex stream ended without a finish reason");
			if (output.stopReason === "aborted" || output.stopReason === "error") {
				const errorMessage = output.rawStopReason ? `Provider stopped with: ${output.rawStopReason}` : "An unknown error occurred";
				throw new Error(errorMessage);
			}
			stream.push({
				type: "done",
				reason: output.stopReason,
				message: output
			});
			stream.end();
		} catch (error) {
			for (const block of output.content) if ("index" in block) delete block.index;
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = formatProviderError(normalizeProviderError(error));
			stream.push({
				type: "error",
				reason: output.stopReason,
				error: output
			});
			stream.end();
		}
	})();
	return stream;
};
const streamSimple = (model, context, options) => {
	const base = {
		...buildBaseOptions(model, context, options, void 0),
		toolChoice: options?.toolChoice
	};
	if (!options?.reasoning) return stream(model, context, {
		...base,
		thinking: { enabled: false }
	});
	const clampedReasoning = clampThinkingLevel(model, options.reasoning);
	if (clampedReasoning === "off") return stream(model, context, {
		...base,
		thinking: { enabled: false }
	});
	const resolvedLevel = resolveGoogleThinkingLevel(model, clampedReasoning);
	if (usesGoogleThinkingLevel(model)) return stream(model, context, {
		...base,
		thinking: {
			enabled: true,
			level: toGoogleThinkingLevel(resolvedLevel)
		}
	});
	return stream(model, context, {
		...base,
		thinking: {
			enabled: true,
			budgetTokens: getGoogleBudget(model, resolvedLevel, options.thinkingBudgets)
		}
	});
};
function createClient(model, project, location, optionsHeaders, env) {
	const googleAuthOptions = buildGoogleAuthOptions(env);
	return new GoogleGenAI({
		vertexai: true,
		project,
		location,
		apiVersion: API_VERSION,
		...googleAuthOptions ? { googleAuthOptions } : {},
		httpOptions: buildHttpOptions(model, optionsHeaders)
	});
}
function createClientWithApiKey(model, apiKey, optionsHeaders) {
	return new GoogleGenAI({
		vertexai: true,
		apiKey,
		apiVersion: API_VERSION,
		httpOptions: buildHttpOptions(model, optionsHeaders)
	});
}
function buildHttpOptions(model, optionsHeaders) {
	const httpOptions = {};
	const baseUrl = resolveCustomBaseUrl(model.baseUrl);
	if (baseUrl) {
		httpOptions.baseUrl = baseUrl;
		httpOptions.baseUrlResourceScope = ResourceScope.COLLECTION;
		if (baseUrlIncludesApiVersion(baseUrl)) httpOptions.apiVersion = "";
	}
	const headers = providerHeadersToRecord({
		"User-Agent": getPiUserAgent(),
		...model.headers,
		...optionsHeaders
	});
	if (headers) httpOptions.headers = headers;
	return Object.keys(httpOptions).length > 0 ? httpOptions : void 0;
}
function resolveCustomBaseUrl(baseUrl) {
	const trimmed = baseUrl.trim();
	if (!trimmed || trimmed.includes("{location}")) return;
	return trimmed;
}
function baseUrlIncludesApiVersion(baseUrl) {
	try {
		return new URL(baseUrl).pathname.split("/").some((part) => /^v\d+(?:beta\d*)?$/.test(part));
	} catch {
		return /(?:^|\/)v\d+(?:beta\d*)?(?:\/|$)/.test(baseUrl);
	}
}
function buildGoogleAuthOptions(env) {
	const keyFilename = getProviderEnvValue("GOOGLE_APPLICATION_CREDENTIALS", env);
	return keyFilename ? { keyFilename } : void 0;
}
function resolveApiKey(options) {
	const apiKey = options?.apiKey?.trim();
	if (!apiKey || apiKey === GCP_VERTEX_CREDENTIALS_MARKER || isPlaceholderApiKey(apiKey)) return;
	return apiKey;
}
function isPlaceholderApiKey(apiKey) {
	return /^<[^>]+>$/.test(apiKey);
}
function resolveProject(options) {
	const project = options?.project || getProviderEnvValue("GOOGLE_CLOUD_PROJECT", options?.env) || getProviderEnvValue("GCLOUD_PROJECT", options?.env);
	if (!project) throw new Error("Vertex AI requires a project ID. Set GOOGLE_CLOUD_PROJECT/GCLOUD_PROJECT or pass project in options.");
	return project;
}
function resolveLocation(options) {
	const location = options?.location || getProviderEnvValue("GOOGLE_CLOUD_LOCATION", options?.env);
	if (!location) throw new Error("Vertex AI requires a location. Set GOOGLE_CLOUD_LOCATION or pass location in options.");
	return location;
}
function buildParams(model, context, options = {}) {
	const contents = convertMessages(model, context);
	const initialSystemMessage = getInitialSystemMessage(context.messages);
	const currentTools = getCurrentTools(context.messages);
	const generationConfig = {};
	if (options.temperature !== void 0) generationConfig.temperature = options.temperature;
	if (options.maxTokens !== void 0) generationConfig.maxOutputTokens = options.maxTokens;
	const supportsStrictMode = supportsGoogleStrictToolSampling(model.id);
	const functionCallingMode = currentTools.length > 0 ? resolveGoogleFunctionCallingMode(currentTools, options.toolChoice, supportsStrictMode) : void 0;
	const systemInstruction = initialSystemMessage ? getSystemMessageText(initialSystemMessage) : "";
	const config = {
		...Object.keys(generationConfig).length > 0 && generationConfig,
		...systemInstruction && { systemInstruction: sanitizeSurrogates(systemInstruction) },
		...currentTools.length > 0 && { tools: convertTools(currentTools, false, supportsStrictMode) },
		...functionCallingMode !== void 0 && { toolConfig: { functionCallingConfig: { mode: functionCallingMode } } }
	};
	if (options.thinking?.enabled && model.reasoning) {
		const thinkingConfig = { includeThoughts: true };
		if (options.thinking.level !== void 0) thinkingConfig.thinkingLevel = toGoogleSdkThinkingLevel(options.thinking.level);
		else if (options.thinking.budgetTokens !== void 0) thinkingConfig.thinkingBudget = options.thinking.budgetTokens;
		config.thinkingConfig = thinkingConfig;
	} else if (model.reasoning && options.thinking && !options.thinking.enabled) config.thinkingConfig = getDisabledGoogleThinkingConfig(model);
	if (options.signal) {
		if (options.signal.aborted) throw new Error("Request aborted");
		config.abortSignal = options.signal;
	}
	return {
		model: model.id,
		contents,
		config
	};
}
function getGoogleBudget(model, level, customBudgets) {
	if (customBudgets?.[level] !== void 0) return customBudgets[level];
	if (model.id.includes("2.5-pro")) return {
		minimal: 128,
		low: 2048,
		medium: 8192,
		high: 32768
	}[level];
	if (model.id.includes("2.5-flash")) return {
		minimal: 128,
		low: 2048,
		medium: 8192,
		high: 24576
	}[level];
	return -1;
}
//#endregion
export { stream, streamSimple };
