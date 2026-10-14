import type { ChatCompletionContentPartText } from "openai/resources/chat/completions";
import { filePart } from "./file-parts.ts";
import { isRecord } from "./is-record.ts";
import { takeMarkers } from "./marker.ts";
import type { Attachment } from "./media-entry.ts";

export type FindAttachment = (entryId: string, index: number) => Attachment | undefined;
type Message = Record<string, unknown>;

const textOf = (node: unknown) =>
	isRecord(node) && node.type === "text" && typeof node.text === "string" ? node.text : undefined;
const textPart = (text: string) => ({ type: "text", text }) satisfies ChatCompletionContentPartText;
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

function cacheControlOf(content: unknown[]) {
	return content.filter(isText).find((node) => node.cache_control !== undefined)?.cache_control;
}

// pi-ai puts `cache_control` on the last text part of the last message, which is often a marker block.
// The same rule applied to the new content puts it where it would be without the marker.
function keepCacheControl(before: unknown[], after: unknown[]) {
	const cacheControl = cacheControlOf(before);
	if (cacheControl === undefined || cacheControlOf(after) !== undefined) return after;
	const last = after.findLastIndex(isText);
	const node = after[last];
	return isText(node) ? after.with(last, { ...node, cache_control: cacheControl }) : after;
}

// pi-ai joins text blocks into one string with "\n" (`joined`).
function splitText(text: string, joined: boolean, attachment: FindAttachment) {
	const taken = takeMarkers(text, joined);
	if (!taken) return undefined;
	const parts = partsOf(taken.markers, attachment);
	return taken.text ? [textPart(taken.text), ...parts] : parts;
}

function rewriteUserMessage(message: unknown, attachment: FindAttachment) {
	if (!isRole(message, "user")) return undefined;
	const { content } = message;
	if (typeof content === "string") {
		const parts = splitText(content, true, attachment);
		return parts && { ...message, content: parts };
	}
	if (!Array.isArray(content)) return undefined;
	const replaced = content.map((node) => {
		const text = textOf(node);
		return text === undefined ? undefined : splitText(text, false, attachment);
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

// pi-ai joins the text of a tool result with "\n".
function takeToolMarkers(text: string, attachment: FindAttachment) {
	const taken = takeMarkers(text, true);
	return taken && { text: taken.text, parts: partsOf(taken.markers, attachment) };
}

// Tool message content is a string, or text parts when pi-ai adds a cache marker to it.
function rewriteToolMessage(message: unknown, attachment: FindAttachment) {
	if (!isRole(message, "tool")) return undefined;
	const { content } = message;
	if (typeof content === "string") {
		const taken = takeToolMarkers(content, attachment);
		return taken && { message: { ...message, content: taken.text }, parts: taken.parts };
	}
	if (!Array.isArray(content)) return undefined;
	const taken = content.map((node) => {
		const text = textOf(node);
		return text === undefined ? undefined : takeToolMarkers(text, attachment);
	});
	if (taken.every((nodes) => nodes === undefined)) return undefined;
	return {
		message: { ...message, content: content.map((node, index) => (taken[index] ? { ...node, text: taken[index].text } : node)) },
		parts: taken.flatMap((nodes) => nodes?.parts ?? []),
	};
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
	if (isRole(next, "user") && Array.isArray(next.content) && textOf(next.content[0]) === "Attached image(s) from tool result:") {
		messages[at] = { ...next, content: [...next.content, ...parts] };
		return;
	}
	const files = { role: "user", content: [textPart("Attached file(s) from tool result:"), ...parts] };
	messages.splice(at, 0, ...(needsBridge && !bridged ? [{ ...bridge }, files] : [files]));
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
	const needsBridge = requiresAssistantAfterToolResult(messages);
	for (const { start, end } of toolRuns(messages).reverse()) {
		const parts = tools.slice(start, end).flatMap((tool) => tool?.parts ?? []);
		if (parts.length > 0) placeAfterRun(result, end, parts, needsBridge);
	}
	return { ...payload, messages: result };
}
