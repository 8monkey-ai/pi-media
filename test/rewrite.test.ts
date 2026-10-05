import assert from "node:assert/strict";
import { test } from "node:test";
import { rewritePayload } from "../src/rewrite.ts";

const attachments: Record<string, { path: string; mimeType: string; data: string }[]> = {
	e1: [
		{ path: "/gone/doc.pdf", mimeType: "application/pdf", data: "JVBERi0xLjQ=" },
		{ path: "/gone/a.mp3", mimeType: "audio/mpeg", data: "//uQRAAAAAA=" },
	],
};
const find = (entryId: string, index: number) => attachments[entryId]?.[index];

const pdfPart = { type: "file", file: { data: "JVBERi0xLjQ=", media_type: "application/pdf" } };
const mp3Part = { type: "file", file: { data: "//uQRAAAAAA=", media_type: "audio/mpeg" } };

test("replaces marker blocks with file parts from the attachment", () => {
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
				],
			},
		],
	};
	assert.deepEqual(rewritePayload(payload, find), {
		model: "m",
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: "see @doc.pdf" },
					{ type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
					pdfPart,
					mp3Part,
				],
			},
		],
	});
});

test("splits string content around a marker", () => {
	assert.deepEqual(rewritePayload({ messages: [{ role: "user", content: "read this\n[[pi-media:e1:0]]" }] }, find), {
		messages: [{ role: "user", content: [{ type: "text", text: "read this" }, pdfPart] }],
	});
});

test("removes a marker whose entry or index is missing", () => {
	const content = [
		{ type: "text", text: "hi" },
		{ type: "text", text: "[[pi-media:gone:0]]" },
		{ type: "text", text: "[[pi-media:e1:7]]" },
	];
	assert.deepEqual(rewritePayload({ messages: [{ role: "user", content }] }, find), {
		messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
	});
});

test("returns undefined when nothing matches", () => {
	assert.equal(rewritePayload({ messages: [{ role: "user", content: "hello" }] }, find), undefined);
	assert.equal(rewritePayload({ messages: [{ role: "assistant", content: null }] }, find), undefined);
});

test("passes through non-message payload shapes", () => {
	assert.equal(rewritePayload(undefined, find), undefined);
	assert.equal(rewritePayload("raw", find), undefined);
	assert.equal(rewritePayload({ foo: 1 }, find), undefined);
	assert.equal(rewritePayload({ messages: "nope" }, find), undefined);
});

test("leaves untouched messages by reference", () => {
	const untouched = { role: "system", content: "sys" };
	const result = rewritePayload({ messages: [untouched, { role: "user", content: "[[pi-media:e1:0]]" }] }, find);
	assert.equal(result?.messages[0], untouched);
});
