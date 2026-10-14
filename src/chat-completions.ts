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

// Replaces the markers in user messages of a Chat Completions payload with file parts.
// Markers in other messages stay. Returns undefined when the payload has no marker to replace.
export function rewrite(payload: unknown, attachment: FindAttachment) {
	if (!isRecord(payload) || !Array.isArray(payload.messages)) return undefined;
	const messages: unknown[] = payload.messages;
	const users = messages.map((message) => rewriteUserMessage(message, attachment));
	if (users.every((user) => user === undefined)) return undefined;
	return { ...payload, messages: messages.map((message, index) => users[index] ?? message) };
}
