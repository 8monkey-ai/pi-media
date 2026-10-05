import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxAssistantMessage, fauxText, fauxToolCall, type Message } from "@earendil-works/pi-ai";
import { stream as azureStream } from "@earendil-works/pi-ai/api/azure-openai-responses";
import { stream as codexStream } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { stream as openaiStream } from "@earendil-works/pi-ai/api/openai-responses";
import { getModel } from "@earendil-works/pi-ai/compat";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import "../src/adapters/openai-responses.ts";
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

const pdfPart = { type: "input_file", filename: "doc.pdf", file_data: "data:application/pdf;base64,JVBERi0xLjQ=" };
const pngPart = { type: "input_image", detail: "auto", image_url: "data:image/png;base64,iVBORw0KGgo=" };

// The Codex stream reads the ChatGPT account id from the token before it builds the request.
const codexToken = `x.${btoa(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct" } }))}.x`;

type Payload = { input: Record<string, unknown>[] };

// Builds the request with pi-ai's own converter. The captured payload stops the request before any network call.
async function payloadFor(api: string, messages: Message[]) {
	const context = normalizeContext({ messages });
	let payload: unknown;
	const onPayload = (params: unknown) => {
		payload = structuredClone(params);
		throw new Error("payload captured");
	};
	const events =
		api === "openai-responses"
			? openaiStream(getModel("openai", "gpt-4.1"), context, { apiKey: "test", onPayload })
			: api === "azure-openai-responses"
				? azureStream(getModel("azure", "gpt-4.1"), context, {
						apiKey: "test",
						azureBaseUrl: "https://test.openai.azure.com",
						onPayload,
					})
				: codexStream(getModel("openai-codex", "gpt-5.5"), context, { apiKey: codexToken, onPayload });
	for await (const _ of events);
	return payload as Payload;
}

function user(content: Extract<Message, { role: "user" }>["content"]): Message {
	return { role: "user", content, timestamp: 1 };
}

const userItems = (payload: unknown) => (payload as Payload).input.filter((item) => item.role === "user");

for (const [api, provider] of [
	["openai-responses", "openai"],
	["azure-openai-responses", "azure"],
	["openai-codex-responses", "openai-codex"],
]) {
	const adapter = findAdapter({ api, provider });
	const rewrite = (payload: unknown) => adapter?.rewrite(payload, find);

	test(`${api}: carries PDFs and no other types`, () => {
		assert.deepEqual(
			["application/pdf", "audio/mpeg", "audio/wav", "video/mp4", "image/heic", "text/plain"].map((type) =>
				adapter?.carries(type),
			),
			[true, false, false, false, false, false],
		);
	});

	test(`${api}: replaces a marker with an input_file part and keeps images and typed text`, async () => {
		const payload = await payloadFor(api, [
			user([
				{ type: "text", text: "see @doc.pdf" },
				{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
				{ type: "text", text: "[[pi-media:e1:0]]" },
			]),
		]);
		assert.deepEqual(userItems(rewrite(payload)), [
			{ role: "user", content: [{ type: "input_text", text: "see @doc.pdf" }, pngPart, pdfPart] },
		]);
	});

	test(`${api}: splits a text part around a marker`, async () => {
		const payload = await payloadFor(api, [user("read this\n[[pi-media:e1:0]] then that")]);
		assert.deepEqual(userItems(rewrite(payload)), [
			{
				role: "user",
				content: [{ type: "input_text", text: "read this" }, pdfPart, { type: "input_text", text: "then that" }],
			},
		]);
	});

	test(`${api}: removes markers of audio, video, other types and missing attachments, and keeps the typed text`, async () => {
		const payload = await payloadFor(api, [
			user([
				{ type: "text", text: "hi @a.mp3" },
				{ type: "text", text: "[[pi-media:e1:1]]" },
				{ type: "text", text: "[[pi-media:e1:2]]" },
				{ type: "text", text: "[[pi-media:e1:3]]" },
				{ type: "text", text: "[[pi-media:e1:9]]" },
				{ type: "text", text: "[[pi-media:gone:0]]" },
			]),
		]);
		assert.deepEqual(userItems(rewrite(payload)), [{ role: "user", content: [{ type: "input_text", text: "hi @a.mp3" }] }]);
	});

	test(`${api}: leaves markers in assistant messages and function call outputs`, async () => {
		const payload = await payloadFor(api, [
			user("go"),
			fauxAssistantMessage([fauxText("I saw [[pi-media:e1:0]]"), fauxToolCall("read", { path: "a" }, { id: "t1" })]),
			{
				role: "toolResult",
				toolCallId: "t1",
				toolName: "read",
				content: [{ type: "text", text: "[[pi-media:e1:0]]" }],
				isError: false,
				timestamp: 1,
			},
		]);
		assert.deepEqual(
			payload.input.map((item) => item.role ?? item.type),
			["user", "assistant", "function_call", "function_call_output"],
		);
		assert.equal(rewrite(payload), undefined);
	});

	test(`${api}: leaves markers in developer messages`, () => {
		const payload = { input: [{ role: "developer", content: [{ type: "input_text", text: "[[pi-media:e1:0]]" }] }] };
		assert.equal(rewrite(payload), undefined);
	});

	test(`${api}: keeps untouched items by reference`, async () => {
		const payload = await payloadFor(api, [
			user("hello"),
			fauxAssistantMessage("hi"),
			user([{ type: "text", text: "[[pi-media:e1:0]]" }]),
		]);
		const result = rewrite(payload) as Payload;
		assert.equal(result.input.length, 3);
		assert.equal(result.input[0], payload.input[0]);
		assert.equal(result.input[1], payload.input[1]);
		assert.deepEqual(result.input[2], { role: "user", content: [pdfPart] });
	});

	test(`${api}: gives the same bytes for two rewrites of equal payloads`, async () => {
		const messages = [user([{ type: "text" as const, text: "see @doc.pdf\n[[pi-media:e1:0]]" }])];
		const first = rewrite(await payloadFor(api, messages));
		const second = rewrite(await payloadFor(api, messages));
		assert.deepEqual(first, second);
		assert.equal(JSON.stringify(userItems(first)), JSON.stringify(userItems(second)));
	});

	test(`${api}: returns undefined when no user item has a marker`, async () => {
		assert.equal(rewrite(await payloadFor(api, [user("hello")])), undefined);
	});

	test(`${api}: passes through payloads without an input list`, () => {
		for (const payload of [undefined, "raw", { foo: 1 }, { input: "nope" }, { input: [null, 3] }]) {
			assert.equal(rewrite(payload), undefined);
		}
	});
}
