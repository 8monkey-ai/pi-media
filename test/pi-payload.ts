import assert from "node:assert/strict";
import {
	type Api,
	type AssistantMessage,
	type Message,
	type Model,
	normalizeContext,
	type StreamFunction,
	type StreamOptions,
	type ToolResultMessage,
	type UserMessage,
} from "@earendil-works/pi-ai";
import type { Adapter, FindAttachment } from "../src/adapters/adapter.ts";
import { findAdapter } from "../src/adapters/registry.ts";
import type { Attachment } from "../src/media-entry.ts";

export function adapterFor(model: { api: string; provider: string }) {
	const adapter = findAdapter(model);
	assert.ok(adapter);
	return adapter;
}

// Builds the payload with pi-ai's own converter. `onPayload` takes a copy of the payload and throws, so the request
// stops before any network call.
export async function capturePayload<TApi extends Api, TOptions extends StreamOptions>(
	stream: StreamFunction<TApi, TOptions>,
	model: Model<TApi>,
	messages: Message[],
	options: TOptions,
) {
	let payload: unknown;
	const onPayload = (params: unknown) => {
		payload = structuredClone(params);
		throw new Error("payload captured");
	};
	for await (const _ of stream(model, normalizeContext({ messages }), { ...options, onPayload }));
	assert.ok(payload);
	return payload;
}

// Checks that the rewrite does not change its input and gives the same result each time. Returns the result.
export function assertPureRewrite(adapter: Adapter, payload: unknown, find: FindAttachment) {
	const before = structuredClone(payload);
	const first = adapter.rewrite(payload, find);
	assert.notEqual(first, undefined);
	assert.deepEqual(adapter.rewrite(payload, find), first);
	assert.deepEqual(payload, before);
	return first;
}

export const attachments: Record<string, Attachment[]> = {
	e1: [
		{ path: "/gone/doc.pdf", mimeType: "application/pdf", data: "JVBERi0xLjQ=" },
		{ path: "/gone/a.mp3", mimeType: "audio/mpeg", data: "//uQRAAAAAA=" },
		{ path: "/gone/clip.mp4", mimeType: "video/mp4", data: "AAAAGGZ0eXA=" },
		{ path: "/gone/shot.heic", mimeType: "image/heic", data: "AAAA" },
		{ path: "/other/doc.pdf", mimeType: "application/pdf", data: "JVBERi0xLjQ=" },
	],
	abc: [{ path: "/gone/doc.pdf", mimeType: "application/pdf", data: "JVBERi0xLjQ=" }],
};

export const findIn =
	(table: Record<string, Attachment[]>): FindAttachment =>
	(entryId, index) =>
		table[entryId]?.[index];

export const find = findIn(attachments);

export const text = (value: string) => ({ type: "text" as const, text: value });

export const user = (content: UserMessage["content"]): Message => ({ role: "user", content, timestamp: 1 });

type AssistantFor = (content: AssistantMessage["content"], stopReason?: AssistantMessage["stopReason"]) => Message;

// An assistant message of the model, so that pi-ai converts it as its own earlier turn.
export function assistantOf(model: Pick<Model<Api>, "api" | "provider" | "id">): AssistantFor {
	return (content, stopReason = "stop") => ({
		role: "assistant",
		content,
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: 1,
	});
}

export const pdfNote = "Read PDF file [application/pdf]: /tmp/x/report.pdf";

// The content of a read tool result for a PDF: the note and the marker.
export const pdfRead = (marker: string) => [text(pdfNote), text(marker)];

export function readResult(toolCallId: string, content: ToolResultMessage["content"], isError = false): ToolResultMessage {
	return { role: "toolResult", toolCallId, toolName: "read", content, isError, timestamp: 1 };
}

// A user prompt, an assistant message that calls `read` once for each result, and the results.
export function readTurn(assistant: AssistantFor, ...results: ToolResultMessage[]): Message[] {
	const calls = results.map(({ toolCallId }) => ({
		type: "toolCall" as const,
		id: toolCallId,
		name: "read",
		arguments: { path: "/tmp/x/report.pdf" },
	}));
	return [user("read the file"), assistant(calls, "toolUse"), ...results];
}
