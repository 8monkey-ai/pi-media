import { basename } from "node:path";
import { isRecord } from "../is-record.ts";
import { takeMarkers } from "../marker.ts";
import type { FindAttachment } from "./adapter.ts";
import { type Build, builderIn, type PartFor } from "./part-for.ts";
import { buildParts, type Holder, type HolderList, rewriteHolders, textBlocks } from "./text-holders.ts";

const pdfFilePart: Build = ({ path, data }) => ({
	type: "file",
	file: { filename: basename(path), file_data: `data:application/pdf;base64,${data}` },
});

const inputAudioPart =
	(format: string): Build =>
	({ data }) => ({ type: "input_audio", input_audio: { data, format } });

// Chat Completions takes PDFs as file parts and audio as input_audio parts. `audioFormats` maps the audio MIME types
// that the provider accepts to their format names.
export function pdfOrAudioPart(mimeType: string, audioFormats: ReadonlyMap<string, string>) {
	if (mimeType === "application/pdf") return pdfFilePart;
	const format = audioFormats.get(mimeType);
	return format === undefined ? undefined : inputAudioPart(format);
}

const isText = (node: unknown): node is Holder => textBlocks.textOf(node) !== undefined;

function cacheControlOf(content: unknown) {
	if (!Array.isArray(content)) return undefined;
	return content.find((node) => isText(node) && node.cache_control !== undefined)?.cache_control;
}

// pi-ai puts `cache_control` on the last text part of the last message, which is often a marker block.
// The same rule applied to the new content puts it where it would be without the marker.
function keepCacheControl(before: unknown, after: unknown[]) {
	const cacheControl = cacheControlOf(before);
	if (cacheControl === undefined || cacheControlOf(after) !== undefined) return after;
	const last = after.findLastIndex(isText);
	const node = after[last];
	return isText(node) ? after.with(last, { ...node, cache_control: cacheControl }) : after;
}

const userMessages: HolderList = {
	...textBlocks,
	list: "messages",
	selects: (message) => message.role === "user",
	keepCacheMarker: keepCacheControl,
};

// pi-ai joins the text of a tool result with line breaks.
function takeToolMarkers(text: string, attachment: FindAttachment, build: Build) {
	const taken = takeMarkers(text, true);
	if (!taken) return undefined;
	return { text: taken.text, parts: buildParts(taken.markers, attachment, build) };
}

// Tool message content is a string, or text parts when pi-ai adds a cache marker to it.
function rewriteToolMessage(message: Holder, attachment: FindAttachment, build: Build) {
	const { content } = message;
	if (typeof content === "string") {
		const taken = takeToolMarkers(content, attachment, build);
		return taken && { message: { ...message, content: taken.text }, parts: taken.parts };
	}
	if (!Array.isArray(content)) return undefined;
	const taken = content.map((node) => {
		const text = textBlocks.textOf(node);
		return text === undefined ? undefined : takeToolMarkers(text, attachment, build);
	});
	if (taken.every((nodes) => nodes === undefined)) return undefined;
	return {
		message: { ...message, content: content.map((node, index) => (taken[index] ? { ...node, text: taken[index].text } : node)) },
		parts: taken.flatMap((nodes) => nodes?.parts ?? []),
	};
}

const isRole = (message: unknown, role: string): message is Holder => isRecord(message) && message.role === role;

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
		textBlocks.textOf(next.content[0]) === "Attached image(s) from tool result:"
	) {
		messages[at] = { ...next, content: [...next.content, ...parts] };
		return;
	}
	const files = { role: "user", content: [textBlocks.textNode("Attached file(s) from tool result:"), ...parts] };
	messages.splice(at, 0, ...(needsBridge && !bridged ? [{ ...bridge }, files] : [files]));
}

function rewriteToolResults(payload: unknown, attachment: FindAttachment, build: Build) {
	if (!isRecord(payload) || !Array.isArray(payload.messages)) return undefined;
	const messages: unknown[] = payload.messages;
	const rewritten = messages.map((message) =>
		isRole(message, "tool") ? rewriteToolMessage(message, attachment, build) : undefined,
	);
	if (rewritten.every((result) => result === undefined)) return undefined;
	const result = messages.map((message, index) => rewritten[index]?.message ?? message);
	const needsBridge = requiresAssistantAfterToolResult(messages);
	for (const { start, end } of toolRuns(messages).reverse()) {
		const parts = rewritten.slice(start, end).flatMap((rewrite) => rewrite?.parts ?? []);
		if (parts.length > 0) placeAfterRun(result, end, parts, needsBridge);
	}
	return { ...payload, messages: result };
}

// Replaces markers in Chat Completions user messages and tool results with the parts that `partFor` picks.
export function rewriteChatMessages(payload: unknown, attachment: FindAttachment, partFor: PartFor) {
	const users = rewriteHolders(payload, userMessages, attachment, builderIn(partFor, "user"));
	return rewriteToolResults(users ?? payload, attachment, builderIn(partFor, "toolResult")) ?? users;
}
