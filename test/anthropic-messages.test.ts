import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message, Model } from "@earendil-works/pi-ai";
import { stream } from "@earendil-works/pi-ai/api/anthropic-messages";
import "../src/adapters/anthropic-messages.ts";
import {
	adapterFor,
	assertPureRewrite,
	assistantOf,
	capturePayload,
	find,
	pdfNote,
	pdfRead,
	readTurn,
	text,
	readResult as toolResult,
	user,
} from "./pi-payload.ts";

const adapter = adapterFor({ api: "anthropic-messages", provider: "anthropic" });

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

const payloadFor = async (messages: Message[]) =>
	(await capturePayload(stream, model, messages, { apiKey: "sk-ant-test" })) as { messages: unknown[] };

const assistant = assistantOf(model);

test("carries PDFs, and no audio, video or other types, in user messages and tool results", () => {
	const types = ["application/pdf", "audio/mpeg", "audio/wav", "video/mp4", "image/png", "text/plain"];
	assert.deepEqual(
		types.map((type) => adapter.carries(type, "user")),
		[true, false, false, false, false, false],
	);
	assert.deepEqual(
		types.map((type) => adapter.carries(type, "toolResult")),
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

test("replaces the marker lines at the end of string content", async () => {
	const payload = await payloadFor([user("read this\n[[pi-media:e1:0]]"), assistant([text("ok")]), user("next")]);
	assert.deepEqual((rewrite(payload) as { messages: unknown }).messages, [
		{ role: "user", content: [{ type: "text", text: "read this" }, pdfBlock] },
		{ role: "assistant", content: [{ type: "text", text: "ok" }] },
		{ role: "user", content: [{ type: "text", text: "next", ...cache }] },
	]);
});

test("leaves user text that only contains a marker", async () => {
	const payload = await payloadFor([
		user("file says [[pi-media:abc:0]] literal"),
		assistant([text("ok")]),
		user("[[pi-media:abc:0]]\nmore"),
		assistant([text("ok")]),
		user([text("file says [[pi-media:abc:0]] literal"), text("see\n[[pi-media:abc:0]]")]),
	]);
	assert.equal(rewrite(payload), undefined);
});

test("leaves markers in assistant messages", async () => {
	const payload = await payloadFor([user("look"), assistant([text("I saw [[pi-media:e1:0]]")]), user("ok")]);
	assert.equal(rewrite(payload), undefined);
});

const readPdf = (marker: string) => readTurn(assistant, toolResult("t1", pdfRead(marker)));

test("puts the PDF of a read tool result in the tool_result content and keeps its cache marker", async () => {
	const payload = await payloadFor(readPdf("[[pi-media:e1:0]]"));
	assert.deepEqual((rewrite(payload) as { messages: unknown[] }).messages[2], {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: "t1",
				content: [{ type: "text", text: pdfNote }, pdfBlock],
				is_error: false,
				...cache,
			},
		],
	});
});

test("replaces a marker block in tool_result content that pi-ai keeps as blocks because of an image", async () => {
	const image = { type: "image" as const, mimeType: "image/png", data: "iVBORw0=" };
	const payload = await payloadFor(readTurn(assistant, toolResult("t1", [text(pdfNote), image, text("[[pi-media:e1:0]]")])));
	assert.deepEqual((rewrite(payload) as { messages: unknown[] }).messages[2], {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: "t1",
				content: [
					{ type: "text", text: pdfNote },
					{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0=" } },
					pdfBlock,
				],
				is_error: false,
				...cache,
			},
		],
	});
});

test("removes a tool result marker whose kind is not carried or whose attachment is missing, and keeps the note", async () => {
	for (const marker of ["[[pi-media:e1:1]]", "[[pi-media:e1:2]]", "[[pi-media:gone:0]]"]) {
		const payload = await payloadFor(readPdf(marker));
		assert.deepEqual((rewrite(payload) as { messages: unknown[] }).messages[2], {
			role: "user",
			content: [
				{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: pdfNote }], is_error: false, ...cache },
			],
		});
	}
});

test("leaves tool result text that only contains a marker", async () => {
	for (const content of [[text("file says [[pi-media:abc:0]] literal")], [text("a"), text("b [[pi-media:abc:0]]")]]) {
		const payload = await payloadFor(readTurn(assistant, toolResult("t1", content)));
		assert.equal(rewrite(payload), undefined);
	}
});

test("takes only the marker lines at the end of a tool result", async () => {
	const payload = await payloadFor(
		readTurn(assistant, toolResult("t1", [text("first\n[[pi-media:abc:0]]\nlast"), text("[[pi-media:e1:0]]")])),
	);
	assert.deepEqual((rewrite(payload) as { messages: unknown[] }).messages[2], {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: "t1",
				content: [{ type: "text", text: "first\n[[pi-media:abc:0]]\nlast" }, pdfBlock],
				is_error: false,
				...cache,
			},
		],
	});
});

test("rewrites one of two tool results in a row, and a user message marker in the same payload", async () => {
	const payload = await payloadFor([
		user([text("see @doc.pdf"), text("[[pi-media:e1:0]]")]),
		assistant(
			[
				{ type: "toolCall", id: "t1", name: "read", arguments: { path: "/tmp/x/report.pdf" } },
				{ type: "toolCall", id: "t2", name: "read", arguments: { path: "/tmp/x/a.txt" } },
			],
			"toolUse",
		),
		toolResult("t1", [text(pdfNote), text("[[pi-media:e1:0]]")]),
		toolResult("t2", [text("hello")]),
		assistant([text("done")]),
		user("thanks"),
	]);
	const result = assertPureRewrite(adapter, payload, find) as { messages: unknown[] };
	assert.deepEqual(result.messages, [
		{ role: "user", content: [{ type: "text", text: "see @doc.pdf" }, pdfBlock] },
		{
			role: "assistant",
			content: [
				{ type: "tool_use", id: "t1", name: "read", input: { path: "/tmp/x/report.pdf" } },
				{ type: "tool_use", id: "t2", name: "read", input: { path: "/tmp/x/a.txt" } },
			],
		},
		{
			role: "user",
			content: [
				{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: pdfNote }, pdfBlock], is_error: false },
				{ type: "tool_result", tool_use_id: "t2", content: "hello", is_error: false },
			],
		},
		{ role: "assistant", content: [{ type: "text", text: "done" }] },
		{ role: "user", content: [{ type: "text", text: "thanks", ...cache }] },
	]);
	const toolResults = (message: unknown) => (message as { content: unknown[] }).content;
	assert.equal(toolResults(result.messages[2])[1], toolResults(payload.messages[2])[1]);
	assert.equal(result.messages[1], payload.messages[1]);
	assert.equal(result.messages[4], payload.messages[4]);
});

test("keeps untouched messages by reference and gives the same result each time", async () => {
	const payload = await payloadFor([user("hello"), assistant([text("hi")]), user([text("see"), text("[[pi-media:e1:0]]")])]);
	const first = assertPureRewrite(adapter, payload, find) as { messages: unknown[] };
	assert.equal(first.messages[0], payload.messages[0]);
	assert.equal(first.messages[1], payload.messages[1]);
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
