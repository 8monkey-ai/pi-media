import { splitMarkers } from "./marker.ts";
import type { Attachment } from "./media-entry.ts";

type FindAttachment = (entryId: string, index: number) => Attachment | undefined;
type FilePart = { type: "file"; file: { data: string; media_type: string } };
type ContentPart = { type: "text"; text: string } | FilePart;

// A marker without its attachment is removed.
function toParts(text: string, find: FindAttachment) {
	const segments = splitMarkers(text);
	if (!segments.some((segment) => segment.type === "media")) return undefined;
	return segments.flatMap((segment): ContentPart[] => {
		if (segment.type === "text") return [segment];
		const attachment = find(segment.entryId, segment.index);
		return attachment ? [{ type: "file", file: { data: attachment.data, media_type: attachment.mimeType } }] : [];
	});
}

function isTextPart(part: unknown): part is { type: "text"; text: string } {
	const candidate = part as { type?: unknown; text?: unknown } | null;
	return !!candidate && typeof candidate === "object" && candidate.type === "text" && typeof candidate.text === "string";
}

function rewriteContent(content: unknown, find: FindAttachment) {
	if (typeof content === "string") return toParts(content, find);
	if (!Array.isArray(content)) return undefined;
	const rewritten = content.map((part) => (isTextPart(part) ? toParts(part.text, find) : undefined));
	if (rewritten.every((parts) => parts === undefined)) return undefined;
	return content.flatMap((part, index) => rewritten[index] ?? [part]);
}

export function rewritePayload(payload: unknown, find: FindAttachment) {
	if (!payload || typeof payload !== "object") return undefined;
	const messages = (payload as { messages?: unknown }).messages;
	if (!Array.isArray(messages)) return undefined;
	const contents = messages.map((msg) =>
		msg && typeof msg === "object" ? rewriteContent((msg as { content?: unknown }).content, find) : undefined,
	);
	if (contents.every((content) => content === undefined)) return undefined;
	return { ...payload, messages: messages.map((msg, index) => (contents[index] ? { ...msg, content: contents[index] } : msg)) };
}
