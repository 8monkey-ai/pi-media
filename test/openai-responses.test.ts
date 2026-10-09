import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, type Message } from "@earendil-works/pi-ai";
import { stream as azureStream } from "@earendil-works/pi-ai/api/azure-openai-responses";
import { stream as codexStream } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { stream as openaiStream } from "@earendil-works/pi-ai/api/openai-responses";
import { getModel } from "@earendil-works/pi-ai/compat";
import "../src/adapters/openai-responses.ts";
import {
	adapterFor,
	assertPureRewrite,
	attachments,
	capturePayload,
	find,
	findIn,
	pdfNote,
	readTurn,
	text,
	readResult as toolResult,
	user,
} from "./pi-payload.ts";

const pdfPart = { type: "input_file", filename: "doc.pdf", file_data: "data:application/pdf;base64,JVBERi0xLjQ=" };
const pngPart = { type: "input_image", detail: "auto", image_url: "data:image/png;base64,iVBORw0KGgo=" };

// The Codex stream reads the ChatGPT account id from the token before it builds the request.
const codexToken = `x.${btoa(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct" } }))}.x`;

type Payload = { input: Record<string, unknown>[] };

async function payloadFor(api: string, messages: Message[]) {
	const payload =
		api === "openai-responses"
			? await capturePayload(openaiStream, getModel("openai", "gpt-4.1"), messages, { apiKey: "test" })
			: api === "azure-openai-responses"
				? await capturePayload(azureStream, getModel("azure", "gpt-4.1"), messages, {
						apiKey: "test",
						azureBaseUrl: "https://test.openai.azure.com",
					})
				: await capturePayload(codexStream, getModel("openai-codex", "gpt-5.5"), messages, { apiKey: codexToken });
	return payload as Payload;
}

const userItems = (payload: unknown) => (payload as Payload).input.filter((item) => item.role === "user");

const reportPart = {
	type: "input_file",
	filename: "report.pdf",
	file_data: "data:application/pdf;base64,JVBERi0xLjc=",
};
const findForTools = findIn({
	e1: [
		{ path: "/tmp/x/report.pdf", mimeType: "application/pdf", data: "JVBERi0xLjc=" },
		{ path: "/tmp/x/song.mp3", mimeType: "audio/mpeg", data: "//uQRAAAAAA=" },
	],
	u1: [attachments.e1[0]],
	abc: [attachments.e1[0]],
});

const faux = (content: Parameters<typeof fauxAssistantMessage>[0]) => fauxAssistantMessage(content);

function readCall(id: string): Message[] {
	return [faux([fauxToolCall("read", { path: "/tmp/x/report.pdf" }, { id })])];
}

function readResult(id: string, marker: string, images: { type: "image"; mimeType: string; data: string }[] = []) {
	return toolResult(id, [text(pdfNote), ...images, text(marker)]);
}

const openai = adapterFor({ api: "openai-responses", provider: "openai" });
const rewrite = (payload: unknown) => openai.rewrite(payload, find);
const toolRewrite = (payload: unknown) => openai.rewrite(payload, findForTools);
const toolOutputs = (payload: unknown) => (payload as Payload).input.filter((item) => item.type === "function_call_output");
const textResult = (id: string, ...texts: string[]) => toolResult(id, texts.map(text));
const openaiPayload = (messages: Message[]) => payloadFor("openai-responses", messages);

// The three APIs share one adapter and one pi-ai converter, so the full set of rewrite tests runs for openai-responses
// alone. These two run for each API: they prove that the adapter is registered and that the payload of each stream has
// the shape the adapter reads.
for (const [api, provider] of [
	["openai-responses", "openai"],
	["azure-openai-responses", "azure"],
	["openai-codex-responses", "openai-codex"],
]) {
	const adapter = adapterFor({ api, provider });

	test(`${api}: carries PDFs and no other types, in user messages and tool results`, () => {
		const types = ["application/pdf", "audio/mpeg", "audio/wav", "video/mp4", "image/heic", "text/plain"];
		for (const place of ["user", "toolResult"] as const) {
			assert.deepEqual(
				types.map((type) => adapter.carries(type, place)),
				[true, false, false, false, false, false],
			);
		}
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
		const result = assertPureRewrite(adapter, payload, findForTools);
		assert.deepEqual(userItems(result), [{ role: "user", content: [{ type: "input_text", text: "see @doc.pdf" }, pdfPart] }]);
		assert.deepEqual(toolOutputs(result), [
			{ type: "function_call_output", call_id: "t1", output: [{ type: "input_text", text: pdfNote }, reportPart] },
		]);
	});
}

test("replaces a marker with an input_file part and keeps images and typed text", async () => {
	const payload = await openaiPayload([
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

test("leaves user text that only contains a marker", async () => {
	const payload = await openaiPayload([
		user("file says [[pi-media:abc:0]] literal"),
		user([
			{ type: "text", text: "file says [[pi-media:abc:0]] literal" },
			{ type: "text", text: "see\n[[pi-media:abc:0]]" },
		]),
	]);
	assert.equal(rewrite(payload), undefined);
});

test("removes markers of audio, video, other types and missing attachments, and keeps the typed text", async () => {
	const payload = await openaiPayload([
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

test("leaves markers in assistant messages", async () => {
	const payload = await openaiPayload([user("go"), fauxAssistantMessage("I saw [[pi-media:e1:0]]")]);
	assert.deepEqual(
		payload.input.map((item) => item.role ?? item.type),
		["user", "assistant"],
	);
	assert.equal(rewrite(payload), undefined);
});

test("leaves markers in developer messages", () => {
	const payload = { input: [{ role: "developer", content: [{ type: "input_text", text: "[[pi-media:e1:0]]" }] }] };
	assert.equal(rewrite(payload), undefined);
});

test("leaves the items without a marker as they are", async () => {
	const payload = await openaiPayload([
		user("hello"),
		fauxAssistantMessage("hi"),
		user([{ type: "text", text: "[[pi-media:e1:0]]" }]),
	]);
	assert.deepEqual((rewrite(payload) as Payload).input, [
		payload.input[0],
		payload.input[1],
		{ role: "user", content: [pdfPart] },
	]);
});

test("places a PDF from a tool result as an input_file in the function call output", async () => {
	const payload = await openaiPayload(readTurn(faux, readResult("t1", "[[pi-media:e1:0]]")));
	assert.deepEqual(toolOutputs(payload), [
		{ type: "function_call_output", call_id: "t1", output: `${pdfNote}\n[[pi-media:e1:0]]` },
	]);
	assert.deepEqual(toolOutputs(toolRewrite(payload)), [
		{ type: "function_call_output", call_id: "t1", output: [{ type: "input_text", text: pdfNote }, reportPart] },
	]);
});

test("places a PDF from a tool result with images after the note text", async () => {
	const payload = await openaiPayload(
		readTurn(faux, readResult("t1", "[[pi-media:e1:0]]", [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }])),
	);
	assert.deepEqual(toolOutputs(toolRewrite(payload)), [
		{
			type: "function_call_output",
			call_id: "t1",
			output: [{ type: "input_text", text: pdfNote }, reportPart, pngPart],
		},
	]);
});

// pi-ai builds this item for tools with a grammar input, which the read tool does not have.
test("places a PDF in a custom tool call output", () => {
	const payload = { input: [{ type: "custom_tool_call_output", call_id: "t1", output: `${pdfNote}\n[[pi-media:e1:0]]` }] };
	assert.deepEqual(toolRewrite(payload), {
		input: [{ type: "custom_tool_call_output", call_id: "t1", output: [{ type: "input_text", text: pdfNote }, reportPart] }],
	});
});

test("removes tool result markers of other types and missing attachments, and keeps the note", async () => {
	for (const marker of ["[[pi-media:e1:1]]", "[[pi-media:e1:9]]", "[[pi-media:gone:0]]"]) {
		const payload = await openaiPayload(readTurn(faux, readResult("t1", marker)));
		assert.deepEqual(toolOutputs(toolRewrite(payload)), [
			{ type: "function_call_output", call_id: "t1", output: [{ type: "input_text", text: pdfNote }] },
		]);
	}
});

test("leaves tool result text that only contains a marker", async () => {
	const payload = await openaiPayload(readTurn(faux, textResult("t1", "file says [[pi-media:abc:0]] literal")));
	assert.equal(toolRewrite(payload), undefined);
});

test("takes only the marker lines at the end of a tool result", async () => {
	const payload = await openaiPayload(readTurn(faux, textResult("t1", "first\n[[pi-media:abc:0]]\nlast", "[[pi-media:e1:0]]")));
	assert.deepEqual(toolOutputs(toolRewrite(payload)), [
		{
			type: "function_call_output",
			call_id: "t1",
			output: [{ type: "input_text", text: "first\n[[pi-media:abc:0]]\nlast" }, reportPart],
		},
	]);
});

test("changes only the tool result with media", async () => {
	const payload = await openaiPayload([
		user("go"),
		...readCall("t1"),
		readResult("t1", "[[pi-media:e1:0]]"),
		...readCall("t2"),
		textResult("t2", "line 1"),
	]);
	assert.deepEqual(toolOutputs(toolRewrite(payload)), [
		{ type: "function_call_output", call_id: "t1", output: [{ type: "input_text", text: pdfNote }, reportPart] },
		{ type: "function_call_output", call_id: "t2", output: "line 1" },
	]);
});

test("returns undefined for a payload without a marker or without an input list", async () => {
	assert.equal(rewrite(await openaiPayload([user("hello")])), undefined);
	for (const payload of [undefined, "raw", { foo: 1 }, { input: "nope" }, { input: [null, 3] }]) {
		assert.equal(rewrite(payload), undefined);
	}
});
