import assert from "node:assert/strict";
import { test } from "node:test";
import { type AssistantMessage, type Message, type Model, normalizeContext } from "@earendil-works/pi-ai";
import { stream } from "@earendil-works/pi-ai/api/bedrock-converse-stream";
import "../src/adapters/bedrock-converse-stream.ts";
import { findAdapter } from "../src/adapters/registry.ts";

const adapter = findAdapter({ api: "bedrock-converse-stream", provider: "amazon-bedrock" });
assert.ok(adapter);

const pdf = "JVBERi0xLjQ=";
const attachments: Record<string, { path: string; mimeType: string; data: string }[]> = {
	e1: [
		{ path: "/gone/doc.pdf", mimeType: "application/pdf", data: pdf },
		{ path: "/gone/a.mp3", mimeType: "audio/mpeg", data: "//uQRAAAAAA=" },
		{ path: "/gone/clip.mp4", mimeType: "video/mp4", data: "AAAAGGZ0eXA=" },
		{ path: "/gone/shot.heic", mimeType: "image/heic", data: "AAAA" },
		{ path: "/other/doc.pdf", mimeType: "application/pdf", data: pdf },
	],
};
const find = (entryId: string, index: number) => attachments[entryId]?.[index];
const rewrite = (payload: unknown) => adapter.rewrite(payload, find);

const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const docBlock = (name: string) => ({ document: { format: "pdf", name, source: { bytes: pdfBytes } } });
const mp3Block = { audio: { format: "mp3", source: { bytes: new Uint8Array([0xff, 0xfb, 0x90, 0x44, 0, 0, 0, 0]) } } };
const mp4Block = { video: { format: "mp4", source: { bytes: new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]) } } };
const cachePoint = { cachePoint: { type: "default" } };

const model: Model<"bedrock-converse-stream"> = {
	id: "anthropic.claude-sonnet-4-5-20250929-v1:0",
	name: "Claude Sonnet 4.5",
	api: "bedrock-converse-stream",
	provider: "amazon-bedrock",
	baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
	reasoning: false,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200000,
	maxTokens: 1000,
};

// Builds the payload with pi-ai's own converter and stops before any network request.
// The Claude model makes pi-ai add a cache point to the last user message.
async function payloadFor(messages: Message[]) {
	let payload: unknown;
	const events = stream(model, normalizeContext({ messages }), {
		apiKey: "bedrock-test",
		onPayload: (params) => {
			payload = params;
			throw new Error("stop");
		},
	});
	for await (const _ of events);
	assert.ok(payload);
	return payload as { messages: unknown[] };
}

const user = (...texts: string[]): Message => ({
	role: "user",
	content: texts.map((text) => ({ type: "text", text })),
	timestamp: 1,
});

const assistant = (content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): Message => ({
	role: "assistant",
	content,
	api: "bedrock-converse-stream",
	provider: "amazon-bedrock",
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

const single =
	(mimeType: string, path = "/gone/file") =>
	(entryId: string, index: number) =>
		entryId === "x" && index === 0 ? { path, mimeType, data: pdf } : undefined;
const blockFor = (mimeType: string, path?: string) => {
	const result = adapter.rewrite(
		{ messages: [{ role: "user", content: [{ text: "[[pi-media:x:0]]" }] }] },
		single(mimeType, path),
	) as { messages: { content: unknown[] }[] } | undefined;
	return result?.messages[0].content;
};

test("carries PDFs and the video and audio types that Converse has a format for", () => {
	const types = [
		"application/pdf",
		"video/mp4",
		"video/quicktime",
		"audio/mpeg",
		"audio/ogg; codecs=opus",
		"video/x-ms-asf",
		"audio/amr",
		"image/heic",
		"text/plain",
	];
	assert.deepEqual(
		types.map((type) => adapter.carries(type)),
		[true, true, true, true, true, false, false, false, false],
	);
});

test("replaces marker blocks before the cache point with document, audio and video blocks", async () => {
	const payload = await payloadFor([user("see /gone/doc.pdf", "[[pi-media:e1:0]]", "[[pi-media:e1:1]]", "[[pi-media:e1:2]]")]);
	assert.deepEqual(payload.messages, [
		{
			role: "user",
			content: [
				{ text: "see /gone/doc.pdf" },
				{ text: "[[pi-media:e1:0]]" },
				{ text: "[[pi-media:e1:1]]" },
				{ text: "[[pi-media:e1:2]]" },
				cachePoint,
			],
		},
	]);
	assert.deepEqual((rewrite(payload) as typeof payload).messages, [
		{ role: "user", content: [{ text: "see /gone/doc.pdf" }, docBlock("doc"), mp3Block, mp4Block, cachePoint] },
	]);
});

test("maps each video and audio type to its Converse format", () => {
	const formats = {
		"video/mp4": ["video", "mp4"],
		"video/quicktime": ["video", "mov"],
		"video/webm": ["video", "webm"],
		"video/matroska": ["video", "mkv"],
		"video/x-flv": ["video", "flv"],
		"video/mpeg": ["video", "mpeg"],
		"video/3gpp": ["video", "three_gp"],
		"audio/mpeg": ["audio", "mp3"],
		"audio/wav": ["audio", "wav"],
		"audio/flac": ["audio", "flac"],
		"audio/aac": ["audio", "aac"],
		"audio/ogg": ["audio", "ogg"],
		"audio/ogg; codecs=opus": ["audio", "opus"],
		"audio/mp4": ["audio", "mp4"],
		"audio/x-m4a": ["audio", "m4a"],
	};
	for (const [mimeType, [kind, format]] of Object.entries(formats)) {
		assert.deepEqual(blockFor(mimeType), [{ [kind]: { format, source: { bytes: pdfBytes } } }], mimeType);
	}
});

test("derives a document name from the file name with only the characters Converse allows", () => {
	const names = {
		"/gone/My_Report (final).v2.pdf": "My Report (final) v2",
		"/gone/über  café [draft]-1.pdf": "uber cafe [draft]-1",
		"/gone/日本語.pdf": "document",
		"/gone/___.pdf": "document",
		[`/gone/${"a".repeat(199)} b.pdf`]: "a".repeat(199),
	};
	for (const [path, name] of Object.entries(names)) {
		assert.deepEqual(blockFor("application/pdf", path), [{ text: name }, docBlock(name)], path);
	}
});

test("gives each document in the request a different name, in message order", async () => {
	const payload = await payloadFor([
		user("first /gone/doc.pdf", "[[pi-media:e1:0]]"),
		assistant([{ type: "text", text: "ok" }]),
		user("again /gone/doc.pdf /other/doc.pdf", "[[pi-media:e1:0]]", "[[pi-media:e1:4]]"),
	]);
	const expected = [
		{ role: "user", content: [{ text: "first /gone/doc.pdf" }, docBlock("doc")] },
		{ role: "assistant", content: [{ text: "ok" }] },
		{
			role: "user",
			content: [{ text: "again /gone/doc.pdf /other/doc.pdf" }, docBlock("doc (2)"), docBlock("doc (3)"), cachePoint],
		},
	];
	assert.deepEqual((rewrite(payload) as typeof payload).messages, expected);
	assert.deepEqual((rewrite(payload) as typeof payload).messages, expected);
});

test("adds the text block that a message with a document needs when the message has no text", async () => {
	const payload = await payloadFor([
		user("[[pi-media:e1:2]]"),
		assistant([{ type: "text", text: "ok" }]),
		user("[[pi-media:e1:0]]"),
	]);
	assert.deepEqual((rewrite(payload) as typeof payload).messages, [
		{ role: "user", content: [mp4Block] },
		{ role: "assistant", content: [{ text: "ok" }] },
		{ role: "user", content: [{ text: "doc" }, docBlock("doc"), cachePoint] },
	]);
});

test("removes a marker whose attachment is missing or of a type it does not carry, and keeps the typed text", async () => {
	const payload = await payloadFor([
		user("look at /gone/shot.heic", "[[pi-media:gone:0]]", "[[pi-media:e1:7]]", "[[pi-media:e1:3]]"),
	]);
	assert.deepEqual((rewrite(payload) as typeof payload).messages, [
		{ role: "user", content: [{ text: "look at /gone/shot.heic" }, cachePoint] },
	]);
});

test("leaves markers in assistant messages and tool results", async () => {
	const payload = await payloadFor([
		user("go"),
		assistant(
			[
				{ type: "text", text: "I saw [[pi-media:e1:0]]" },
				{ type: "toolCall", id: "t1", name: "read", arguments: {} },
			],
			"toolUse",
		),
		{
			role: "toolResult",
			toolCallId: "t1",
			toolName: "read",
			content: [{ type: "text", text: "[[pi-media:e1:1]]" }],
			isError: false,
			timestamp: 1,
		},
	]);
	assert.deepEqual(payload.messages.slice(1), [
		{
			role: "assistant",
			content: [{ text: "I saw [[pi-media:e1:0]]" }, { toolUse: { toolUseId: "t1", name: "read", input: {} } }],
		},
		{
			role: "user",
			content: [{ toolResult: { toolUseId: "t1", content: [{ text: "[[pi-media:e1:1]]" }], status: "success" } }, cachePoint],
		},
	]);
	assert.equal(rewrite(payload), undefined);
});

test("keeps untouched messages by reference", async () => {
	const payload = await payloadFor([user("hello"), assistant([{ type: "text", text: "hi" }]), user("[[pi-media:e1:2]]")]);
	const result = rewrite(payload) as typeof payload;
	assert.equal(result.messages[0], payload.messages[0]);
	assert.equal(result.messages[1], payload.messages[1]);
	assert.deepEqual(result.messages[2], { role: "user", content: [mp4Block, cachePoint] });
});

test("passes through payloads without a message list", () => {
	for (const payload of [undefined, "raw", { foo: 1 }, { messages: "nope" }, { messages: [null, 3] }]) {
		assert.equal(rewrite(payload), undefined);
	}
});
