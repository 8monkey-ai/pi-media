import { basename } from "node:path";
import type { Attachment } from "../media-entry.ts";
import { registerAdapter } from "./registry.ts";
import { type PayloadShape, rewriteUserMessages } from "./user-messages.ts";

const shape: PayloadShape = {
	messages: "input",
	isUser: (item) => item.role === "user",
	content: "content",
	textOf: (node) => {
		const { type, text } = (node ?? {}) as { type?: unknown; text?: unknown };
		return type === "input_text" && typeof text === "string" ? text : undefined;
	},
	textNode: (text) => ({ type: "input_text", text }),
};

function carries(mimeType: string) {
	return mimeType === "application/pdf";
}

function filePart({ path, mimeType, data }: Attachment) {
	if (!carries(mimeType)) return undefined;
	return { type: "input_file", filename: basename(path), file_data: `data:${mimeType};base64,${data}` };
}

for (const api of ["openai-responses", "azure-openai-responses", "openai-codex-responses"]) {
	registerAdapter({
		api,
		carries,
		rewrite: (payload, attachment) => rewriteUserMessages(payload, shape, attachment, filePart),
	});
}
