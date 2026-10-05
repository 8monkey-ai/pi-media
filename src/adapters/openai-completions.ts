import { basename } from "node:path";
import { takeMarkers } from "../marker.ts";
import type { Attachment } from "../media-entry.ts";
import type { FindAttachment } from "./adapter.ts";
import { registerAdapter } from "./registry.ts";
import { type PayloadShape, rewriteUserMessages } from "./user-messages.ts";

type Message = Record<string, unknown>;
type Node = Record<string, unknown>;
type Part = (attachment: Attachment) => unknown;

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

function rewriteChatUserMessages(payload: unknown, attachment: FindAttachment, part: Part) {
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

// pi-ai joins the text of a tool result with line breaks.
function takeToolMarkers(text: string, attachment: FindAttachment, part: Part) {
	const taken = takeMarkers(text, true);
	if (!taken) return undefined;
	const parts = taken.markers.flatMap(({ entryId, index }) => {
		const found = attachment(entryId, index);
		const built = found && part(found);
		return built === undefined ? [] : [built];
	});
	return { text: taken.text, parts };
}

// Tool message content is a string, or text parts when pi-ai adds a cache marker to it.
function rewriteToolMessage(message: Message, attachment: FindAttachment, part: Part) {
	const { content } = message;
	if (typeof content === "string") {
		const taken = takeToolMarkers(content, attachment, part);
		return taken && { message: { ...message, content: taken.text }, parts: taken.parts };
	}
	if (!Array.isArray(content)) return undefined;
	const taken = content.map((node) => {
		const text = shape.textOf(node);
		return text === undefined ? undefined : takeToolMarkers(text, attachment, part);
	});
	if (taken.every((nodes) => nodes === undefined)) return undefined;
	return {
		message: { ...message, content: content.map((node, index) => (taken[index] ? { ...node, text: taken[index].text } : node)) },
		parts: taken.flatMap((nodes) => nodes?.parts ?? []),
	};
}

const isRole = (message: unknown, role: string): message is Message =>
	!!message && typeof message === "object" && (message as Message).role === role;

function toolRuns(messages: unknown[]) {
	const runs: { start: number; end: number }[] = [];
	messages.forEach((message, index) => {
		if (!isRole(message, "tool")) return;
		const last = runs.at(-1);
		if (last?.end === index) last.end = index + 1;
		else runs.push({ start: index, end: index + 1 });
	});
	return runs;
}

const bridge = { role: "assistant", content: "I have processed the tool results." };

// With `compat.requiresAssistantAfterToolResult`, pi-ai writes "" in place of null as the content of an assistant
// message without text, and adds `bridge` between tool messages and a user message after them.
function requiresAssistantAfterToolResult(messages: unknown[]) {
	return messages.some((message) => isRole(message, "assistant") && message.content === "");
}

// Tool messages take text only. pi-ai puts tool result images in one user message after the tool messages, after
// `bridge` for providers that need it. The files go to the same place.
function placeAfterRun(messages: unknown[], end: number, parts: unknown[], needsBridge: boolean) {
	const after = messages[end];
	const bridged = isRole(after, "assistant") && after.content === bridge.content;
	const at = bridged ? end + 1 : end;
	const next = messages[at];
	if (
		isRole(next, "user") &&
		Array.isArray(next.content) &&
		shape.textOf(next.content[0]) === "Attached image(s) from tool result:"
	) {
		messages[at] = { ...next, content: [...next.content, ...parts] };
		return;
	}
	const files = { role: "user", content: [{ type: "text", text: "Attached file(s) from tool result:" }, ...parts] };
	messages.splice(at, 0, ...(needsBridge && !bridged ? [{ ...bridge }, files] : [files]));
}

function rewriteToolResults(payload: unknown, attachment: FindAttachment, part: Part) {
	const messages = (payload as { messages?: unknown } | undefined)?.messages;
	if (!Array.isArray(messages)) return undefined;
	const rewritten = messages.map((message) =>
		isRole(message, "tool") ? rewriteToolMessage(message, attachment, part) : undefined,
	);
	if (rewritten.every((result) => result === undefined)) return undefined;
	const result = messages.map((message, index) => rewritten[index]?.message ?? message);
	const needsBridge = requiresAssistantAfterToolResult(messages);
	for (const { start, end } of toolRuns(messages).reverse()) {
		const parts = rewritten.slice(start, end).flatMap((rewrite) => rewrite?.parts ?? []);
		if (parts.length > 0) placeAfterRun(result, end, parts, needsBridge);
	}
	return { ...(payload as object), messages: result };
}

// Replaces markers in Chat Completions user messages and tool results with the parts that `part` builds.
export function rewriteChatMessages(payload: unknown, attachment: FindAttachment, part: Part) {
	const users = rewriteChatUserMessages(payload, attachment, part);
	return rewriteToolResults(users ?? payload, attachment, part) ?? users;
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
