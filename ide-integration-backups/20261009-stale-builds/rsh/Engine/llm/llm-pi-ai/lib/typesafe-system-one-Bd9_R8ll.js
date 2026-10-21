import { n as isRecord, t as classifySystemOne } from "./system-one-shared-CqTpQkt1.js";
//#region ../../../../node_modules/.pnpm/@earendil-works+pi-ai@1.0.0_71d8dfff7c0445882abb8c414f4fc20f/node_modules/@earendil-works/pi-ai/dist/api/typesafe-system-one.js
/**
* TypeSafe's native System One protocol. OpenRouter serves the same protocol,
* so both providers use this API with different base URLs.
*/
const transport = {
	api: "typesafe-system-one",
	label: "System One API",
	url: (model) => new URL("systemone", `${model.baseUrl.replace(/\/+$/u, "")}/`),
	payload: (model, request) => ({
		model: model.id,
		...request
	}),
	output: (body) => {
		if (!isRecord(body)) throw new Error("System One API returned an unexpected response");
		return body;
	}
};
/** TypeSafe System One classification with public `bool` values mapped to wire-level `noul`. */
const classify = (model, context, options) => classifySystemOne(transport, model, context, options);
//#endregion
export { classify };
