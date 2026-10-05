import type { Attachment } from "../media-entry.ts";
import { registerAdapter } from "./registry.ts";
import { type PayloadShape, rewriteUserMessages } from "./user-messages.ts";

const shape: PayloadShape = {
	messages: "messages",
	isUser: (message) => message.role === "user",
	content: "content",
	textOf: (node) => {
		const { type, text } = (node ?? {}) as { type?: unknown; text?: unknown };
		return type === "text" && typeof text === "string" ? text : undefined;
	},
	textNode: (text) => ({ type: "text", text }),
};

function carries(mimeType: string) {
	return mimeType.startsWith("audio/") || mimeType.startsWith("video/") || mimeType === "application/pdf";
}

function filePart({ data, mimeType }: Attachment) {
	return carries(mimeType) ? { type: "file", file: { data, media_type: mimeType } } : undefined;
}

registerAdapter({
	api: "openai-completions",
	carries,
	rewrite: (payload, attachment) => rewriteUserMessages(payload, shape, attachment, filePart),
});
