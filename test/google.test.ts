import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxAssistantMessage, fauxText, fauxToolCall, type Message } from "@earendil-works/pi-ai";
import { stream as geminiStream } from "@earendil-works/pi-ai/api/google-generative-ai";
import { stream as vertexStream } from "@earendil-works/pi-ai/api/google-vertex";
import { getModel } from "@earendil-works/pi-ai/compat";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import "../src/adapters/google.ts";
import { findAdapter } from "../src/adapters/registry.ts";

const attachments: Record<string, { path: string; mimeType: string; data: string }[]> = {
	e1: [
		{ path: "/gone/doc.pdf", mimeType: "application/pdf", data: "JVBERi0xLjQ=" },
		{ path: "/gone/a.mp3", mimeType: "audio/mpeg", data: "//uQRAAAAAA=" },
		{ path: "/gone/clip.mp4", mimeType: "video/mp4", data: "AAAAGGZ0eXA=" },
		{ path: "/gone/shot.heic", mimeType: "image/heic", data: "AAAA" },
	],
};
const find = (entryId: string, index: number) => attachments[entryId]?.[index];

const pdfPart = { inlineData: { mimeType: "application/pdf", data: "JVBERi0xLjQ=" } };
const mp3Part = { inlineData: { mimeType: "audio/mpeg", data: "//uQRAAAAAA=" } };
const mp4Part = { inlineData: { mimeType: "video/mp4", data: "AAAAGGZ0eXA=" } };
const pngPart = { inlineData: { mimeType: "image/png", data: "iVBORw0KGgo=" } };

// Builds the request with pi-ai's own converter. The captured payload stops the request before any network call.
async function payloadFor(api: string, messages: Message[]) {
	const context = normalizeContext({ messages });
	let payload: unknown;
	const onPayload = (params: unknown) => {
		payload = params;
		throw new Error("payload captured");
	};
	const events =
		api === "google-generative-ai"
			? geminiStream(getModel("google", "gemini-2.5-flash"), context, { apiKey: "test", onPayload })
			: vertexStream(getModel("google-vertex", "gemini-2.5-flash"), context, {
					apiKey: "test",
					project: "test",
					location: "us-central1",
					onPayload,
				});
	for await (const _ of events);
	return payload as { contents: { role: string; parts: unknown[] }[] };
}

function user(content: Extract<Message, { role: "user" }>["content"]): Message {
	return { role: "user", content, timestamp: 1 };
}

for (const [api, provider] of [
	["google-generative-ai", "google"],
	["google-vertex", "google-vertex"],
]) {
	const adapter = findAdapter({ api, provider });
	const rewrite = (payload: unknown) => adapter?.rewrite(payload, find);

	test(`${api}: carries audio, video and PDFs, and no other types`, () => {
		assert.deepEqual(
			["audio/wav", "video/webm", "application/pdf", "image/heic", "text/plain"].map((type) => adapter?.carries(type)),
			[true, true, true, false, false],
		);
	});

	test(`${api}: replaces marker parts with inlineData parts`, async () => {
		const payload = await payloadFor(api, [
			user([
				{ type: "text", text: "see @doc.pdf" },
				{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
				{ type: "text", text: "[[pi-media:e1:0]]" },
				{ type: "text", text: "[[pi-media:e1:1]]" },
				{ type: "text", text: "[[pi-media:e1:2]]" },
			]),
		]);
		assert.deepEqual(rewrite(payload), {
			...payload,
			contents: [{ role: "user", parts: [{ text: "see @doc.pdf" }, pngPart, pdfPart, mp3Part, mp4Part] }],
		});
	});

	test(`${api}: splits a text part around a marker`, async () => {
		const payload = await payloadFor(api, [user("read this\n[[pi-media:e1:0]] then that")]);
		assert.deepEqual(rewrite(payload), {
			...payload,
			contents: [{ role: "user", parts: [{ text: "read this" }, pdfPart, { text: "then that" }] }],
		});
	});

	test(`${api}: removes a marker whose attachment is missing or of a type it does not carry`, async () => {
		const payload = await payloadFor(api, [
			user([
				{ type: "text", text: "hi @shot.heic" },
				{ type: "text", text: "[[pi-media:gone:0]]" },
				{ type: "text", text: "[[pi-media:e1:7]]" },
				{ type: "text", text: "[[pi-media:e1:3]]" },
			]),
		]);
		assert.deepEqual(rewrite(payload), { ...payload, contents: [{ role: "user", parts: [{ text: "hi @shot.heic" }] }] });
	});

	test(`${api}: leaves markers in model turns and tool results`, async () => {
		const payload = await payloadFor(api, [
			user("go"),
			fauxAssistantMessage([fauxText("I saw [[pi-media:e1:0]]"), fauxToolCall("read", { path: "a" }, { id: "t1" })]),
			{
				role: "toolResult",
				toolCallId: "t1",
				toolName: "read",
				content: [{ type: "text", text: "[[pi-media:e1:1]]" }],
				isError: false,
				timestamp: 1,
			},
		]);
		assert.deepEqual(
			payload.contents.map((content) => content.role),
			["user", "model", "user"],
		);
		assert.equal(rewrite(payload), undefined);
	});

	test(`${api}: keeps untouched contents by reference`, async () => {
		const payload = await payloadFor(api, [
			user("hello"),
			fauxAssistantMessage("hi"),
			user([{ type: "text", text: "[[pi-media:e1:0]]" }]),
		]);
		const result = rewrite(payload) as typeof payload;
		assert.equal(result.contents[0], payload.contents[0]);
		assert.equal(result.contents[1], payload.contents[1]);
		assert.deepEqual(result.contents[2], { role: "user", parts: [pdfPart] });
	});

	test(`${api}: returns undefined when no user content has a marker`, async () => {
		assert.equal(rewrite(await payloadFor(api, [user("hello")])), undefined);
	});

	test(`${api}: passes through payloads without a contents list`, () => {
		for (const payload of [undefined, "raw", { foo: 1 }, { contents: "nope" }, { contents: [null, 3] }]) {
			assert.equal(rewrite(payload), undefined);
		}
	});
}
