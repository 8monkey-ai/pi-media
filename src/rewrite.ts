import { readFile } from "node:fs/promises";
import { makeMarker, splitMarkers } from "./media.ts";

type FilePart = { type: "file"; file: { data: string; media_type: string } };
type ContentPart = { type: "text"; text: string } | FilePart;

async function toFilePart(path: string, mediaType: string): Promise<FilePart | undefined> {
	try {
		const bytes = await readFile(path);
		return { type: "file", file: { data: bytes.toString("base64"), media_type: mediaType } };
	} catch {
		return undefined;
	}
}

async function toParts(text: string) {
	const segments = splitMarkers(text);
	if (!segments.some((segment) => segment.type === "media")) return undefined;
	const parts: ContentPart[] = [];
	for (const segment of segments) {
		if (segment.type === "text") {
			parts.push(segment);
			continue;
		}
		const part = await toFilePart(segment.path, segment.mediaType);
		parts.push(part ?? { type: "text", text: makeMarker(segment.path, segment.mediaType) });
	}
	return parts;
}

function isTextPart(part: unknown): part is { type: "text"; text: string } {
	const candidate = part as { type?: unknown; text?: unknown } | null;
	return !!candidate && typeof candidate === "object" && candidate.type === "text" && typeof candidate.text === "string";
}

async function rewriteContent(content: unknown) {
	if (typeof content === "string") return toParts(content);
	if (!Array.isArray(content)) return undefined;
	const rewritten = await Promise.all(content.map((part) => (isTextPart(part) ? toParts(part.text) : undefined)));
	if (rewritten.every((parts) => parts === undefined)) return undefined;
	return content.flatMap((part, index) => rewritten[index] ?? [part]);
}

export async function rewritePayload(payload: unknown) {
	if (!payload || typeof payload !== "object") return undefined;
	const messages = (payload as { messages?: unknown }).messages;
	if (!Array.isArray(messages)) return undefined;
	const contents = await Promise.all(
		messages.map((msg) => (msg && typeof msg === "object" ? rewriteContent((msg as { content?: unknown }).content) : undefined)),
	);
	if (contents.every((content) => content === undefined)) return undefined;
	return { ...payload, messages: messages.map((msg, index) => (contents[index] ? { ...msg, content: contents[index] } : msg)) };
}
