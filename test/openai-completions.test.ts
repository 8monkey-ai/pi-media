import assert from "node:assert/strict";
import { test } from "node:test";
import { type Model, normalizeContext } from "@earendil-works/pi-ai";
import { stream } from "@earendil-works/pi-ai/api/openai-completions";
import "../src/adapters/openai-completions.ts";
import { findAdapter } from "../src/adapters/registry.ts";

const adapter = findAdapter({ api: "openai-completions", provider: "any" });
assert.ok(adapter);

const attachments: Record<string, { path: string; mimeType: string; data: string }[]> = {
	e1: [
		{ path: "/gone/doc.pdf", mimeType: "application/pdf", data: "JVBERi0xLjQ=" },
		{ path: "/gone/a.mp3", mimeType: "audio/mpeg", data: "//uQRAAAAAA=" },
		{ path: "/gone/voice.wav", mimeType: "audio/wav", data: "UklGRiQAAAA=" },
		{ path: "/gone/clip.mp4", mimeType: "video/mp4", data: "AAAAGGZ0eXA=" },
		{ path: "/gone/song.ogg", mimeType: "audio/ogg", data: "T2dnUwAC" },
		{ path: "/gone/shot.heic", mimeType: "image/heic", data: "AAAA" },
	],
};
const find = (entryId: string, index: number) => attachments[entryId]?.[index];
const rewrite = (payload: unknown) => adapter.rewrite(payload, find);

const pdfPart = { type: "file", file: { filename: "doc.pdf", file_data: "data:application/pdf;base64,JVBERi0xLjQ=" } };
const mp3Part = { type: "input_audio", input_audio: { data: "//uQRAAAAAA=", format: "mp3" } };
const wavPart = { type: "input_audio", input_audio: { data: "UklGRiQAAAA=", format: "wav" } };

type UserContent = string | ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[];

// Builds the request body with pi-ai's own converter and stops before any network call.
async function piPayload(users: UserContent[], { provider = "openai", id = "gpt-4o" } = {}) {
	const model: Model<"openai-completions"> = {
		id,
		name: id,
		api: "openai-completions",
		provider,
		baseUrl: "http://127.0.0.1:9",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 100,
	};
	const controller = new AbortController();
	let payload: unknown;
	const events = stream(
		model,
		normalizeContext({ messages: users.map((content, index) => ({ role: "user", content, timestamp: index })) }),
		{
			apiKey: "test",
			signal: controller.signal,
			onPayload: (params) => {
				payload = structuredClone(params);
				controller.abort();
				return undefined;
			},
		},
	);
	for await (const _ of events);
	return payload as { messages: { content: unknown }[] };
}

const marker = (index: number) => ({ type: "text" as const, text: `[[pi-media:e1:${index}]]` });
const contentOf = (payload: unknown) => (payload as { messages: { content: unknown }[] }).messages.map((m) => m.content);

test("carries PDFs, wav and mp3, and no other types", () => {
	assert.deepEqual(
		[
			"application/pdf",
			"audio/wav",
			"audio/mpeg",
			"video/mp4",
			"audio/ogg",
			"audio/x-wav",
			"image/heic",
			"text/plain",
			"constructor",
		].map((type) => adapter.carries(type)),
		[true, true, true, false, false, false, false, false, false],
	);
});

test("replaces marker blocks with file and input_audio parts and keeps images and typed text", async () => {
	const payload = await piPayload([
		[
			{ type: "text", text: "see @doc.pdf" },
			{ type: "image", data: "xx", mimeType: "image/png" },
			marker(0),
			marker(1),
			marker(2),
		],
	]);
	assert.deepEqual(contentOf(rewrite(payload)), [
		[
			{ type: "text", text: "see @doc.pdf" },
			{ type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
			pdfPart,
			mp3Part,
			wavPart,
		],
	]);
});

test("splits string content around a marker", async () => {
	const payload = await piPayload(["read this\n[[pi-media:e1:0]] then that"]);
	assert.deepEqual(contentOf(rewrite(payload)), [
		[{ type: "text", text: "read this" }, pdfPart, { type: "text", text: "then that" }],
	]);
});

test("removes markers of video, other audio, other types and missing attachments, and keeps the typed text", async () => {
	const payload = await piPayload([
		[{ type: "text", text: "hi" }, { type: "text", text: "[[pi-media:gone:0]]" }, marker(9), marker(3), marker(4), marker(5)],
	]);
	assert.deepEqual(contentOf(rewrite(payload)), [[{ type: "text", text: "hi" }]]);
});

test("keeps the cache marker on the last text part when the marker block that held it is replaced", async () => {
	const payload = await piPayload(
		[
			[{ type: "text", text: "earlier @a.mp3" }, marker(1)],
			[{ type: "text", text: "see @doc.pdf" }, marker(0)],
		],
		{
			provider: "openrouter",
			id: "anthropic/claude-sonnet-4",
		},
	);
	assert.deepEqual(contentOf(payload)[1], [
		{ type: "text", text: "see @doc.pdf" },
		{ type: "text", text: "[[pi-media:e1:0]]", cache_control: { type: "ephemeral" } },
	]);
	assert.deepEqual(contentOf(rewrite(payload)), [
		[{ type: "text", text: "earlier @a.mp3" }, mp3Part],
		[{ type: "text", text: "see @doc.pdf", cache_control: { type: "ephemeral" } }, pdfPart],
	]);
});

test("keeps the cache marker of string content on the text before the marker", async () => {
	const payload = await piPayload(["read @doc.pdf\n[[pi-media:e1:0]]"], {
		provider: "openrouter",
		id: "anthropic/claude-sonnet-4",
	});
	assert.deepEqual(contentOf(rewrite(payload)), [
		[{ type: "text", text: "read @doc.pdf", cache_control: { type: "ephemeral" } }, pdfPart],
	]);
});

test("leaves markers in assistant, tool and system messages", () => {
	const payload = {
		messages: [
			{ role: "assistant", content: "I saw [[pi-media:e1:0]]" },
			{ role: "tool", tool_call_id: "t1", content: "[[pi-media:e1:1]]" },
			{ role: "system", content: [{ type: "text", text: "[[pi-media:e1:0]]" }] },
		],
	};
	assert.equal(rewrite(payload), undefined);
});

test("keeps untouched messages by reference", () => {
	const system = { role: "system", content: "sys" };
	const earlier = { role: "user", content: [{ type: "text", text: "hello" }] };
	const result = rewrite({ messages: [system, earlier, { role: "user", content: "[[pi-media:e1:0]]" }] }) as {
		messages: unknown[];
	};
	assert.equal(result.messages[0], system);
	assert.equal(result.messages[1], earlier);
	assert.deepEqual(result.messages[2], { role: "user", content: [pdfPart] });
});

test("returns undefined when no user message has a marker", () => {
	assert.equal(rewrite({ messages: [{ role: "user", content: "hello" }] }), undefined);
	assert.equal(rewrite({ messages: [{ role: "assistant", content: null }] }), undefined);
});

test("passes through payloads without a message list", () => {
	for (const payload of [undefined, "raw", { foo: 1 }, { messages: "nope" }, { messages: [null, 3] }]) {
		assert.equal(rewrite(payload), undefined);
	}
});
