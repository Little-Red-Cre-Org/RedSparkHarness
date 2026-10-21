import { t as calculateCost } from "./models-4COJlt5Q.js";
import { n as providerHeadersToRecord, t as headersToRecord } from "./headers-Est0Pah9.js";
import { t as retryProviderRequest } from "./provider-retry-ytLjkuGq.js";
import { n as normalizeProviderError, t as formatProviderError } from "./error-body-CZID2ePw.js";
//#region ../../../../node_modules/.pnpm/@earendil-works+pi-ai@1.0.0_71d8dfff7c0445882abb8c414f4fc20f/node_modules/@earendil-works/pi-ai/dist/api/system-one-shared.js
function httpError(label, response, body) {
	const error = /* @__PURE__ */ new Error(`${label} returned ${response.status}`);
	error.status = response.status;
	error.headers = response.headers;
	error.body = body;
	return error;
}
function timeoutError(timeoutMs) {
	const error = /* @__PURE__ */ new Error(`Request timed out after ${timeoutMs}ms`);
	error.name = "TimeoutError";
	error.status = void 0;
	error.headers = void 0;
	error.body = "";
	return error;
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function requiredNumber(label, value, field) {
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} returned an invalid ${field}`);
	return value;
}
function probabilities(label, value, id) {
	if (!isRecord(value)) throw new Error(`${label} returned invalid probabilities for ${id}`);
	return Object.fromEntries(Object.entries(value).map(([key, probability]) => [key, requiredNumber(label, probability, `probability for ${id}.${key}`)]));
}
function parseAnswers(label, value, context) {
	if (!isRecord(value)) throw new Error(`${label} returned an unexpected response`);
	const answers = [];
	for (const [id, question] of Object.entries(context.questions)) {
		const answer = value[id];
		if (!isRecord(answer)) throw new Error(`${label} did not return an answer for ${id}`);
		if (question.type === "choice") {
			if (answer.type !== "choice" || typeof answer.choice !== "string") throw new Error(`${label} did not return a choice answer for ${id}`);
			answers.push([id, {
				type: "choice",
				choice: answer.choice,
				probabilities: probabilities(label, answer.probabilities, id),
				confidence: requiredNumber(label, answer.confidence, `confidence for ${id}`)
			}]);
		} else if (question.type === "score") {
			if (answer.type !== "score") throw new Error(`${label} did not return a score answer for ${id}`);
			answers.push([id, {
				type: "score",
				score: requiredNumber(label, answer.score, `score for ${id}`),
				confidence: requiredNumber(label, answer.confidence, `confidence for ${id}`)
			}]);
		} else {
			if (answer.type !== "noul") throw new Error(`${label} did not return a bool answer for ${id}`);
			answers.push([id, {
				type: "bool",
				probability: requiredNumber(label, answer.noul, `probability for ${id}`)
			}]);
		}
	}
	return Object.fromEntries(answers);
}
function tokenCount(value) {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
/**
* Usage from System One's `{ input_tokens, output_tokens }`, priced from the model catalog like chat
* usage. A missing or malformed usage object leaves the result without usage instead of failing it.
*/
function parseUsage(value, model) {
	if (!isRecord(value) || value.input_tokens === void 0 && value.output_tokens === void 0) return void 0;
	const input = tokenCount(value.input_tokens);
	const output = tokenCount(value.output_tokens);
	const usage = {
		input,
		output,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: input + output,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0
		}
	};
	calculateCost(model, usage);
	return usage;
}
/** Maps public `bool` questions to TypeSafe's wire-level `noul` type. */
function wireRequest(context) {
	return {
		state: context.state,
		questions: Object.fromEntries(Object.entries(context.questions).map(([id, question]) => [id, question.type === "bool" ? {
			...question,
			type: "noul"
		} : question]))
	};
}
function requestHeaders(model, apiKey, optionsHeaders) {
	return providerHeadersToRecord({
		authorization: `Bearer ${apiKey}`,
		"content-type": "application/json"
	}, model.headers, optionsHeaders) ?? {};
}
/** Runs one System One classification over the given transport. */
async function classifySystemOne(transport, model, context, options) {
	const output = {
		api: model.api,
		provider: model.provider,
		model: model.id,
		answers: {},
		stopReason: "stop",
		timestamp: Date.now()
	};
	try {
		if (model.api !== transport.api) throw new Error(`Unsupported classifier API: ${model.api}`);
		if (!options?.apiKey) throw new Error(`No API key for provider: ${model.provider}`);
		const apiKey = options.apiKey;
		let payload = transport.payload(model, wireRequest(context));
		const transformed = await options.onPayload?.(payload, model);
		if (transformed !== void 0) payload = transformed;
		const requestFetch = options.fetch ?? globalThis.fetch;
		const { response, body } = await retryProviderRequest(async () => {
			const timeoutSignal = options.timeoutMs !== void 0 ? AbortSignal.timeout(options.timeoutMs) : void 0;
			const signal = options.signal && timeoutSignal ? AbortSignal.any([options.signal, timeoutSignal]) : options.signal ?? timeoutSignal;
			try {
				const next = await requestFetch(transport.url(model), {
					method: "POST",
					headers: requestHeaders(model, apiKey, options.headers),
					body: JSON.stringify(payload),
					signal
				});
				if (!next.ok) throw httpError(transport.label, next, await next.text());
				return {
					response: next,
					body: await next.json()
				};
			} catch (error) {
				if (timeoutSignal?.aborted && !options.signal?.aborted) throw timeoutError(options.timeoutMs);
				throw error;
			}
		}, {
			maxRetries: options.maxRetries ?? 2,
			maxRetryDelayMs: options.maxRetryDelayMs,
			signal: options.signal
		});
		await options.onResponse?.({
			status: response.status,
			headers: headersToRecord(response.headers)
		}, model);
		const result = transport.output(body);
		const usage = parseUsage(result.usage, model);
		if (usage) output.usage = usage;
		output.answers = parseAnswers(transport.label, result.answers, context);
		return output;
	} catch (error) {
		output.stopReason = options?.signal?.aborted ? "aborted" : "error";
		output.errorMessage = formatProviderError(normalizeProviderError(error), `${transport.label} error`);
		return output;
	}
}
//#endregion
export { isRecord as n, classifySystemOne as t };
