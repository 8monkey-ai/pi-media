import { hasSentinel, splitTextWithSentinels } from "./media.ts";

function rewriteContent(content: unknown): unknown | undefined {
	if (typeof content === "string") {
		return hasSentinel(content) ? splitTextWithSentinels(content) : undefined;
	}
	if (!Array.isArray(content)) return undefined;
	let changed = false;
	const parts = content.flatMap((part) => {
		if (part && typeof part === "object" && part.type === "text" && typeof part.text === "string" && hasSentinel(part.text)) {
			changed = true;
			return splitTextWithSentinels(part.text);
		}
		return [part];
	});
	return changed ? parts : undefined;
}

export function rewritePayload(payload: unknown) {
	if (!payload || typeof payload !== "object") return undefined;
	const messages = (payload as { messages?: unknown }).messages;
	if (!Array.isArray(messages)) return undefined;
	let changed = false;
	const rewritten = messages.map((msg) => {
		if (!msg || typeof msg !== "object") return msg;
		const content = rewriteContent((msg as { content?: unknown }).content);
		if (content === undefined) return msg;
		changed = true;
		return { ...msg, content };
	});
	return changed ? { ...payload, messages: rewritten } : undefined;
}
