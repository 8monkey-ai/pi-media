import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "@earendil-works/pi-ai";
import { stream } from "@earendil-works/pi-ai/api/bedrock-converse-stream";
import "../src/adapters/bedrock-converse-stream.ts";
import {
	adapterFor,
	assertPureRewrite,
	assistantOf,
	capturePayload,
	find,
	findIn,
	messagesOf,
	pdfNote,
	readTurn,
	testModel,
	text,
	readResult as toolResultOf,
	user as userOf,
} from "./pi-payload.ts";

const adapter = adapterFor({ api: "bedrock-converse-stream", provider: "amazon-bedrock" });

const pdf = "JVBERi0xLjQ=";
const rewrite = (payload: unknown) => adapter.rewrite(payload, find);

const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const docBlock = (name: string) => ({ document: { format: "pdf", name, source: { bytes: pdfBytes } } });
const mp3Block = { audio: { format: "mp3", source: { bytes: new Uint8Array([0xff, 0xfb, 0x90, 0x44, 0, 0, 0, 0]) } } };
const mp4Block = { video: { format: "mp4", source: { bytes: new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]) } } };
const cachePoint = { cachePoint: { type: "default" } };

const model = testModel("bedrock-converse-stream", {
	id: "anthropic.claude-sonnet-4-5-20250929-v1:0",
	name: "Claude Sonnet 4.5",
	provider: "amazon-bedrock",
	baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
	contextWindow: 200000,
	maxTokens: 1000,
});

// The Claude model makes pi-ai add a cache point to the last user message.
const payloadFor = async (messages: Message[]) =>
	(await capturePayload(stream, model, messages, { apiKey: "bedrock-test" })) as { messages: unknown[] };

const user = (...texts: string[]) => userOf(texts.map(text));

const assistant = assistantOf(model);

const single = (mimeType: string, path = "/gone/file") => findIn({ x: [{ path, mimeType, data: pdf }] });
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
		"constructor",
		"toString",
	];
	assert.deepEqual(
		types.map((type) => adapter.carries(type, "user")),
		[true, true, true, true, true, false, false, false, false, false, false],
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
	assert.deepEqual(messagesOf(rewrite(payload)), [
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

test("adds the text block that a message with a document needs when the message has no text", async () => {
	const payload = await payloadFor([
		user("[[pi-media:e1:2]]"),
		assistant([{ type: "text", text: "ok" }]),
		user("[[pi-media:e1:0]]"),
	]);
	assert.deepEqual(messagesOf(rewrite(payload)), [
		{ role: "user", content: [mp4Block] },
		{ role: "assistant", content: [{ text: "ok" }] },
		{ role: "user", content: [{ text: "doc" }, docBlock("doc"), cachePoint] },
	]);
});

test("removes a marker whose attachment is missing or of a type it does not carry, and keeps the typed text", async () => {
	const payload = await payloadFor([
		user("look at /gone/shot.heic", "[[pi-media:gone:0]]", "[[pi-media:e1:7]]", "[[pi-media:e1:3]]"),
	]);
	assert.deepEqual(messagesOf(rewrite(payload)), [{ role: "user", content: [{ text: "look at /gone/shot.heic" }, cachePoint] }]);
});

test("carries PDFs and video in tool results, and not audio", () => {
	const types = [
		"application/pdf",
		"video/mp4",
		"video/3gpp",
		"audio/mpeg",
		"audio/wav",
		"image/heic",
		"text/plain",
		"constructor",
		"toString",
	];
	assert.deepEqual(
		types.map((type) => adapter.carries(type, "toolResult")),
		[true, true, true, false, false, false, false, false, false],
	);
});

const readResult = (id: string, ...texts: string[]) => toolResultOf(id, texts.map(text));

const readPayload = () => payloadFor(readTurn(assistant, readResult("t1", pdfNote, "[[pi-media:e1:0]]")));
const readOf = (mimeType: string, path = "/tmp/x/report.pdf") => findIn({ e1: [{ path, mimeType, data: pdf }] });
const toolResult = (toolUseId: string, ...content: unknown[]) => ({ toolResult: { toolUseId, content, status: "success" } });

test("replaces a tool result marker with a document block and keeps the cache point last", async () => {
	const payload = await readPayload();
	assert.deepEqual(payload.messages[2], {
		role: "user",
		content: [toolResult("t1", { text: pdfNote }, { text: "[[pi-media:e1:0]]" }), cachePoint],
	});
	assert.deepEqual(messagesOf(adapter.rewrite(payload, readOf("application/pdf")))[2], {
		role: "user",
		content: [toolResult("t1", { text: pdfNote }, docBlock("report")), cachePoint],
	});
});

test("replaces a tool result marker with a video block", async () => {
	const payload = await readPayload();
	const result = messagesOf(adapter.rewrite(payload, readOf("video/mp4", "/tmp/x/clip.mp4")));
	assert.deepEqual(result[2], {
		role: "user",
		content: [toolResult("t1", { text: pdfNote }, { video: { format: "mp4", source: { bytes: pdfBytes } } }), cachePoint],
	});
});

test("removes a tool result marker whose attachment is missing or of a type it does not carry, and keeps the note", async () => {
	const payload = await readPayload();
	const expected = { role: "user", content: [toolResult("t1", { text: pdfNote }), cachePoint] };
	assert.deepEqual(messagesOf(adapter.rewrite(payload, readOf("audio/mpeg")))[2], expected);
	assert.deepEqual(messagesOf(adapter.rewrite(payload, () => undefined))[2], expected);
});

test("changes only the tool result with media when two tool results come in a row", async () => {
	const payload = await payloadFor([
		user("read both"),
		assistant(
			[
				{ type: "toolCall", id: "t1", name: "read", arguments: {} },
				{ type: "toolCall", id: "t2", name: "read", arguments: {} },
			],
			"toolUse",
		),
		readResult("t1", pdfNote, "[[pi-media:e1:0]]"),
		readResult("t2", "plain text"),
	]);
	assert.deepEqual(messagesOf(adapter.rewrite(payload, readOf("application/pdf")))[2], {
		role: "user",
		content: [toolResult("t1", { text: pdfNote }, docBlock("report")), toolResult("t2", { text: "plain text" }), cachePoint],
	});
});

test("gives each document in user messages and tool results a different name, in message order", async () => {
	const payload = await payloadFor([
		user("see /gone/doc.pdf", "[[pi-media:e1:0]]"),
		...readTurn(assistant, readResult("t1", "Read PDF file [application/pdf]: /gone/doc.pdf", "[[pi-media:e1:0]]")).slice(1),
		assistant([{ type: "text", text: "ok" }]),
		user("again /gone/doc.pdf and /other/doc.pdf", "[[pi-media:e1:0]]", "[[pi-media:e1:4]]"),
	]);
	assert.deepEqual(messagesOf(assertPureRewrite(adapter, payload, find)), [
		{ role: "user", content: [{ text: "see /gone/doc.pdf" }, docBlock("doc")] },
		payload.messages[1],
		{
			role: "user",
			content: [toolResult("t1", { text: "Read PDF file [application/pdf]: /gone/doc.pdf" }, docBlock("doc (2)"))],
		},
		{ role: "assistant", content: [{ text: "ok" }] },
		{
			role: "user",
			content: [{ text: "again /gone/doc.pdf and /other/doc.pdf" }, docBlock("doc (3)"), docBlock("doc (4)"), cachePoint],
		},
	]);
});

test("leaves user and tool result text that only contains a marker", async () => {
	const probe = "file says [[pi-media:abc:0]] literal";
	const payload = await payloadFor([
		user(probe, "see\n[[pi-media:abc:0]]"),
		...readTurn(assistant, readResult("t1", probe)).slice(1),
	]);
	assert.equal(rewrite(payload), undefined);
});

test("leaves markers in assistant messages", async () => {
	const payload = await payloadFor([user("go"), assistant([{ type: "text", text: "I saw [[pi-media:e1:0]]" }]), user("next")]);
	assert.deepEqual(payload.messages[1], { role: "assistant", content: [{ text: "I saw [[pi-media:e1:0]]" }] });
	assert.equal(rewrite(payload), undefined);
});

test("passes through payloads without a message list", () => {
	for (const payload of [undefined, "raw", { foo: 1 }, { messages: "nope" }, { messages: [null, 3] }]) {
		assert.equal(rewrite(payload), undefined);
	}
});
