import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, type Message } from "@earendil-works/pi-ai";
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
	abc: [{ path: "/gone/doc.pdf", mimeType: "application/pdf", data: "JVBERi0xLjQ=" }],
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

const readNote = "Read PDF file [application/pdf]: /tmp/x/report.pdf";
const reportPart = {
	type: "input_file",
	filename: "report.pdf",
	file_data: "data:application/pdf;base64,JVBERi0xLjc=",
};
const toolAttachments: Record<string, { path: string; mimeType: string; data: string }[]> = {
	e1: [
		{ path: "/tmp/x/report.pdf", mimeType: "application/pdf", data: "JVBERi0xLjc=" },
		{ path: "/tmp/x/song.mp3", mimeType: "audio/mpeg", data: "//uQRAAAAAA=" },
	],
	u1: [attachments.e1[0]],
	abc: [attachments.e1[0]],
};
const findForTools = (entryId: string, index: number) => toolAttachments[entryId]?.[index];

function readCall(id: string): Message[] {
	return [fauxAssistantMessage([fauxToolCall("read", { path: "/tmp/x/report.pdf" }, { id })])];
}

function readResult(id: string, marker: string, images: { type: "image"; mimeType: string; data: string }[] = []): Message {
	return {
		role: "toolResult",
		toolCallId: id,
		toolName: "read",
		content: [{ type: "text", text: readNote }, ...images, { type: "text", text: marker }],
		isError: false,
		timestamp: 1,
	};
}

for (const [api, provider] of [
	["openai-responses", "openai"],
	["azure-openai-responses", "azure"],
	["openai-codex-responses", "openai-codex"],
]) {
	const adapter = findAdapter({ api, provider });
	const rewrite = (payload: unknown) => adapter?.rewrite(payload, find);

	test(`${api}: carries PDFs and no other types, in user messages and tool results`, () => {
		const types = ["application/pdf", "audio/mpeg", "audio/wav", "video/mp4", "image/heic", "text/plain"];
		for (const place of ["user", "toolResult"] as const) {
			assert.deepEqual(
				types.map((type) => adapter?.carries(type, place)),
				[true, false, false, false, false, false],
			);
		}
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

	test(`${api}: leaves user text that only contains a marker`, async () => {
		const payload = await payloadFor(api, [
			user("file says [[pi-media:abc:0]] literal"),
			user([
				{ type: "text", text: "file says [[pi-media:abc:0]] literal" },
				{ type: "text", text: "see\n[[pi-media:abc:0]]" },
			]),
		]);
		assert.equal(rewrite(payload), undefined);
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

	test(`${api}: leaves markers in assistant messages`, async () => {
		const payload = await payloadFor(api, [user("go"), fauxAssistantMessage("I saw [[pi-media:e1:0]]")]);
		assert.deepEqual(
			payload.input.map((item) => item.role ?? item.type),
			["user", "assistant"],
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
		const messages = [
			user([
				{ type: "text" as const, text: "see @doc.pdf" },
				{ type: "text" as const, text: "[[pi-media:e1:0]]" },
			]),
		];
		const first = rewrite(await payloadFor(api, messages));
		const second = rewrite(await payloadFor(api, messages));
		assert.notEqual(first, undefined);
		assert.deepEqual(first, second);
		assert.equal(JSON.stringify(userItems(first)), JSON.stringify(userItems(second)));
	});

	test(`${api}: returns undefined when no user item has a marker`, async () => {
		assert.equal(rewrite(await payloadFor(api, [user("hello")])), undefined);
	});

	const toolRewrite = (payload: unknown) => adapter?.rewrite(payload, findForTools);
	const toolOutputs = (payload: unknown) => (payload as Payload).input.filter((item) => item.type === "function_call_output");

	test(`${api}: places a PDF from a tool result as an input_file in the function call output`, async () => {
		const payload = await payloadFor(api, [user("go"), ...readCall("t1"), readResult("t1", "[[pi-media:e1:0]]")]);
		assert.deepEqual(toolOutputs(payload), [
			{ type: "function_call_output", call_id: "t1", output: `${readNote}\n[[pi-media:e1:0]]` },
		]);
		assert.deepEqual(toolOutputs(toolRewrite(payload)), [
			{ type: "function_call_output", call_id: "t1", output: [{ type: "input_text", text: readNote }, reportPart] },
		]);
	});

	test(`${api}: places a PDF from a tool result with images after the note text`, async () => {
		const payload = await payloadFor(api, [
			user("go"),
			...readCall("t1"),
			readResult("t1", "[[pi-media:e1:0]]", [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }]),
		]);
		assert.deepEqual(toolOutputs(toolRewrite(payload)), [
			{
				type: "function_call_output",
				call_id: "t1",
				output: [{ type: "input_text", text: readNote }, reportPart, pngPart],
			},
		]);
	});

	// pi-ai builds this item for tools with a grammar input, which the read tool does not have.
	test(`${api}: places a PDF in a custom tool call output`, () => {
		const payload = { input: [{ type: "custom_tool_call_output", call_id: "t1", output: `${readNote}\n[[pi-media:e1:0]]` }] };
		assert.deepEqual(toolRewrite(payload), {
			input: [{ type: "custom_tool_call_output", call_id: "t1", output: [{ type: "input_text", text: readNote }, reportPart] }],
		});
	});

	test(`${api}: removes tool result markers of other types and missing attachments, and keeps the note`, async () => {
		for (const marker of ["[[pi-media:e1:1]]", "[[pi-media:e1:9]]", "[[pi-media:gone:0]]"]) {
			const payload = await payloadFor(api, [user("go"), ...readCall("t1"), readResult("t1", marker)]);
			assert.deepEqual(toolOutputs(toolRewrite(payload)), [
				{ type: "function_call_output", call_id: "t1", output: [{ type: "input_text", text: readNote }] },
			]);
		}
	});

	const textResult = (id: string, ...texts: string[]): Message => ({
		role: "toolResult",
		toolCallId: id,
		toolName: "read",
		content: texts.map((text) => ({ type: "text", text })),
		isError: false,
		timestamp: 1,
	});

	test(`${api}: leaves tool result text that only contains a marker`, async () => {
		const payload = await payloadFor(api, [
			user("go"),
			...readCall("t1"),
			textResult("t1", "file says [[pi-media:abc:0]] literal"),
		]);
		assert.equal(toolRewrite(payload), undefined);
	});

	test(`${api}: takes only the marker lines at the end of a tool result`, async () => {
		const payload = await payloadFor(api, [
			user("go"),
			...readCall("t1"),
			textResult("t1", "first\n[[pi-media:abc:0]]\nlast", "[[pi-media:e1:0]]"),
		]);
		assert.deepEqual(toolOutputs(toolRewrite(payload)), [
			{
				type: "function_call_output",
				call_id: "t1",
				output: [{ type: "input_text", text: "first\n[[pi-media:abc:0]]\nlast" }, reportPart],
			},
		]);
	});

	test(`${api}: changes only the tool result with media and keeps the next one by reference`, async () => {
		const payload = await payloadFor(api, [
			user("go"),
			...readCall("t1"),
			readResult("t1", "[[pi-media:e1:0]]"),
			...readCall("t2"),
			{
				role: "toolResult",
				toolCallId: "t2",
				toolName: "read",
				content: [{ type: "text", text: "line 1" }],
				isError: false,
				timestamp: 1,
			},
		]);
		const result = toolRewrite(payload) as Payload;
		assert.deepEqual(toolOutputs(result), [
			{ type: "function_call_output", call_id: "t1", output: [{ type: "input_text", text: readNote }, reportPart] },
			{ type: "function_call_output", call_id: "t2", output: "line 1" },
		]);
		const unchanged = payload.input.filter((item) => item.call_id !== "t1" || item.type !== "function_call_output");
		assert.deepEqual(
			unchanged.map((item) => result.input.includes(item)),
			unchanged.map(() => true),
		);
	});

	test(`${api}: rewrites a user message marker and a tool result marker in one payload`, async () => {
		const payload = await payloadFor(api, [
			user([
				{ type: "text", text: "see @doc.pdf" },
				{ type: "text", text: "[[pi-media:u1:0]]" },
			]),
			...readCall("t1"),
			readResult("t1", "[[pi-media:e1:0]]"),
		]);
		const result = toolRewrite(payload);
		assert.deepEqual(userItems(result), [{ role: "user", content: [{ type: "input_text", text: "see @doc.pdf" }, pdfPart] }]);
		assert.deepEqual(toolOutputs(result), [
			{ type: "function_call_output", call_id: "t1", output: [{ type: "input_text", text: readNote }, reportPart] },
		]);
	});

	test(`${api}: gives the same bytes for two rewrites of equal payloads with tool results`, async () => {
		const messages = [
			user([
				{ type: "text" as const, text: "see @doc.pdf" },
				{ type: "text" as const, text: "[[pi-media:u1:0]]" },
			]),
			...readCall("t1"),
			readResult("t1", "[[pi-media:e1:0]]"),
		];
		const first = toolRewrite(await payloadFor(api, messages));
		const second = toolRewrite(await payloadFor(api, messages));
		assert.notEqual(first, undefined);
		assert.equal(JSON.stringify(first), JSON.stringify(second));
	});

	test(`${api}: passes through payloads without an input list`, () => {
		for (const payload of [undefined, "raw", { foo: 1 }, { input: "nope" }, { input: [null, 3] }]) {
			assert.equal(rewrite(payload), undefined);
		}
	});
}
