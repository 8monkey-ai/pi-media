import assert from "node:assert/strict";
import { test } from "node:test";
import { type AssistantMessage, type Message, type Model, normalizeContext } from "@earendil-works/pi-ai";
import { stream } from "@earendil-works/pi-ai/api/anthropic-messages";
import "../src/adapters/anthropic-messages.ts";
import { findAdapter } from "../src/adapters/registry.ts";

const adapter = findAdapter({ api: "anthropic-messages", provider: "anthropic" });
assert.ok(adapter);

const attachments: Record<string, { path: string; mimeType: string; data: string }[]> = {
	e1: [
		{ path: "/gone/doc.pdf", mimeType: "application/pdf", data: "JVBERi0xLjQ=" },
		{ path: "/gone/a.mp3", mimeType: "audio/mpeg", data: "//uQRAAAAAA=" },
		{ path: "/gone/clip.mp4", mimeType: "video/mp4", data: "AAAAGGZ0eXA=" },
	],
};
const find = (entryId: string, index: number) => attachments[entryId]?.[index];
const rewrite = (payload: unknown) => adapter.rewrite(payload, find);

const pdfBlock = { type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0xLjQ=" } };
const cache = { cache_control: { type: "ephemeral" } };

const model: Model<"anthropic-messages"> = {
	id: "claude-test",
	name: "Claude test",
	api: "anthropic-messages",
	provider: "anthropic",
	baseUrl: "https://api.anthropic.com",
	reasoning: false,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200000,
	maxTokens: 1000,
};

// Builds the payload with pi-ai's own converter and stops before any network request.
async function payloadFor(messages: Message[]) {
	let payload: unknown;
	const events = stream(model, normalizeContext({ messages }), {
		apiKey: "sk-ant-test",
		onPayload: (params) => {
			payload = params;
			throw new Error("stop");
		},
	});
	for await (const _ of events);
	assert.ok(payload);
	return payload as { messages: unknown[] };
}

const user = (content: Extract<Message, { role: "user" }>["content"]): Message => ({ role: "user", content, timestamp: 1 });
const text = (value: string) => ({ type: "text" as const, text: value });

const assistant = (content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): Message => ({
	role: "assistant",
	content,
	api: "anthropic-messages",
	provider: "anthropic",
	model: "claude-test",
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

test("carries PDFs, and no audio, video or other types", () => {
	assert.deepEqual(
		["application/pdf", "audio/mpeg", "audio/wav", "video/mp4", "image/png", "text/plain"].map((type) => adapter.carries(type)),
		[true, false, false, false, false, false],
	);
});

test("replaces the marker block with a document block and moves the cache marker to it", async () => {
	const payload = await payloadFor([user([text("see @doc.pdf"), text("[[pi-media:e1:0]]")])]);
	assert.deepEqual(rewrite(payload), {
		model: "claude-test",
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: "see @doc.pdf" },
					{ ...pdfBlock, ...cache },
				],
			},
		],
		max_tokens: 1000,
		stream: true,
	});
});

test("removes markers of audio and video and moves the cache marker to the typed text", async () => {
	const payload = await payloadFor([user([text("hear @a.mp3 @clip.mp4"), text("[[pi-media:e1:1]]"), text("[[pi-media:e1:2]]")])]);
	assert.deepEqual((rewrite(payload) as { messages: unknown }).messages, [
		{ role: "user", content: [{ type: "text", text: "hear @a.mp3 @clip.mp4", ...cache }] },
	]);
});

test("removes a marker whose attachment is missing", async () => {
	const payload = await payloadFor([user([text("hi"), text("[[pi-media:gone:0]]"), text("[[pi-media:e1:7]]")])]);
	assert.deepEqual((rewrite(payload) as { messages: unknown }).messages, [
		{ role: "user", content: [{ type: "text", text: "hi", ...cache }] },
	]);
});

test("keeps the cache marker on a last block that is not a marker", async () => {
	const payload = await payloadFor([user([text("[[pi-media:e1:0]]"), text("then this")])]);
	assert.deepEqual((rewrite(payload) as { messages: unknown }).messages, [
		{ role: "user", content: [pdfBlock, { type: "text", text: "then this", ...cache }] },
	]);
});

test("splits string content around a marker", async () => {
	const payload = await payloadFor([user("read [[pi-media:e1:0]] now"), assistant([text("ok")]), user("next")]);
	assert.deepEqual((rewrite(payload) as { messages: unknown }).messages, [
		{ role: "user", content: [{ type: "text", text: "read" }, pdfBlock, { type: "text", text: "now" }] },
		{ role: "assistant", content: [{ type: "text", text: "ok" }] },
		{ role: "user", content: [{ type: "text", text: "next", ...cache }] },
	]);
});

test("moves the cache marker when pi-ai turns the last string content into a block", async () => {
	const payload = await payloadFor([user("see this\n[[pi-media:e1:0]]")]);
	assert.deepEqual((rewrite(payload) as { messages: unknown }).messages, [
		{
			role: "user",
			content: [
				{ type: "text", text: "see this" },
				{ ...pdfBlock, ...cache },
			],
		},
	]);
});

test("leaves markers in assistant messages and tool results", async () => {
	const payload = await payloadFor([
		user("look"),
		assistant([text("I saw [[pi-media:e1:0]]"), { type: "toolCall", id: "t1", name: "read", arguments: {} }], "toolUse"),
		{
			role: "toolResult",
			toolCallId: "t1",
			toolName: "read",
			content: [text("[[pi-media:e1:0]]")],
			isError: false,
			timestamp: 1,
		},
	]);
	assert.equal(rewrite(payload), undefined);
});

test("keeps untouched messages by reference and gives the same result each time", async () => {
	const payload = await payloadFor([user("hello"), assistant([text("hi")]), user([text("see"), text("[[pi-media:e1:0]]")])]);
	const first = rewrite(payload) as { messages: unknown[] };
	assert.equal(first.messages[0], payload.messages[0]);
	assert.equal(first.messages[1], payload.messages[1]);
	assert.deepEqual(rewrite(payload), first);
	assert.deepEqual(payload.messages[2], {
		role: "user",
		content: [
			{ type: "text", text: "see" },
			{ type: "text", text: "[[pi-media:e1:0]]", ...cache },
		],
	});
});

test("returns undefined when no user message has a marker", async () => {
	assert.equal(rewrite(await payloadFor([user("hello")])), undefined);
	for (const payload of [undefined, "raw", { foo: 1 }, { messages: "nope" }, { messages: [null, 3] }]) {
		assert.equal(rewrite(payload), undefined);
	}
});
