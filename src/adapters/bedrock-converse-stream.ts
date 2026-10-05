import { parse } from "node:path";
import type { Attachment } from "../media-entry.ts";
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

function carries(mimeType: string) {
	return mimeType === "application/pdf" || mimeType in videoFormats || mimeType in audioFormats;
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

const isDocument = (node: unknown) => !!node && typeof node === "object" && "document" in node;

// Converse requires a text block in a message that has a document.
function withText(message: Message) {
	const content = message.content;
	if (!Array.isArray(content) || content.some((node) => textOf(node) !== undefined)) return message;
	const first = content.findIndex(isDocument);
	if (first === -1) return message;
	return { ...message, content: content.toSpliced(first, 0, { text: content[first].document.name }) };
}

registerAdapter({
	api: "bedrock-converse-stream",
	carries,
	rewrite: (payload, attachment) => {
		const used = new Set<string>();
		const rewritten = rewriteUserMessages(payload, shape, attachment, (found) => block(found, used));
		return rewritten && { ...rewritten, messages: (rewritten.messages as Message[]).map(withText) };
	},
});
