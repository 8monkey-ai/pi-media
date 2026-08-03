import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { makeMarker } from "../src/media.ts";
import { rewritePayload } from "../src/rewrite.ts";

const dir = await mkdtemp(join(tmpdir(), "pi-media-rewrite-"));
const pdfPath = join(dir, "doc.pdf");
await writeFile(pdfPath, "%PDF-1.4");

const marker = makeMarker(pdfPath, "application/pdf");
const fileBlock = {
	type: "file",
	file: { data: Buffer.from("%PDF-1.4").toString("base64"), media_type: "application/pdf" },
};

test("inlines a marker in string content as a raw-base64 file block", async () => {
	const payload = { model: "m", messages: [{ role: "user", content: `read this\n\n${marker}` }] };
	assert.deepEqual(await rewritePayload(payload), {
		model: "m",
		messages: [{ role: "user", content: [{ type: "text", text: "read this" }, fileBlock] }],
	});
});

test("inlines markers inside array content and keeps other parts", async () => {
	const payload = {
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: `${marker} summarize` },
					{ type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
				],
			},
		],
	};
	assert.deepEqual(await rewritePayload(payload), {
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

test("keeps the marker as text when the file is gone", async () => {
	const missing = makeMarker(join(dir, "gone.pdf"), "application/pdf");
	assert.deepEqual(await rewritePayload({ messages: [{ role: "user", content: missing }] }), {
		messages: [{ role: "user", content: [{ type: "text", text: missing }] }],
	});
});

test("returns undefined when nothing matches", async () => {
	assert.equal(await rewritePayload({ messages: [{ role: "user", content: "hello" }] }), undefined);
	assert.equal(await rewritePayload({ messages: [{ role: "assistant", content: null }] }), undefined);
});

test("passes through non-message payload shapes", async () => {
	assert.equal(await rewritePayload(undefined), undefined);
	assert.equal(await rewritePayload("raw"), undefined);
	assert.equal(await rewritePayload({ foo: 1 }), undefined);
	assert.equal(await rewritePayload({ messages: "nope" }), undefined);
});

test("leaves untouched messages by reference", async () => {
	const untouched = { role: "system", content: "sys" };
	const payload = { messages: [untouched, { role: "user", content: marker }] };
	const result = (await rewritePayload(payload)) as { messages: unknown[] };
	assert.equal(result.messages[0], untouched);
});
