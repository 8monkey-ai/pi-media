import { filePart } from "./file-parts.ts";
import { isRecord } from "./is-record.ts";
import { parseMarker, takeMarkerLines } from "./marker.ts";
import type { Attachment } from "./media-entry.ts";

type FindAttachment = (entryId: string, index: number) => Attachment | undefined;
type Message = Record<string, unknown>;

const textOf = (node: unknown) =>
	isRecord(node) && node.type === "text" && typeof node.text === "string" ? node.text : undefined;
const textPart = (text: string) => ({ type: "text", text });
const isText = (node: unknown): node is Message => textOf(node) !== undefined;
const isRole = (message: unknown, role: string): message is Message => isRecord(message) && message.role === role;

// A marker gives no part when its attachment is missing or the file type has no part.
function partsOf(markers: { entryId: string; index: number }[], attachment: FindAttachment) {
	return markers.flatMap(({ entryId, index }) => {
		const found = attachment(entryId, index);
		const part = found && filePart(found);
		return part === undefined ? [] : [part];
	});
}

// pi-ai puts `cache_control` on the last text part of the last message, which is often a marker block.
// The same rule applied to the new content puts it where it would be without the marker.
function keepCacheControl(before: unknown[], after: unknown[]) {
	const cacheControl = before.findLast(isText)?.cache_control;
	if (cacheControl === undefined) return after;
	const last = after.findLastIndex(isText);
	const node = after[last];
	return isText(node) ? after.with(last, { ...node, cache_control: cacheControl }) : after;
}

// The context hook adds each marker to a user message as a block of its own, and pi-ai keeps the blocks.
function splitText(text: string, attachment: FindAttachment) {
	const marker = parseMarker(text);
	return marker && partsOf([marker], attachment);
}

function rewriteUserMessage(message: unknown, attachment: FindAttachment) {
	if (!isRole(message, "user")) return undefined;
	const { content } = message;
	if (!Array.isArray(content)) return undefined;
	const replaced = content.map((node) => {
		const text = textOf(node);
		return text === undefined ? undefined : splitText(text, attachment);
	});
	if (replaced.every((nodes) => nodes === undefined)) return undefined;
	return {
		...message,
		content: keepCacheControl(
			content,
			content.flatMap((node, index) => replaced[index] ?? [node]),
		),
	};
}

// pi-ai gives tool message content as a string, or as one text part when it adds a cache marker to it.
function rewriteToolMessage(message: unknown, attachment: FindAttachment) {
	if (!isRole(message, "tool")) return undefined;
	const [part] = Array.isArray(message.content) ? message.content : [];
	const text = typeof message.content === "string" ? message.content : textOf(part);
	const taken = text === undefined ? undefined : takeMarkerLines(text);
	if (!taken) return undefined;
	const content = isText(part) ? [{ ...part, text: taken.text }] : taken.text;
	return { message: { ...message, content }, parts: partsOf(taken.markers, attachment) };
}

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

// Tool messages take text only. pi-ai puts tool result images in one user message after the tool messages. The files go
// to the same place.
function placeAfterRun(messages: unknown[], end: number, parts: unknown[]) {
	const next = messages[end];
	if (isRole(next, "user") && Array.isArray(next.content) && textOf(next.content[0]) === "Attached image(s) from tool result:") {
		messages[end] = { ...next, content: [...next.content, ...parts] };
		return;
	}
	messages.splice(end, 0, { role: "user", content: [textPart("Attached file(s) from tool result:"), ...parts] });
}

// Replaces the markers in user messages and tool messages of a Chat Completions payload with file parts.
// Markers in other messages stay. Returns undefined when the payload has no marker to replace.
export function rewrite(payload: unknown, attachment: FindAttachment) {
	if (!isRecord(payload) || !Array.isArray(payload.messages)) return undefined;
	const messages: unknown[] = payload.messages;
	const users = messages.map((message) => rewriteUserMessage(message, attachment));
	const tools = messages.map((message) => rewriteToolMessage(message, attachment));
	if (users.every((user) => user === undefined) && tools.every((tool) => tool === undefined)) return undefined;
	const result = messages.map((message, index) => users[index] ?? tools[index]?.message ?? message);
	for (const { start, end } of toolRuns(messages).reverse()) {
		const parts = tools.slice(start, end).flatMap((tool) => tool?.parts ?? []);
		if (parts.length > 0) placeAfterRun(result, end, parts);
	}
	return { ...payload, messages: result };
}
