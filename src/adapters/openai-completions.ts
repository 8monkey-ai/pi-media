import { basename } from "node:path";
import type { Attachment } from "../media-entry.ts";
import type { FindAttachment } from "./adapter.ts";
import { registerAdapter } from "./registry.ts";
import { type PayloadShape, rewriteUserMessages } from "./user-messages.ts";

type Message = Record<string, unknown>;
type Node = Record<string, unknown>;

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

export function pdfFilePart({ path, data }: Attachment) {
	return { type: "file", file: { filename: basename(path), file_data: `data:application/pdf;base64,${data}` } };
}

export function inputAudioPart(data: string, format: string) {
	return { type: "input_audio", input_audio: { data, format } };
}

const isText = (node: unknown) => shape.textOf(node) !== undefined;

function cacheControlOf(content: unknown) {
	if (!Array.isArray(content)) return undefined;
	return (content.find((node) => isText(node) && (node as Node).cache_control !== undefined) as Node | undefined)?.cache_control;
}

// pi-ai puts `cache_control` on the last text part of the last message, which is often a marker block.
// The same rule applied to the new content puts it where it would be without the marker.
function keepCacheControl(before: unknown, after: unknown[]) {
	const cacheControl = cacheControlOf(before);
	if (cacheControl === undefined || cacheControlOf(after) !== undefined) return after;
	const last = after.findLastIndex(isText);
	return last === -1 ? after : after.with(last, { ...(after[last] as Node), cache_control: cacheControl });
}

// Replaces markers in Chat Completions user messages with the parts that `part` builds.
export function rewriteChatMessages(payload: unknown, attachment: FindAttachment, part: (attachment: Attachment) => unknown) {
	const result = rewriteUserMessages(payload, shape, attachment, part) as { messages: Message[] } | undefined;
	if (!result) return undefined;
	const before = (payload as { messages: Message[] }).messages;
	return {
		...result,
		messages: result.messages.map((message, index) =>
			message === before[index]
				? message
				: { ...message, content: keepCacheControl(before[index].content, message.content as unknown[]) },
		),
	};
}

const audioFormats = new Map([
	["audio/wav", "wav"],
	["audio/mpeg", "mp3"],
]);

function part(attachment: Attachment) {
	if (attachment.mimeType === "application/pdf") return pdfFilePart(attachment);
	const format = audioFormats.get(attachment.mimeType);
	return format && inputAudioPart(attachment.data, format);
}

registerAdapter({
	api: "openai-completions",
	carries: (mimeType) => mimeType === "application/pdf" || audioFormats.has(mimeType),
	rewrite: (payload, attachment) => rewriteChatMessages(payload, attachment, part),
});
