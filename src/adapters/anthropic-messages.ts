import type { FindAttachment } from "./adapter.ts";
import { type Build, builderIn, carriesBy } from "./part-for.ts";
import { registerAdapter } from "./registry.ts";
import { type HolderList, isRecord, rewriteHolders, textBlocks } from "./text-holders.ts";

const documentBlock: Build = ({ data, mimeType }) => ({
	type: "document",
	source: { type: "base64", media_type: mimeType, data },
});

// Messages takes PDFs as document blocks, in user messages and in tool results.
const partFor = (mimeType: string) => (mimeType === "application/pdf" ? documentBlock : undefined);

// pi-ai puts `cache_control` on the last block of the last user message, and that block is often a marker.
// When the rewrite replaces or removes it, the new last block takes the cache marker.
function keepCacheControl(before: unknown, after: unknown[]) {
	const marked = Array.isArray(before) ? before.at(-1) : undefined;
	const last = after.at(-1);
	if (!isRecord(marked) || !marked.cache_control || !isRecord(last) || last === marked) return after;
	return after.with(-1, { ...last, cache_control: marked.cache_control });
}

const userMessages: HolderList = {
	...textBlocks,
	list: "messages",
	selects: (message) => message.role === "user",
	keepCacheMarker: keepCacheControl,
};

// pi-ai puts consecutive tool results in one user message of `tool_result` blocks. Each block keeps its text in
// `content`, as one joined string or as blocks, the same way a user message does.
const toolResultBlocks: HolderList = { ...textBlocks, list: "content", selects: (block) => block.type === "tool_result" };

function rewriteToolResults(payload: unknown, attachment: FindAttachment) {
	if (!isRecord(payload) || !Array.isArray(payload.messages)) return undefined;
	const messages: unknown[] = payload.messages;
	const build = builderIn(partFor, "toolResult");
	const rewritten = messages.map((message) => rewriteHolders(message, toolResultBlocks, attachment, build) ?? message);
	return rewritten.some((message, index) => message !== messages[index]) ? { ...payload, messages: rewritten } : undefined;
}

function rewrite(payload: unknown, attachment: FindAttachment) {
	const users = rewriteHolders(payload, userMessages, attachment, builderIn(partFor, "user"));
	return rewriteToolResults(users ?? payload, attachment) ?? users;
}

registerAdapter({ api: "anthropic-messages", carries: carriesBy(partFor), rewrite });
