import { parse } from "node:path";
import type { Attachment } from "../media-entry.ts";
import type { FindAttachment } from "./adapter.ts";
import { registerAdapter } from "./registry.ts";
import { type PayloadShape, rewriteUserMessages } from "./user-messages.ts";

const textOf = (node: unknown) => {
	const { text } = (node ?? {}) as { text?: unknown };
	return typeof text === "string" ? text : undefined;
};

const shape: PayloadShape = {
	messages: "messages",
	isUser: (message) => message.role === "user",
	content: "content",
	textOf,
	textNode: (text) => ({ text }),
};

// Converse format strings for the MIME types that file-type detects.
const videoFormats: Record<string, string> = {
	"video/mp4": "mp4",
	"video/quicktime": "mov",
	"video/webm": "webm",
	"video/matroska": "mkv",
	"video/x-flv": "flv",
	"video/mpeg": "mpeg",
	"video/3gpp": "three_gp",
};
const audioFormats: Record<string, string> = {
	"audio/mpeg": "mp3",
	"audio/wav": "wav",
	"audio/flac": "flac",
	"audio/aac": "aac",
	"audio/ogg": "ogg",
	"audio/ogg; codecs=opus": "opus",
	"audio/mp4": "mp4",
	"audio/x-m4a": "m4a",
};

// A Converse tool result has document and video blocks, but no audio block.
function carries(mimeType: string, place: "user" | "toolResult") {
	return mimeType === "application/pdf" || mimeType in videoFormats || (place === "user" && mimeType in audioFormats);
}

// Converse allows only ASCII letters and digits, single spaces, hyphens, parentheses and square brackets, up to 200 characters.
function documentName(path: string) {
	const name = parse(path)
		.name.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.replace(/[^A-Za-z0-9()[\]-]+/g, " ")
		.trim()
		.slice(0, 200)
		.trimEnd();
	return name || "document";
}

// Converse rejects a request in which two documents have the same name.
// Earlier documents keep their names when new messages come, so the request prefix stays the same for the prompt cache.
function uniqueName(name: string, used: Set<string>) {
	let unique = name;
	for (let count = 2; used.has(unique); count++) {
		const suffix = ` (${count})`;
		unique = `${name.slice(0, 200 - suffix.length).trimEnd()}${suffix}`;
	}
	used.add(unique);
	return unique;
}

function block({ path, mimeType, data }: Attachment, used: Set<string>) {
	const source = { bytes: new Uint8Array(Buffer.from(data, "base64")) };
	if (mimeType === "application/pdf") {
		return { document: { format: "pdf", name: uniqueName(documentName(path), used), source } };
	}
	if (mimeType in videoFormats) return { video: { format: videoFormats[mimeType], source } };
	if (mimeType in audioFormats) return { audio: { format: audioFormats[mimeType], source } };
	return undefined;
}

type Message = Record<string, unknown>;

const isRecord = (value: unknown): value is Message => !!value && typeof value === "object";
const isDocument = (node: unknown) => isRecord(node) && "document" in node;

// Converse requires a text block in a message that has a document.
function withText(message: Message) {
	const content = message.content;
	if (!Array.isArray(content) || content.some((node) => textOf(node) !== undefined)) return message;
	const first = content.findIndex(isDocument);
	if (first === -1) return message;
	return { ...message, content: content.toSpliced(first, 0, { text: content[first].document.name }) };
}

// A Converse tool result keeps its text blocks in `content`, the same way a user message does.
const toolResultShape: PayloadShape = { ...shape, messages: "toolResults", isUser: () => true };

function rewriteToolResults(message: Message, attachment: FindAttachment, part: (found: Attachment) => unknown) {
	const content = message.content;
	if (message.role !== "user" || !Array.isArray(content)) return undefined;
	const toolResults = content.map((node) => (isRecord(node) ? node.toolResult : undefined));
	const rewritten = rewriteUserMessages({ toolResults }, toolResultShape, attachment, part);
	if (!rewritten) return undefined;
	const results = rewritten.toolResults as unknown[];
	return {
		...message,
		content: content.map((node, index) =>
			results[index] === toolResults[index] ? node : { ...node, toolResult: results[index] },
		),
	};
}

function rewrite(payload: unknown, attachment: FindAttachment) {
	if (!isRecord(payload) || !Array.isArray(payload.messages)) return undefined;
	const original: unknown[] = payload.messages;
	const used = new Set<string>();
	const inUser = (found: Attachment) => block(found, used);
	const inToolResult = (found: Attachment) => (carries(found.mimeType, "toolResult") ? block(found, used) : undefined);
	// One message at a time, so that documents get their names in message order.
	const messages = original.map((message) => {
		if (!isRecord(message)) return message;
		const user = rewriteUserMessages({ messages: [message] }, shape, attachment, inUser);
		if (user) return withText((user.messages as Message[])[0]);
		return rewriteToolResults(message, attachment, inToolResult) ?? message;
	});
	return messages.some((message, index) => message !== original[index]) ? { ...payload, messages } : undefined;
}

registerAdapter({ api: "bedrock-converse-stream", carries, rewrite });
