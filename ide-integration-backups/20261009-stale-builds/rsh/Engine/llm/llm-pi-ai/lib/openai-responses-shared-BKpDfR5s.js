import { f as resolveTranscript, g as renderSystemMessageUpdate, h as getSystemMessageText, p as resolveTranscriptTools, t as calculateCost } from "./models-4COJlt5Q.js";
import { n as parseStreamingJson } from "./json-parse-VN4g0bD5.js";
import { d as resolveGrammarConstrainedSampling, f as resolveJsonSchemaStrictSampling, l as getGrammarToolInput, s as appendGrammarToolInputJsonDelta, t as transformMessages, u as getJsonSchemaToolParameters } from "./transform-messages-CthSPk1V.js";
import { t as sanitizeSurrogates } from "./sanitize-unicode-Dgsx_2K2.js";
import { t as shortHash } from "./hash-BTTuiZ50.js";
//#region ../../../../node_modules/.pnpm/@earendil-works+pi-ai@1.0.0_71d8dfff7c0445882abb8c414f4fc20f/node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js
function encodeTextSignatureV1(id, phase) {
	const payload = {
		v: 1,
		id
	};
	if (phase) payload.phase = phase;
	return JSON.stringify(payload);
}
function parseTextSignature(signature) {
	if (!signature) return void 0;
	if (signature.startsWith("{")) try {
		const parsed = JSON.parse(signature);
		if (parsed.v === 1 && typeof parsed.id === "string") {
			if (parsed.phase === "commentary" || parsed.phase === "final_answer") return {
				id: parsed.id,
				phase: parsed.phase
			};
			return { id: parsed.id };
		}
	} catch {}
	return { id: signature };
}
function convertToolResultOutput(model, content) {
	const textResult = content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
	const images = content.filter((c) => c.type === "image");
	const hasText = textResult.length > 0;
	if (images.length === 0 || !model.input.includes("image")) return sanitizeSurrogates(hasText ? textResult : images.length > 0 ? "(see attached image)" : "(no tool output)");
	const output = [];
	if (hasText) output.push({
		type: "input_text",
		text: sanitizeSurrogates(textResult)
	});
	for (const image of images) output.push({
		type: "input_image",
		detail: "auto",
		image_url: `data:${image.mimeType};base64,${image.data}`
	});
	return output;
}
function convertResponsesMessages(model, context, allowedToolCallProviders, options) {
	const normalizedContext = resolveTranscript(context, options?.supportsMidConvoSystemMessages);
	const messages = [];
	const normalizeIdPart = (part) => {
		const sanitized = part.replace(/[^a-zA-Z0-9_-]/g, "_");
		return (sanitized.length > 64 ? sanitized.slice(0, 64) : sanitized).replace(/_+$/, "");
	};
	const buildForeignResponsesItemId = (itemId) => {
		const normalized = `fc_${shortHash(itemId)}`;
		return normalized.length > 64 ? normalized.slice(0, 64) : normalized;
	};
	const normalizeToolCallId = (id, _targetModel, source) => {
		if (!allowedToolCallProviders.has(model.provider)) return normalizeIdPart(id);
		if (!id.includes("|")) return normalizeIdPart(id);
		const [callId, itemId] = id.split("|");
		const normalizedCallId = normalizeIdPart(callId);
		let normalizedItemId = source.provider !== model.provider || source.api !== model.api ? buildForeignResponsesItemId(itemId) : normalizeIdPart(itemId);
		if (!normalizedItemId.startsWith("fc_")) normalizedItemId = normalizeIdPart(`fc_${normalizedItemId}`);
		return `${normalizedCallId}|${normalizedItemId}`;
	};
	const transformedMessages = transformMessages(normalizedContext.messages, model, normalizeToolCallId);
	const transcriptTools = resolveTranscriptTools(normalizedContext.messages, (options?.supportsAdditionalTools ?? false) || (options?.supportsToolSearch ?? false));
	const appendSystemToolAdditions = (message, seed) => {
		const tools = transcriptTools.anchorsAdditions ? message.toolsAdded ?? [] : [];
		if (tools.length === 0) return;
		if (options?.supportsAdditionalTools) {
			messages.push({
				type: "additional_tools",
				role: "developer",
				tools: convertResponsesTools(tools, options.toolOptions)
			});
			return;
		}
		if (!options?.supportsToolSearch) return;
		const names = tools.map((tool) => tool.name);
		const callId = `pi_tool_load_${shortHash(`${seed}:${names.join(",")}`)}`;
		messages.push({
			type: "tool_search_call",
			call_id: callId,
			execution: "client",
			status: "completed",
			arguments: {
				query: names.join(" "),
				limit: names.length
			}
		});
		messages.push({
			type: "tool_search_output",
			call_id: callId,
			execution: "client",
			status: "completed",
			tools: convertResponsesTools(tools, {
				...options.toolOptions,
				toolSearchResult: true
			})
		});
	};
	const includeInitialSystemMessage = options?.includeSystemPrompt ?? true;
	const compat = model.compat;
	const instructionRole = model.reasoning && compat?.supportsDeveloperRole !== false ? "developer" : "system";
	let msgIndex = 0;
	let sourceIndex = 0;
	for (const msg of transformedMessages) {
		const isLeadingSystemMessage = sourceIndex++ === 0 && msg.role === "system";
		if (msg.role === "system") {
			if (!isLeadingSystemMessage) appendSystemToolAdditions(msg, `system:${msgIndex}`);
			if (!isLeadingSystemMessage || includeInitialSystemMessage) {
				const text = isLeadingSystemMessage ? getSystemMessageText(msg) : renderSystemMessageUpdate(msg);
				if (text.length > 0) messages.push({
					role: instructionRole,
					content: sanitizeSurrogates(text)
				});
			}
		} else if (msg.role === "user") if (typeof msg.content === "string") messages.push({
			role: "user",
			content: [{
				type: "input_text",
				text: sanitizeSurrogates(msg.content)
			}]
		});
		else {
			const content = msg.content.map((item) => {
				if (item.type === "text") return {
					type: "input_text",
					text: sanitizeSurrogates(item.text)
				};
				return {
					type: "input_image",
					detail: "auto",
					image_url: `data:${item.mimeType};base64,${item.data}`
				};
			});
			if (content.length === 0) continue;
			messages.push({
				role: "user",
				content
			});
		}
		else if (msg.role === "assistant") {
			const output = [];
			const assistantMsg = msg;
			const isSameProviderAndApi = assistantMsg.provider === model.provider && assistantMsg.api === model.api;
			const isSameModel = isSameProviderAndApi && assistantMsg.model === model.id;
			const isDifferentModel = isSameProviderAndApi && assistantMsg.model !== model.id;
			let textBlockIndex = 0;
			for (const block of msg.content) if (block.type === "thinking") {
				if (block.thinkingSignature) {
					const reasoningItem = JSON.parse(block.thinkingSignature);
					output.push(reasoningItem);
				}
			} else if (block.type === "text") {
				const textBlock = block;
				const parsedSignature = parseTextSignature(textBlock.textSignature);
				const fallbackMessageId = textBlockIndex === 0 ? `msg_pi_${msgIndex}` : `msg_pi_${msgIndex}_${textBlockIndex}`;
				textBlockIndex++;
				let msgId = parsedSignature?.id;
				if (!msgId) msgId = fallbackMessageId;
				else if (msgId.length > 64) msgId = `msg_${shortHash(msgId)}`;
				output.push({
					type: "message",
					role: "assistant",
					content: [{
						type: "output_text",
						text: sanitizeSurrogates(textBlock.text),
						annotations: []
					}],
					status: "completed",
					id: msgId,
					phase: parsedSignature?.phase
				});
			} else if (block.type === "toolCall") {
				const toolCall = block;
				const [callId, itemIdRaw] = toolCall.id.split("|");
				const customInputProperty = options?.grammarToolInputProperties?.get(toolCall.name);
				let itemId = itemIdRaw;
				const itemIdPrefix = customInputProperty === void 0 ? "fc_" : "ctc_";
				if (isDifferentModel || !itemId?.startsWith(itemIdPrefix)) itemId = void 0;
				if (customInputProperty !== void 0) output.push({
					type: "custom_tool_call",
					id: itemId,
					call_id: callId,
					name: toolCall.name,
					input: sanitizeSurrogates(getGrammarToolInput(toolCall.name, toolCall.arguments, customInputProperty)),
					...isSameModel && toolCall.namespace !== void 0 ? { namespace: toolCall.namespace } : {}
				});
				else output.push({
					type: "function_call",
					id: itemId,
					call_id: callId,
					name: toolCall.name,
					arguments: JSON.stringify(toolCall.arguments),
					...isSameModel && toolCall.namespace !== void 0 ? { namespace: toolCall.namespace } : {}
				});
			}
			if (output.length === 0) continue;
			messages.push(...output);
		} else if (msg.role === "toolResult") {
			const [callId] = msg.toolCallId.split("|");
			const output = convertToolResultOutput(model, msg.content);
			if (options?.grammarToolInputProperties?.has(msg.toolName)) messages.push({
				type: "custom_tool_call_output",
				call_id: callId,
				output
			});
			else messages.push({
				type: "function_call_output",
				call_id: callId,
				output
			});
		}
		if (!isLeadingSystemMessage) msgIndex++;
	}
	return messages;
}
function convertResponsesTools(tools, options) {
	const defaultStrict = options?.strict === void 0 ? false : options.strict;
	const supportsStrictMode = options?.supportsStrictMode ?? true;
	const supportsOpenAIGrammarTools = options?.supportsOpenAIGrammarTools ?? false;
	return tools.map((tool) => {
		const grammar = resolveGrammarConstrainedSampling(tool, supportsOpenAIGrammarTools);
		if (grammar) return {
			type: "custom",
			name: tool.name,
			description: tool.description,
			format: {
				type: "grammar",
				syntax: grammar.format,
				definition: grammar.definition
			},
			...options?.toolSearchResult ? { defer_loading: true } : {}
		};
		const strict = resolveJsonSchemaStrictSampling(tool, supportsStrictMode) ?? defaultStrict;
		const functionTool = {
			type: "function",
			name: tool.name,
			description: tool.description,
			parameters: getJsonSchemaToolParameters(tool, strict === true),
			...options?.toolSearchResult ? { defer_loading: true } : {}
		};
		if (supportsStrictMode) functionTool.strict = strict;
		return functionTool;
	});
}
function getCustomToolCallInput(block) {
	const property = block.customInput?.property;
	if (property === void 0) return "";
	const value = block.arguments[property];
	return typeof value === "string" ? value : "";
}
function appendCustomToolCallInput(block, nextInput, close) {
	const customInput = block.customInput;
	if (!customInput) return void 0;
	const delta = appendGrammarToolInputJsonDelta(customInput.jsonBuffer, customInput.property, nextInput, close);
	block.arguments = { [customInput.property]: nextInput };
	return delta;
}
async function processResponsesStream(openaiStream, output, stream, model, options) {
	let sawTerminalResponseEvent = false;
	const outputSlots = /* @__PURE__ */ new Map();
	const reasoningBlocksById = /* @__PURE__ */ new Map();
	const applyMessagePhaseStopReason = (item) => {
		if (item.type === "message" && item.phase === "final_answer") output.stopReason = "stop";
	};
	const getSlot = (outputIndex, type) => {
		const slot = outputSlots.get(outputIndex);
		return slot?.type === type ? slot : void 0;
	};
	const pushToolCallDelta = (slot, delta) => {
		if (delta === void 0) return;
		stream.push({
			type: "toolcall_delta",
			contentIndex: slot.contentIndex,
			delta,
			partial: output
		});
	};
	const createSlot = (outputIndex, item) => {
		if (item.type === "reasoning") {
			const block = {
				type: "thinking",
				thinking: ""
			};
			output.content.push(block);
			const slot = {
				type: "thinking",
				block,
				contentIndex: output.content.length - 1
			};
			outputSlots.set(outputIndex, slot);
			stream.push({
				type: "thinking_start",
				contentIndex: slot.contentIndex,
				partial: output
			});
			return slot;
		}
		if (item.type === "message") {
			applyMessagePhaseStopReason(item);
			const block = {
				type: "text",
				text: ""
			};
			output.content.push(block);
			const slot = {
				type: "text",
				block,
				contentIndex: output.content.length - 1
			};
			outputSlots.set(outputIndex, slot);
			stream.push({
				type: "text_start",
				contentIndex: slot.contentIndex,
				partial: output
			});
			return slot;
		}
		if (item.type === "function_call") {
			const block = {
				type: "toolCall",
				id: `${item.call_id}|${item.id}`,
				name: item.name,
				arguments: {},
				...item.namespace !== void 0 ? { namespace: item.namespace } : {},
				partialJson: item.arguments || ""
			};
			output.content.push(block);
			const slot = {
				type: "toolCall",
				block,
				contentIndex: output.content.length - 1
			};
			outputSlots.set(outputIndex, slot);
			stream.push({
				type: "toolcall_start",
				contentIndex: slot.contentIndex,
				partial: output
			});
			return slot;
		}
		if (item.type === "custom_tool_call") {
			const inputProperty = options?.grammarToolInputProperties?.get(item.name) ?? "input";
			const input = item.input || "";
			const block = {
				type: "toolCall",
				id: `${item.call_id}|${item.id}`,
				name: item.name,
				arguments: { [inputProperty]: input },
				...item.namespace !== void 0 ? { namespace: item.namespace } : {},
				customInput: {
					property: inputProperty,
					jsonBuffer: {
						input: "",
						started: false,
						closed: false
					}
				}
			};
			output.content.push(block);
			const slot = {
				type: "toolCall",
				block,
				contentIndex: output.content.length - 1
			};
			outputSlots.set(outputIndex, slot);
			stream.push({
				type: "toolcall_start",
				contentIndex: slot.contentIndex,
				partial: output
			});
			return slot;
		}
	};
	const getOrCreateSlot = (outputIndex, item) => {
		return outputSlots.get(outputIndex) ?? createSlot(outputIndex, item);
	};
	const backfillReasoningSignatures = (responseOutput) => {
		for (const item of responseOutput) {
			if (item.type !== "reasoning" || !item.encrypted_content) continue;
			const block = reasoningBlocksById.get(item.id);
			if (!block?.thinkingSignature) continue;
			const storedItem = JSON.parse(block.thinkingSignature);
			if (storedItem.encrypted_content) continue;
			block.thinkingSignature = JSON.stringify({
				...storedItem,
				encrypted_content: item.encrypted_content
			});
		}
	};
	const finalizeResponse = (response) => {
		sawTerminalResponseEvent = true;
		backfillReasoningSignatures(response.output ?? []);
		if (response?.id) output.responseId = response.id;
		if (response?.usage) {
			const inputDetails = response.usage.input_tokens_details;
			const cachedTokens = inputDetails?.cached_tokens || 0;
			const cacheWriteTokens = inputDetails?.cache_write_tokens || 0;
			output.usage = {
				input: Math.max(0, (response.usage.input_tokens || 0) - cachedTokens - cacheWriteTokens),
				output: response.usage.output_tokens || 0,
				cacheRead: cachedTokens,
				cacheWrite: cacheWriteTokens,
				reasoning: response.usage.output_tokens_details?.reasoning_tokens || 0,
				totalTokens: response.usage.total_tokens || 0,
				cost: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					total: 0
				}
			};
		}
		calculateCost(model, output.usage);
		if (options?.applyServiceTierPricing) {
			const serviceTier = options.resolveServiceTier ? options.resolveServiceTier(response?.service_tier, options.serviceTier) : response?.service_tier ?? options.serviceTier;
			options.applyServiceTierPricing(output.usage, serviceTier);
		}
		const status = response?.status;
		const incompleteDetails = response?.incomplete_details;
		const incompleteReason = typeof incompleteDetails?.reason === "string" ? incompleteDetails.reason : void 0;
		output.rawStopReason = incompleteReason ? `${status}.${incompleteReason}` : status;
		const mappedStop = mapStopReason(status, incompleteReason);
		output.stopReason = mappedStop.stopReason;
		if (mappedStop.errorMessage === void 0) delete output.errorMessage;
		else output.errorMessage = mappedStop.errorMessage;
		if (output.content.some((b) => b.type === "toolCall") && output.stopReason === "stop") output.stopReason = "toolUse";
	};
	for await (const event of openaiStream) {
		await options?.onProviderStreamEvent?.(event, model);
		if (event.type === "response.created") output.responseId = event.response.id;
		else if (event.type === "response.output_item.added") createSlot(event.output_index, event.item);
		else if (event.type === "response.reasoning_summary_text.delta") {
			const slot = getSlot(event.output_index, "thinking");
			if (!slot) continue;
			slot.block.thinking += event.delta;
			stream.push({
				type: "thinking_delta",
				contentIndex: slot.contentIndex,
				delta: event.delta,
				partial: output
			});
		} else if (event.type === "response.reasoning_summary_part.done") {
			const slot = getSlot(event.output_index, "thinking");
			if (!slot) continue;
			slot.block.thinking += "\n\n";
			stream.push({
				type: "thinking_delta",
				contentIndex: slot.contentIndex,
				delta: "\n\n",
				partial: output
			});
		} else if (event.type === "response.reasoning_text.delta") {
			const slot = getSlot(event.output_index, "thinking");
			if (!slot) continue;
			slot.block.thinking += event.delta;
			stream.push({
				type: "thinking_delta",
				contentIndex: slot.contentIndex,
				delta: event.delta,
				partial: output
			});
		} else if (event.type === "response.output_text.delta") {
			const slot = getSlot(event.output_index, "text");
			if (!slot) continue;
			slot.block.text += event.delta;
			stream.push({
				type: "text_delta",
				contentIndex: slot.contentIndex,
				delta: event.delta,
				partial: output
			});
		} else if (event.type === "response.refusal.delta") {
			const slot = getSlot(event.output_index, "text");
			if (!slot) continue;
			slot.block.text += event.delta;
			stream.push({
				type: "text_delta",
				contentIndex: slot.contentIndex,
				delta: event.delta,
				partial: output
			});
		} else if (event.type === "response.function_call_arguments.delta") {
			const slot = getSlot(event.output_index, "toolCall");
			if (!slot || slot.block.partialJson === void 0) continue;
			slot.block.partialJson += event.delta;
			slot.block.arguments = parseStreamingJson(slot.block.partialJson);
			pushToolCallDelta(slot, event.delta);
		} else if (event.type === "response.function_call_arguments.done") {
			const slot = getSlot(event.output_index, "toolCall");
			if (!slot || slot.block.partialJson === void 0) continue;
			const previousPartialJson = slot.block.partialJson;
			slot.block.partialJson = event.arguments;
			slot.block.arguments = parseStreamingJson(slot.block.partialJson);
			if (event.arguments.startsWith(previousPartialJson)) {
				const delta = event.arguments.slice(previousPartialJson.length);
				if (delta.length > 0) pushToolCallDelta(slot, delta);
			}
		} else if (event.type === "response.custom_tool_call_input.delta") {
			const slot = getSlot(event.output_index, "toolCall");
			if (!slot || !slot.block.customInput) continue;
			pushToolCallDelta(slot, appendCustomToolCallInput(slot.block, getCustomToolCallInput(slot.block) + event.delta, false));
		} else if (event.type === "response.custom_tool_call_input.done") {
			const slot = getSlot(event.output_index, "toolCall");
			if (!slot || !slot.block.customInput) continue;
			pushToolCallDelta(slot, appendCustomToolCallInput(slot.block, event.input, true));
		} else if (event.type === "response.output_item.done") {
			const item = event.item;
			applyMessagePhaseStopReason(item);
			const slot = getOrCreateSlot(event.output_index, item);
			if (item.type === "reasoning" && slot?.type === "thinking") {
				const summaryText = item.summary?.map((s) => s.text).join("\n\n") || "";
				const contentText = item.content?.map((c) => c.text).join("\n\n") || "";
				slot.block.thinking = summaryText || contentText || slot.block.thinking;
				slot.block.thinkingSignature = JSON.stringify(item);
				reasoningBlocksById.set(item.id, slot.block);
				stream.push({
					type: "thinking_end",
					contentIndex: slot.contentIndex,
					content: slot.block.thinking,
					partial: output
				});
				outputSlots.delete(event.output_index);
			} else if (item.type === "message" && slot?.type === "text") {
				slot.block.text = item.content?.map((c) => c.type === "output_text" ? c.text : c.refusal).join("") || "";
				slot.block.textSignature = encodeTextSignatureV1(item.id, item.phase ?? void 0);
				stream.push({
					type: "text_end",
					contentIndex: slot.contentIndex,
					content: slot.block.text,
					partial: output
				});
				outputSlots.delete(event.output_index);
			} else if (item.type === "function_call" && slot?.type === "toolCall" && slot.block.partialJson !== void 0) {
				slot.block.arguments = parseStreamingJson(item.arguments || slot.block.partialJson || "{}");
				if (item.namespace !== void 0) slot.block.namespace = item.namespace;
				delete slot.block.partialJson;
				stream.push({
					type: "toolcall_end",
					contentIndex: slot.contentIndex,
					toolCall: slot.block,
					partial: output
				});
				outputSlots.delete(event.output_index);
			} else if (item.type === "custom_tool_call" && slot?.type === "toolCall" && slot.block.customInput) {
				pushToolCallDelta(slot, appendCustomToolCallInput(slot.block, item.input ?? getCustomToolCallInput(slot.block), true));
				if (item.namespace !== void 0) slot.block.namespace = item.namespace;
				delete slot.block.customInput;
				stream.push({
					type: "toolcall_end",
					contentIndex: slot.contentIndex,
					toolCall: slot.block,
					partial: output
				});
				outputSlots.delete(event.output_index);
			}
		} else if (event.type === "response.completed" || event.type === "response.incomplete") finalizeResponse(event.response);
		else if (event.type === "error") throw new Error(`Error Code ${event.code}: ${event.message}` || "Unknown error");
		else if (event.type === "response.failed") {
			sawTerminalResponseEvent = true;
			output.rawStopReason = event.response?.status;
			const error = event.response?.error;
			const details = event.response?.incomplete_details;
			const msg = error ? `${error.code || "unknown"}: ${error.message || "no message"}` : details?.reason ? `incomplete: ${details.reason}` : "Unknown error (no error details in response)";
			throw new Error(msg);
		}
	}
	if (!sawTerminalResponseEvent) throw new Error("OpenAI Responses stream ended before a terminal response event");
	if (output.stopReason === "toolUse") for (const block of output.content) {
		if (block.type !== "toolCall") continue;
		const toolCall = block;
		if (toolCall.partialJson !== void 0 || toolCall.customInput !== void 0) throw new Error(`OpenAI Responses stream completed with an unfinished tool call: ${toolCall.name} (${toolCall.id})`);
	}
}
function mapStopReason(status, incompleteReason) {
	if (!status) return { stopReason: "stop" };
	switch (status) {
		case "completed": return { stopReason: "stop" };
		case "incomplete":
			if (incompleteReason === "max_output_tokens") return { stopReason: "length" };
			return {
				stopReason: "error",
				errorMessage: incompleteReason ? `Response incomplete: ${incompleteReason}` : "Response incomplete without a provider reason"
			};
		case "failed":
		case "cancelled": return { stopReason: "error" };
		case "in_progress":
		case "queued": return { stopReason: "stop" };
		default: throw new Error(`Unhandled stop reason: ${status}`);
	}
}
//#endregion
export { convertResponsesTools as n, processResponsesStream as r, convertResponsesMessages as t };
