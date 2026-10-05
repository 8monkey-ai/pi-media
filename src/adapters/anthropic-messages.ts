import type { Attachment } from "../media-entry.ts";
import type { FindAttachment } from "./adapter.ts";
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
	return mimeType === "application/pdf";
}

function documentBlock({ data, mimeType }: Attachment) {
	return carries(mimeType) ? { type: "document", source: { type: "base64", media_type: mimeType, data } } : undefined;
}

type Block = Record<string, unknown>;
type Message = { content?: unknown };

function lastBlock(content: unknown) {
	return Array.isArray(content) ? (content.at(-1) as Block | undefined) : undefined;
}

// pi-ai puts `cache_control` on the last block of the last user message, and that block is often a marker.
// When the rewrite replaces or removes it, the new last block takes the cache marker.
function keepCacheControl(original: Message, rewritten: Message) {
	const marked = lastBlock(original.content);
	const last = lastBlock(rewritten.content);
	if (!marked?.cache_control || !last || last === marked) return rewritten;
	const content = rewritten.content as Block[];
	return { ...rewritten, content: [...content.slice(0, -1), { ...last, cache_control: marked.cache_control }] };
}

function rewrite(payload: unknown, attachment: FindAttachment) {
	const result = rewriteUserMessages(payload, shape, attachment, documentBlock);
	if (!result) return undefined;
	const original = (payload as { messages: Message[] }).messages;
	const messages = result.messages as Message[];
	return {
		...result,
		messages: messages.map((message, index) =>
			message === original[index] ? message : keepCacheControl(original[index], message),
		),
	};
}

registerAdapter({ api: "anthropic-messages", carries, rewrite });
