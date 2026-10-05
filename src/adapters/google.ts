import type { Attachment } from "../media-entry.ts";
import { registerAdapter } from "./registry.ts";
import { type PayloadShape, rewriteUserMessages } from "./user-messages.ts";

// Gemini and Vertex AI share one request format: pi-ai builds both with the same converter.
const shape: PayloadShape = {
	messages: "contents",
	isUser: (content) => content.role === "user",
	content: "parts",
	textOf: (part) => {
		const { text } = (part ?? {}) as { text?: unknown };
		return typeof text === "string" ? text : undefined;
	},
	textNode: (text) => ({ text }),
};

function carries(mimeType: string) {
	return mimeType.startsWith("audio/") || mimeType.startsWith("video/") || mimeType === "application/pdf";
}

function inlineDataPart({ data, mimeType }: Attachment) {
	return carries(mimeType) ? { inlineData: { mimeType, data } } : undefined;
}

for (const api of ["google-generative-ai", "google-vertex"]) {
	registerAdapter({
		api,
		carries,
		rewrite: (payload, attachment) => rewriteUserMessages(payload, shape, attachment, inlineDataPart),
	});
}
