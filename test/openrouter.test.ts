import assert from "node:assert/strict";
import { test } from "node:test";
import { type Message, type Model, normalizeContext } from "@earendil-works/pi-ai";
import { stream } from "@earendil-works/pi-ai/api/openai-completions";
import "../src/adapters/openai-completions.ts";
import "../src/adapters/openrouter.ts";
import { findAdapter } from "../src/adapters/registry.ts";

const adapter = findAdapter({ api: "openai-completions", provider: "openrouter" });
assert.ok(adapter);

const attachments: Record<string, { path: string; mimeType: string; data: string }[]> = {
	e1: [
		{ path: "/gone/doc.pdf", mimeType: "application/pdf", data: "JVBERi0xLjQ=" },
		{ path: "/gone/voice.wav", mimeType: "audio/wav", data: "UklGRiQAAAA=" },
		{ path: "/gone/a.mp3", mimeType: "audio/mpeg", data: "//uQRAAAAAA=" },
		{ path: "/gone/a.aiff", mimeType: "audio/aiff", data: "Rk9STQ==" },
		{ path: "/gone/a.aac", mimeType: "audio/aac", data: "//FQ" },
		{ path: "/gone/a.ogg", mimeType: "audio/ogg", data: "T2dnUwAC" },
		{ path: "/gone/a.flac", mimeType: "audio/flac", data: "ZkxhQw==" },
		{ path: "/gone/a.m4a", mimeType: "audio/x-m4a", data: "AAAAHGZ0eXBNNEE=" },
		{ path: "/gone/clip.mp4", mimeType: "video/mp4", data: "AAAAGGZ0eXA=" },
		{ path: "/gone/clip.mpg", mimeType: "video/mpeg", data: "AAABug==" },
		{ path: "/gone/clip.webm", mimeType: "video/webm", data: "GkXfow==" },
		{ path: "/gone/clip.mov", mimeType: "video/quicktime", data: "AAAAFGZ0eXBxdA==" },
		{ path: "/gone/a.opus", mimeType: "audio/ogg; codecs=opus", data: "T2dnUwAC" },
		{ path: "/gone/a.m4b", mimeType: "audio/mp4", data: "AAAAHGZ0eXBNNEI=" },
		{ path: "/gone/shot.heic", mimeType: "image/heic", data: "AAAA" },
	],
	abc: [{ path: "/gone/doc.pdf", mimeType: "application/pdf", data: "JVBERi0xLjQ=" }],
};
const find = (entryId: string, index: number) => attachments[entryId]?.[index];
const rewrite = (payload: unknown) => adapter.rewrite(payload, find);

const pdfPart = { type: "file", file: { filename: "doc.pdf", file_data: "data:application/pdf;base64,JVBERi0xLjQ=" } };
const audioPart = (data: string, format: string) => ({ type: "input_audio", input_audio: { data, format } });
const videoPart = (url: string) => ({ type: "video_url", video_url: { url } });

type UserContent = string | ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[];

// Builds the request body with pi-ai's own converter for an OpenRouter model and stops before any network call.
async function piMessagesPayload(messages: Message[], id = "google/gemini-2.5-flash") {
	const model: Model<"openai-completions"> = {
		id,
		name: id,
		api: "openai-completions",
		provider: "openrouter",
		baseUrl: "https://openrouter.ai/api/v1",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 100,
	};
	const controller = new AbortController();
	let payload: unknown;
	const events = stream(model, normalizeContext({ messages }), {
		apiKey: "test",
		signal: controller.signal,
		onPayload: (params) => {
			payload = structuredClone(params);
			controller.abort();
			return undefined;
		},
	});
	for await (const _ of events);
	return payload as { messages: Record<string, unknown>[] };
}

const piPayload = (users: UserContent[], id?: string) =>
	piMessagesPayload(
		users.map((content, index) => ({ role: "user", content, timestamp: index })),
		id,
	);

const marker = (index: number) => ({ type: "text" as const, text: `[[pi-media:e1:${index}]]` });
const contentOf = (payload: unknown) => (payload as { messages: { content: unknown }[] }).messages.map((m) => m.content);

test("takes priority over the Chat Completions adapter for OpenRouter only", () => {
	assert.equal(findAdapter({ api: "openai-completions", provider: "openai" })?.carries("video/mp4", "user"), false);
	assert.equal(adapter.carries("video/mp4", "user"), true);
});

test("carries PDFs, the audio formats and the video types that OpenRouter lists, and no other types", () => {
	assert.deepEqual(
		[
			"application/pdf",
			"audio/wav",
			"audio/mpeg",
			"audio/aiff",
			"audio/aac",
			"audio/ogg",
			"audio/flac",
			"audio/x-m4a",
			"video/mp4",
			"video/mpeg",
			"video/webm",
			"video/quicktime",
			"audio/ogg; codecs=opus",
			"audio/mp4",
			"video/ogg",
			"image/heic",
			"text/plain",
			"constructor",
		].map((type) => [adapter.carries(type, "user"), adapter.carries(type, "toolResult")]),
		[true, true, true, true, true, true, true, true, true, true, true, false, false, false, false, false, false, false].map(
			(carried) => [carried, carried],
		),
	);
});

test("replaces marker blocks with file, input_audio and video_url parts and keeps images and typed text", async () => {
	const payload = await piPayload([
		[
			{ type: "text", text: "see these" },
			{ type: "image", data: "xx", mimeType: "image/png" },
			...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(marker),
		],
	]);
	assert.deepEqual(contentOf(rewrite(payload)), [
		[
			{ type: "text", text: "see these" },
			{ type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
			pdfPart,
			audioPart("UklGRiQAAAA=", "wav"),
			audioPart("//uQRAAAAAA=", "mp3"),
			audioPart("Rk9STQ==", "aiff"),
			audioPart("//FQ", "aac"),
			audioPart("T2dnUwAC", "ogg"),
			audioPart("ZkxhQw==", "flac"),
			audioPart("AAAAHGZ0eXBNNEE=", "m4a"),
			videoPart("data:video/mp4;base64,AAAAGGZ0eXA="),
			videoPart("data:video/mpeg;base64,AAABug=="),
			videoPart("data:video/webm;base64,GkXfow=="),
		],
	]);
});

test("replaces the marker lines at the end of string content", async () => {
	const payload = await piPayload(["watch this\n[[pi-media:e1:8]]", "hi"]);
	assert.deepEqual(contentOf(rewrite(payload)), [
		[{ type: "text", text: "watch this" }, videoPart("data:video/mp4;base64,AAAAGGZ0eXA=")],
		"hi",
	]);
});

test("leaves user and tool result text that only contains a marker", async () => {
	const probe = "file says [[pi-media:abc:0]] literal";
	const payload = await piMessagesPayload([
		{ role: "user", content: probe, timestamp: 0 },
		{ role: "user", content: [{ type: "text", text: probe }], timestamp: 0 },
		readTurn[1],
		{ ...readTurn[2], content: [{ type: "text", text: probe }] } as Message,
	]);
	assert.equal(rewrite(payload), undefined);
});

test("removes markers of types it does not carry and of missing attachments, and keeps the typed text", async () => {
	const payload = await piPayload([
		[
			{ type: "text", text: "hi" },
			{ type: "text", text: "[[pi-media:gone:0]]" },
			marker(99),
			marker(11),
			marker(12),
			marker(13),
			marker(14),
		],
	]);
	assert.deepEqual(contentOf(rewrite(payload)), [[{ type: "text", text: "hi" }]]);
});

test("keeps the cache marker of anthropic models on the last text part when the marker block that held it is replaced", async () => {
	const payload = await piPayload(
		[
			[{ type: "text", text: "earlier" }, marker(1)],
			[{ type: "text", text: "watch @clip.mp4" }, marker(8)],
		],
		"anthropic/claude-sonnet-4",
	);
	assert.deepEqual(contentOf(payload)[1], [
		{ type: "text", text: "watch @clip.mp4" },
		{ type: "text", text: "[[pi-media:e1:8]]", cache_control: { type: "ephemeral" } },
	]);
	assert.deepEqual(contentOf(rewrite(payload)), [
		[{ type: "text", text: "earlier" }, audioPart("UklGRiQAAAA=", "wav")],
		[
			{ type: "text", text: "watch @clip.mp4", cache_control: { type: "ephemeral" } },
			videoPart("data:video/mp4;base64,AAAAGGZ0eXA="),
		],
	]);
});

test("leaves markers in assistant and system messages", () => {
	const payload = {
		messages: [
			{ role: "assistant", content: "I saw [[pi-media:e1:8]]" },
			{ role: "system", content: [{ type: "text", text: "[[pi-media:e1:0]]" }] },
		],
	};
	assert.equal(rewrite(payload), undefined);
});

test("keeps untouched messages by reference", () => {
	const system = { role: "system", content: "sys" };
	const earlier = { role: "user", content: [{ type: "text", text: "hello" }] };
	const result = rewrite({ messages: [system, earlier, { role: "user", content: "[[pi-media:e1:10]]" }] }) as {
		messages: unknown[];
	};
	assert.equal(result.messages[0], system);
	assert.equal(result.messages[1], earlier);
	assert.deepEqual(result.messages[2], { role: "user", content: [videoPart("data:video/webm;base64,GkXfow==")] });
});

const usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const pdfNote = "Read PDF file [application/pdf]: /tmp/x/report.pdf";

// A user prompt, an assistant message that calls `read`, and its result with the note and the marker.
const readTurn: Message[] = [
	{ role: "user", content: "read the file", timestamp: 0 },
	{
		role: "assistant",
		content: [{ type: "toolCall", id: "call_1", name: "read", arguments: { path: "/tmp/x/report.pdf" } }],
		api: "openai-completions",
		provider: "openrouter",
		model: "google/gemini-2.5-flash",
		usage,
		stopReason: "toolUse",
		timestamp: 1,
	},
	{
		role: "toolResult",
		toolCallId: "call_1",
		toolName: "read",
		content: [
			{ type: "text", text: pdfNote },
			{ type: "text", text: "[[pi-media:e1:0]]" },
		],
		isError: false,
		timestamp: 2,
	},
];

const toolTail = async (attachment: { path: string; mimeType: string; data: string } | undefined) => {
	const payload = await piMessagesPayload(readTurn);
	const result = adapter.rewrite(payload, (entryId, index) => (entryId === "e1" && index === 0 ? attachment : undefined));
	return (result as { messages: unknown[] }).messages.slice(2);
};
const toolNote = { role: "tool", content: pdfNote, tool_call_id: "call_1" };

test("moves each carried kind from a tool result to a user message after it", async () => {
	const kinds = [
		[0, pdfPart],
		[1, audioPart("UklGRiQAAAA=", "wav")],
		[2, audioPart("//uQRAAAAAA=", "mp3")],
		[3, audioPart("Rk9STQ==", "aiff")],
		[4, audioPart("//FQ", "aac")],
		[5, audioPart("T2dnUwAC", "ogg")],
		[6, audioPart("ZkxhQw==", "flac")],
		[7, audioPart("AAAAHGZ0eXBNNEE=", "m4a")],
		[8, videoPart("data:video/mp4;base64,AAAAGGZ0eXA=")],
		[9, videoPart("data:video/mpeg;base64,AAABug==")],
		[10, videoPart("data:video/webm;base64,GkXfow==")],
	] as const;
	for (const [index, part] of kinds) {
		assert.deepEqual(await toolTail(attachments.e1[index]), [
			toolNote,
			{ role: "user", content: [{ type: "text", text: "Attached file(s) from tool result:" }, part] },
		]);
	}
});

test("removes the tool result marker of a type it does not carry or a missing attachment, and keeps the note", async () => {
	for (const attachment of [attachments.e1[11], attachments.e1[13], undefined]) {
		assert.deepEqual(await toolTail(attachment), [toolNote]);
	}
});
