//#region ../../../../node_modules/.pnpm/@earendil-works+pi-ai@1.0.0_71d8dfff7c0445882abb8c414f4fc20f/node_modules/@earendil-works/pi-ai/dist/api/github-copilot-headers.js
function inferCopilotInitiator(messages) {
	const last = messages[messages.length - 1];
	return last && last.role !== "user" ? "agent" : "user";
}
function hasCopilotVisionInput(messages) {
	return messages.some((msg) => {
		if (msg.role === "user" && Array.isArray(msg.content)) return msg.content.some((c) => c.type === "image");
		if (msg.role === "toolResult" && Array.isArray(msg.content)) return msg.content.some((c) => c.type === "image");
		return false;
	});
}
function buildCopilotDynamicHeaders(params) {
	const headers = {
		"X-Initiator": inferCopilotInitiator(params.messages),
		"Openai-Intent": "conversation-edits"
	};
	if (params.hasImages) headers["Copilot-Vision-Request"] = "true";
	return headers;
}
//#endregion
export { hasCopilotVisionInput as n, buildCopilotDynamicHeaders as t };
