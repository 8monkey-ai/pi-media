import { basename } from "node:path";
import type { Attachment } from "../media-entry.ts";
import { registerAdapter } from "./registry.ts";
import { type PayloadShape, rewriteUserMessages } from "./user-messages.ts";

function inputText(node: unknown) {
	const { type, text } = (node ?? {}) as { type?: unknown; text?: unknown };
	return type === "input_text" && typeof text === "string" ? text : undefined;
}

const textNode = (text: string) => ({ type: "input_text", text });

const userShape: PayloadShape = {
	messages: "input",
	isUser: (item) => item.role === "user",
	content: "content",
	textOf: inputText,
	textNode,
};

// pi-ai joins the text of a tool result into the string `output` of the item, or into its first `input_text` when the
// result has images. The API accepts `input_file` parts in `output`.
const toolOutputShape: PayloadShape = {
	messages: "input",
	isUser: (item) => item.type === "function_call_output" || item.type === "custom_tool_call_output",
	content: "output",
	textOf: inputText,
	textNode,
	joinsText: true,
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
		carries: (mimeType) => carries(mimeType),
		rewrite: (payload, attachment) => {
			const users = rewriteUserMessages(payload, userShape, attachment, filePart);
			return rewriteUserMessages(users ?? payload, toolOutputShape, attachment, filePart) ?? users;
		},
	});
}
