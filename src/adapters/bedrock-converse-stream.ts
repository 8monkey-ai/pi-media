import { parse } from "node:path";
import type { Attachment } from "../media-entry.ts";
import type { FindAttachment } from "./adapter.ts";
import { type Build, carriesBy, type Place } from "./part-for.ts";
import { registerAdapter } from "./registry.ts";
import { type Holder, isRecord, rewriteHolder, type TextShape } from "./text-holders.ts";

// A Converse user message and a Converse tool result both keep their text blocks in `content`.
const converseText: TextShape = {
	content: "content",
	textOf: (node) => (isRecord(node) && typeof node.text === "string" ? node.text : undefined),
	textNode: (text) => ({ text }),
};

// Converse format strings for the MIME types that file-type detects.
const videoFormats = new Map([
	["video/mp4", "mp4"],
	["video/quicktime", "mov"],
	["video/webm", "webm"],
	["video/matroska", "mkv"],
	["video/x-flv", "flv"],
	["video/mpeg", "mpeg"],
	["video/3gpp", "three_gp"],
]);
const audioFormats = new Map([
	["audio/mpeg", "mp3"],
	["audio/wav", "wav"],
	["audio/flac", "flac"],
	["audio/aac", "aac"],
	["audio/ogg", "ogg"],
	["audio/ogg; codecs=opus", "opus"],
	["audio/mp4", "mp4"],
	["audio/x-m4a", "m4a"],
]);

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

// `used` holds the document names that earlier blocks of the request took.
type Block = (attachment: Attachment, used: Set<string>) => unknown;

const source = (data: string) => ({ bytes: new Uint8Array(Buffer.from(data, "base64")) });

const documentBlock: Block = ({ path, data }, used) => ({
	document: { format: "pdf", name: uniqueName(documentName(path), used), source: source(data) },
});

// A Converse tool result has document and video blocks, but no audio block.
function partFor(mimeType: string, place: Place): Block | undefined {
	if (mimeType === "application/pdf") return documentBlock;
	const video = videoFormats.get(mimeType);
	if (video) return ({ data }) => ({ video: { format: video, source: source(data) } });
	const audio = place === "user" ? audioFormats.get(mimeType) : undefined;
	if (audio) return ({ data }) => ({ audio: { format: audio, source: source(data) } });
	return undefined;
}

const isDocument = (node: unknown) => isRecord(node) && "document" in node;

// Converse requires a text block in a message that has a document.
function withText(message: Holder) {
	const content = message.content;
	if (!Array.isArray(content) || content.some((node) => converseText.textOf(node) !== undefined)) return message;
	const first = content.findIndex(isDocument);
	if (first === -1) return message;
	return { ...message, content: content.toSpliced(first, 0, { text: content[first].document.name }) };
}

function rewriteToolResults(message: Holder, attachment: FindAttachment, build: Build) {
	const content = message.content;
	if (message.role !== "user" || !Array.isArray(content)) return undefined;
	const results = content.map((node) =>
		isRecord(node) && isRecord(node.toolResult) ? rewriteHolder(node.toolResult, converseText, attachment, build) : undefined,
	);
	if (results.every((result) => result === undefined)) return undefined;
	return { ...message, content: content.map((node, index) => (results[index] ? { ...node, toolResult: results[index] } : node)) };
}

function rewrite(payload: unknown, attachment: FindAttachment) {
	if (!isRecord(payload) || !Array.isArray(payload.messages)) return undefined;
	const original: unknown[] = payload.messages;
	const used = new Set<string>();
	const buildIn = (place: Place) => (found: Attachment) => partFor(found.mimeType, place)?.(found, used);
	// One message at a time, so that documents get their names in message order.
	const messages = original.map((message) => {
		if (!isRecord(message)) return message;
		const user = message.role === "user" ? rewriteHolder(message, converseText, attachment, buildIn("user")) : undefined;
		if (user) return withText(user);
		return rewriteToolResults(message, attachment, buildIn("toolResult")) ?? message;
	});
	return messages.some((message, index) => message !== original[index]) ? { ...payload, messages } : undefined;
}

registerAdapter({ api: "bedrock-converse-stream", carries: carriesBy(partFor), rewrite });
