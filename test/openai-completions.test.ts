import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message, Model, ToolResultMessage } from "@earendil-works/pi-ai";
import { stream } from "@earendil-works/pi-ai/api/openai-completions";
import "../src/adapters/openai-completions.ts";
import {
	adapterFor,
	assertPureRewrite,
	assistantOf,
	capturePayload,
	contentOf,
	findIn,
	marker,
	messagesOf,
	pdfFilePart,
	pdfNote,
	pdfRead,
	readTurn as readTurnOf,
	testModel,
	readResult as toolResult,
} from "./pi-payload.ts";

const adapter = adapterFor({ api: "openai-completions", provider: "any" });

const find = findIn({
	e1: [
		{ path: "/gone/doc.pdf", mimeType: "application/pdf", data: "JVBERi0xLjQ=" },
		{ path: "/gone/a.mp3", mimeType: "audio/mpeg", data: "//uQRAAAAAA=" },
		{ path: "/gone/voice.wav", mimeType: "audio/wav", data: "UklGRiQAAAA=" },
		{ path: "/gone/clip.mp4", mimeType: "video/mp4", data: "AAAAGGZ0eXA=" },
		{ path: "/gone/song.ogg", mimeType: "audio/ogg", data: "T2dnUwAC" },
		{ path: "/gone/shot.heic", mimeType: "image/heic", data: "AAAA" },
	],
	abc: [{ path: "/gone/doc.pdf", mimeType: "application/pdf", data: "JVBERi0xLjQ=" }],
});
const rewrite = (payload: unknown) => adapter.rewrite(payload, find);

const mp3Part = { type: "input_audio", input_audio: { data: "//uQRAAAAAA=", format: "mp3" } };
const wavPart = { type: "input_audio", input_audio: { data: "UklGRiQAAAA=", format: "wav" } };

type UserContent = string | ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[];
type ModelOptions = { provider?: string; id?: string; compat?: Model<"openai-completions">["compat"] };

// Builds the request body with pi-ai's own converter and stops before any network call.
async function piMessagesPayload(messages: Message[], { provider = "openai", id = "gpt-4o", compat }: ModelOptions = {}) {
	const model = testModel("openai-completions", { id, provider, baseUrl: "http://127.0.0.1:9", compat });
	return (await capturePayload(stream, model, messages, { apiKey: "test" })) as { messages: Record<string, unknown>[] };
}

const piPayload = (users: UserContent[], options?: ModelOptions) =>
	piMessagesPayload(
		users.map((content, index) => ({ role: "user", content, timestamp: index })),
		options,
	);

test("carries PDFs, wav and mp3 in user messages and tool results, and no other types", () => {
	assert.deepEqual(
		[
			"application/pdf",
			"audio/wav",
			"audio/mpeg",
			"video/mp4",
			"audio/ogg",
			"audio/x-wav",
			"image/heic",
			"text/plain",
			"constructor",
		].map((type) => [adapter.carries(type, "user"), adapter.carries(type, "toolResult")]),
		[true, true, true, false, false, false, false, false, false].map((carried) => [carried, carried]),
	);
});

test("replaces marker blocks with file and input_audio parts and keeps images and typed text", async () => {
	const payload = await piPayload([
		[
			{ type: "text", text: "see @doc.pdf" },
			{ type: "image", data: "xx", mimeType: "image/png" },
			marker(0),
			marker(1),
			marker(2),
		],
	]);
	assert.deepEqual(contentOf(rewrite(payload)), [
		[
			{ type: "text", text: "see @doc.pdf" },
			{ type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
			pdfFilePart,
			mp3Part,
			wavPart,
		],
	]);
});

test("replaces the marker lines at the end of string content", async () => {
	const payload = await piPayload(["read this\n[[pi-media:e1:0]]\n[[pi-media:e1:1]]", "hi"]);
	assert.deepEqual(contentOf(rewrite(payload)), [[{ type: "text", text: "read this" }, pdfFilePart, mp3Part], "hi"]);
});

test("leaves user text that only contains a marker", async () => {
	const payload = await piPayload([
		"file says [[pi-media:abc:0]] literal",
		"[[pi-media:abc:0]]\nmore",
		[{ type: "text", text: "file says [[pi-media:abc:0]] literal" }],
		[{ type: "text", text: "see\n[[pi-media:abc:0]]" }],
		"hi",
	]);
	assert.equal(rewrite(payload), undefined);
});

test("removes markers of video, other audio, other types and missing attachments, and keeps the typed text", async () => {
	const payload = await piPayload([
		[{ type: "text", text: "hi" }, { type: "text", text: "[[pi-media:gone:0]]" }, marker(9), marker(3), marker(4), marker(5)],
	]);
	assert.deepEqual(contentOf(rewrite(payload)), [[{ type: "text", text: "hi" }]]);
});

test("keeps the cache marker on the last text part when the marker block that held it is replaced", async () => {
	const payload = await piPayload(
		[
			[{ type: "text", text: "earlier @a.mp3" }, marker(1)],
			[{ type: "text", text: "see @doc.pdf" }, marker(0)],
		],
		{
			provider: "openrouter",
			id: "anthropic/claude-sonnet-4",
		},
	);
	assert.deepEqual(contentOf(payload)[1], [
		{ type: "text", text: "see @doc.pdf" },
		{ type: "text", text: "[[pi-media:e1:0]]", cache_control: { type: "ephemeral" } },
	]);
	assert.deepEqual(contentOf(rewrite(payload)), [
		[{ type: "text", text: "earlier @a.mp3" }, mp3Part],
		[{ type: "text", text: "see @doc.pdf", cache_control: { type: "ephemeral" } }, pdfFilePart],
	]);
});

test("leaves markers in assistant and system messages", () => {
	const payload = {
		messages: [
			{ role: "assistant", content: "I saw [[pi-media:e1:0]]" },
			{ role: "system", content: [{ type: "text", text: "[[pi-media:e1:0]]" }] },
		],
	};
	assert.equal(rewrite(payload), undefined);
});

test("keeps untouched messages by reference", () => {
	const system = { role: "system", content: "sys" };
	const earlier = { role: "user", content: [{ type: "text", text: "hello" }] };
	const result = messagesOf(rewrite({ messages: [system, earlier, { role: "user", content: "[[pi-media:e1:0]]" }] }));
	assert.equal(result[0], system);
	assert.equal(result[1], earlier);
	assert.deepEqual(result[2], { role: "user", content: [pdfFilePart] });
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

const followUp = (...parts: unknown[]) => ({
	role: "user",
	content: [{ type: "text", text: "Attached file(s) from tool result:" }, ...parts],
});

const readPdf = (toolCallId = "call_1") => toolResult(toolCallId, pdfRead("[[pi-media:e1:0]]"));

const readTurn = (...results: ToolResultMessage[]) =>
	readTurnOf(assistantOf({ api: "openai-completions", provider: "openai", id: "gpt-4o" }), ...results);

const pdf = { path: "/tmp/x/report.pdf", mimeType: "application/pdf", data: "JVBERi0xLjQ=" };
const reportPart = { type: "file", file: { filename: "report.pdf", file_data: "data:application/pdf;base64,JVBERi0xLjQ=" } };

test("pi-ai joins the note and the marker of a tool result into one string", async () => {
	const payload = await piMessagesPayload(readTurn(readPdf()));
	assert.deepEqual(payload.messages[2], { role: "tool", content: `${pdfNote}\n[[pi-media:e1:0]]`, tool_call_id: "call_1" });
});

test("moves each carried kind from a tool result to a user message after it", async () => {
	const kinds = [
		[pdf, reportPart],
		[{ path: "/tmp/x/a.mp3", mimeType: "audio/mpeg", data: "//uQRAAAAAA=" }, mp3Part],
		[{ path: "/tmp/x/voice.wav", mimeType: "audio/wav", data: "UklGRiQAAAA=" }, wavPart],
	] as const;
	for (const [attachment, part] of kinds) {
		const payload = await piMessagesPayload(readTurn(readPdf()));
		const result = messagesOf(adapter.rewrite(payload, findIn({ e1: [attachment] })));
		assert.equal(result[0], payload.messages[0]);
		assert.equal(result[1], payload.messages[1]);
		assert.deepEqual(result.slice(2), [{ role: "tool", content: pdfNote, tool_call_id: "call_1" }, followUp(part)]);
	}
});

test("removes the tool result marker of a type it does not carry or a missing attachment, and keeps the note", async () => {
	const video = { path: "/tmp/x/clip.mp4", mimeType: "video/mp4", data: "AAAAGGZ0eXA=" };
	for (const find of [findIn({ e1: [video] }), findIn({})]) {
		const payload = await piMessagesPayload(readTurn(readPdf()));
		assert.deepEqual(messagesOf(adapter.rewrite(payload, find)).slice(2), [
			{ role: "tool", content: pdfNote, tool_call_id: "call_1" },
		]);
	}
});

test("leaves tool result text that only contains a marker", async () => {
	const payload = await piMessagesPayload(
		readTurn(toolResult("call_1", [{ type: "text", text: "file says [[pi-media:abc:0]] literal" }])),
	);
	assert.equal(adapter.rewrite(payload, findIn({ abc: [pdf] })), undefined);
});

test("takes only the marker lines at the end of a tool result", async () => {
	const payload = await piMessagesPayload(
		readTurn(
			toolResult("call_1", [
				{ type: "text", text: "first\n[[pi-media:abc:0]]\nlast" },
				{ type: "text", text: "[[pi-media:e1:0]]" },
			]),
		),
	);
	assert.deepEqual(messagesOf(adapter.rewrite(payload, findIn({ abc: [pdf], e1: [pdf] }))).slice(2), [
		{ role: "tool", content: "first\n[[pi-media:abc:0]]\nlast", tool_call_id: "call_1" },
		followUp(reportPart),
	]);
});

test("puts the files after the last of consecutive tool results", async () => {
	const payload = await piMessagesPayload(
		readTurn(readPdf("call_1"), toolResult("call_2", [{ type: "text", text: "line one" }])),
	);
	const result = messagesOf(adapter.rewrite(payload, findIn({ e1: [pdf] })));
	assert.equal(result[3], payload.messages[3]);
	assert.deepEqual(result.slice(2), [
		{ role: "tool", content: pdfNote, tool_call_id: "call_1" },
		{ role: "tool", content: "line one", tool_call_id: "call_2" },
		followUp(reportPart),
	]);
});

test("adds the files to the user message that pi-ai adds for tool result images", async () => {
	const image = toolResult("call_1", [
		{ type: "text", text: "Read image file [image/png]" },
		{ type: "image", data: "xx", mimeType: "image/png" },
	]);
	const payload = await piMessagesPayload(readTurn(image, readPdf("call_2")));
	assert.deepEqual(messagesOf(adapter.rewrite(payload, findIn({ e1: [pdf] }))).slice(2), [
		{ role: "tool", content: "Read image file [image/png]", tool_call_id: "call_1" },
		{ role: "tool", content: pdfNote, tool_call_id: "call_2" },
		{
			role: "user",
			content: [
				{ type: "text", text: "Attached image(s) from tool result:" },
				{ type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
				reportPart,
			],
		},
	]);
});

test("puts the files after the assistant message that pi-ai adds after tool results for some providers", async () => {
	const compat = { requiresAssistantAfterToolResult: true };
	const bridge = { role: "assistant", content: "I have processed the tool results." };
	const next: Message = { role: "user", content: "and now?", timestamp: 3 };
	const payload = await piMessagesPayload([...readTurn(readPdf()), next], { compat });
	assert.deepEqual(messagesOf(adapter.rewrite(payload, findIn({ e1: [pdf] }))).slice(2), [
		{ role: "tool", content: pdfNote, tool_call_id: "call_1" },
		bridge,
		followUp(reportPart),
		{ role: "user", content: "and now?" },
	]);

	const image = toolResult("call_2", [{ type: "image", data: "xx", mimeType: "image/png" }]);
	const withImage = await piMessagesPayload(readTurn(readPdf(), image), { compat });
	assert.deepEqual(messagesOf(adapter.rewrite(withImage, findIn({ e1: [pdf] }))).slice(2), [
		{ role: "tool", content: pdfNote, tool_call_id: "call_1" },
		{ role: "tool", content: "(see attached image)", tool_call_id: "call_2" },
		bridge,
		{
			role: "user",
			content: [
				{ type: "text", text: "Attached image(s) from tool result:" },
				{ type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
				reportPart,
			],
		},
	]);
});

test("adds the assistant message that pi-ai adds after tool results for some providers when the tool results are last", async () => {
	const payload = await piMessagesPayload(readTurn(readPdf()), { compat: { requiresAssistantAfterToolResult: true } });
	assert.equal(payload.messages[1].content, "");
	assert.deepEqual(messagesOf(adapter.rewrite(payload, findIn({ e1: [pdf] }))).slice(2), [
		{ role: "tool", content: pdfNote, tool_call_id: "call_1" },
		{ role: "assistant", content: "I have processed the tool results." },
		followUp(reportPart),
	]);
});

test("rewrites a user message marker and a tool result marker in the same payload", async () => {
	const prompt: Message = {
		role: "user",
		content: [
			{ type: "text", text: "see @a.mp3" },
			{ type: "text", text: "[[pi-media:u1:0]]" },
		],
		timestamp: 0,
	};
	const payload = await piMessagesPayload([prompt, ...readTurn(readPdf()).slice(1)]);
	const mp3 = { path: "/tmp/x/a.mp3", mimeType: "audio/mpeg", data: "//uQRAAAAAA=" };
	const result = messagesOf(adapter.rewrite(payload, findIn({ e1: [pdf], u1: [mp3] })));
	assert.deepEqual(result[0], { role: "user", content: [{ type: "text", text: "see @a.mp3" }, mp3Part] });
	assert.deepEqual(result.slice(2), [{ role: "tool", content: pdfNote, tool_call_id: "call_1" }, followUp(reportPart)]);
});

test("keeps the cache marker on the tool result text when the tool result is the last message", async () => {
	const payload = await piMessagesPayload(readTurn(readPdf()), { provider: "openrouter", id: "anthropic/claude-sonnet-4" });
	assert.deepEqual(payload.messages.at(-1)?.content, [
		{ type: "text", text: `${pdfNote}\n[[pi-media:e1:0]]`, cache_control: { type: "ephemeral" } },
	]);
	assert.deepEqual(messagesOf(adapter.rewrite(payload, findIn({ e1: [pdf] }))).slice(-2), [
		{ role: "tool", content: [{ type: "text", text: pdfNote, cache_control: { type: "ephemeral" } }], tool_call_id: "call_1" },
		followUp(reportPart),
	]);
});

test("gives the same result for the same tool result payload and does not change it", async () => {
	const payload = await piMessagesPayload(readTurn(readPdf(), toolResult("call_2", [{ type: "text", text: "line one" }])));
	assert.equal(messagesOf(assertPureRewrite(adapter, payload, findIn({ e1: [pdf] }))).length, 5);
});
