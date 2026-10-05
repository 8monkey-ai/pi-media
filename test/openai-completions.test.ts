import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/adapters/openai-completions.ts";
import { findAdapter } from "../src/adapters/registry.ts";

const adapter = findAdapter({ api: "openai-completions", provider: "any" });
assert.ok(adapter);

const attachments: Record<string, { path: string; mimeType: string; data: string }[]> = {
	e1: [
		{ path: "/gone/doc.pdf", mimeType: "application/pdf", data: "JVBERi0xLjQ=" },
		{ path: "/gone/a.mp3", mimeType: "audio/mpeg", data: "//uQRAAAAAA=" },
		{ path: "/gone/clip.mp4", mimeType: "video/mp4", data: "AAAAGGZ0eXA=" },
		{ path: "/gone/shot.heic", mimeType: "image/heic", data: "AAAA" },
	],
};
const find = (entryId: string, index: number) => attachments[entryId]?.[index];
const rewrite = (payload: unknown) => adapter.rewrite(payload, find);

const pdfPart = { type: "file", file: { data: "JVBERi0xLjQ=", media_type: "application/pdf" } };
const mp3Part = { type: "file", file: { data: "//uQRAAAAAA=", media_type: "audio/mpeg" } };
const mp4Part = { type: "file", file: { data: "AAAAGGZ0eXA=", media_type: "video/mp4" } };

test("carries audio, video and PDFs, and no other types", () => {
	assert.deepEqual(
		["audio/wav", "video/webm", "application/pdf", "image/heic", "text/plain"].map((type) => adapter.carries(type)),
		[true, true, true, false, false],
	);
});

test("replaces marker blocks in array content with file parts", () => {
	const payload = {
		model: "m",
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: "see @doc.pdf" },
					{ type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
					{ type: "text", text: "[[pi-media:e1:0]]" },
					{ type: "text", text: "[[pi-media:e1:1]]" },
					{ type: "text", text: "[[pi-media:e1:2]]" },
				],
			},
		],
	};
	assert.deepEqual(rewrite(payload), {
		model: "m",
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: "see @doc.pdf" },
					{ type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
					pdfPart,
					mp3Part,
					mp4Part,
				],
			},
		],
	});
});

test("splits string content around a marker", () => {
	assert.deepEqual(rewrite({ messages: [{ role: "user", content: "read this\n[[pi-media:e1:0]] then that" }] }), {
		messages: [
			{
				role: "user",
				content: [{ type: "text", text: "read this" }, pdfPart, { type: "text", text: "then that" }],
			},
		],
	});
});

test("removes a marker whose attachment is missing or of a type it does not carry", () => {
	const content = [
		{ type: "text", text: "hi" },
		{ type: "text", text: "[[pi-media:gone:0]]" },
		{ type: "text", text: "[[pi-media:e1:7]]" },
		{ type: "text", text: "[[pi-media:e1:3]]" },
	];
	assert.deepEqual(rewrite({ messages: [{ role: "user", content }] }), {
		messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
	});
});

test("leaves markers in assistant and tool messages", () => {
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
