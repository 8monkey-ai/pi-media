import assert from "node:assert/strict";
import { test } from "node:test";
import { makeSentinel } from "../src/media.ts";
import { rewritePayload } from "../src/rewrite.ts";

const sentinel = makeSentinel("https://x.com/doc.md", "text/markdown");
const fileBlock = { type: "file", data: "https://x.com/doc.md", mediaType: "text/markdown" };

test("rewrites string content containing a sentinel into array form", () => {
	const payload = { model: "m", messages: [{ role: "user", content: `read this\n\n${sentinel}` }] };
	assert.deepEqual(rewritePayload(payload), {
		model: "m",
		messages: [{ role: "user", content: [{ type: "text", text: "read this" }, fileBlock] }],
	});
});

test("rewrites text parts inside array content", () => {
	const payload = {
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: `${sentinel} summarize` },
					{ type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
				],
			},
		],
	};
	assert.deepEqual(rewritePayload(payload), {
		messages: [
			{
				role: "user",
				content: [
					fileBlock,
					{ type: "text", text: "summarize" },
					{ type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
				],
			},
		],
	});
});

test("returns undefined when nothing matches", () => {
	assert.equal(rewritePayload({ messages: [{ role: "user", content: "hello" }] }), undefined);
	assert.equal(rewritePayload({ messages: [{ role: "assistant", content: null }] }), undefined);
});

test("passes through non-message payload shapes", () => {
	assert.equal(rewritePayload(undefined), undefined);
	assert.equal(rewritePayload("raw"), undefined);
	assert.equal(rewritePayload({ foo: 1 }), undefined);
	assert.equal(rewritePayload({ messages: "nope" }), undefined);
});

test("leaves untouched messages by reference", () => {
	const untouched = { role: "system", content: "sys" };
	const payload = { messages: [untouched, { role: "user", content: sentinel }] };
	const result = rewritePayload(payload) as { messages: unknown[] };
	assert.equal(result.messages[0], untouched);
});
