import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message, UserMessage } from "@earendil-works/pi-ai";
import { type FindAttachment, rewrite } from "../src/chat-completions.ts";
import { carries } from "../src/file-parts.ts";
import type { Attachment } from "../src/media-entry.ts";
import { chatPayload, pdfNote, readResult, readTurn, text } from "./pi-payload.ts";

const attachments: Attachment[] = [
	{ path: "/gone/doc.pdf", mimeType: "application/pdf", data: "JVBERi0xLjQ=" },
	{ path: "/gone/voice.wav", mimeType: "audio/wav", data: "UklGRiQAAAA=" },
	{ path: "/gone/a.mp3", mimeType: "audio/mpeg", data: "//uQRAAAAAA=" },
	{ path: "/gone/a.aiff", mimeType: "audio/aiff", data: "Rk9STQ==" },
	{ path: "/gone/a.aac", mimeType: "audio/aac", data: "//FQ" },
	{ path: "/gone/a.ogg", mimeType: "audio/ogg", data: "T2dnUwAC" },
	{ path: "/gone/a.flac", mimeType: "audio/flac", data: "ZkxhQw==" },
	{ path: "/gone/a.m4a", mimeType: "audio/x-m4a", data: "AAAAHGZ0eXBNNEE=" },
	{ path: "/gone/clip.mp4", mimeType: "video/mp4", data: "AAAAGGZ0eXA=" },
	{ path: "/gone/clip.mpg", mimeType: "video/mpeg", data: "AAABug==" },
	{ path: "/gone/clip.webm", mimeType: "video/webm", data: "GkXfow==" },
	{ path: "/gone/clip.mov", mimeType: "video/quicktime", data: "AAAAFGZ0eXBxdA==" },
	{ path: "/gone/a.opus", mimeType: "audio/ogg; codecs=opus", data: "T2dnUwAC" },
	{ path: "/gone/a.m4b", mimeType: "audio/mp4", data: "AAAAHGZ0eXBNNEI=" },
	{ path: "/gone/shot.heic", mimeType: "image/heic", data: "AAAA" },
];

const findIn =
	(table: Record<string, Attachment[]>): FindAttachment =>
	(entryId, index) =>
		table[entryId]?.[index];

const find = findIn({ e1: attachments, abc: [attachments[0]] });

// The marker block of attachment `index` of entry `e1`.
const marker = (index: number) => text(`[[pi-media:e1:${index}]]`);

const messagesOf = (payload: unknown) => (payload as { messages: unknown[] }).messages;
const contentOf = (payload: unknown) => (payload as { messages: { content: unknown }[] }).messages.map((m) => m.content);

// Checks that the rewrite does not change its input and gives the same result each time. Returns the result.
function assertPureRewrite(payload: unknown, attachment: FindAttachment) {
	const before = structuredClone(payload);
	const first = rewrite(payload, attachment, false);
	assert.notEqual(first, undefined);
	assert.deepEqual(rewrite(payload, attachment, false), first);
	assert.deepEqual(payload, before);
	return first;
}

const pdfFilePart = { type: "file", file: { filename: "doc.pdf", file_data: "data:application/pdf;base64,JVBERi0xLjQ=" } };
const audioPart = (data: string, format: string) => ({ type: "input_audio", input_audio: { data, format } });
const videoPart = (url: string) => ({ type: "video_url", video_url: { url } });
const mp3Part = audioPart("//uQRAAAAAA=", "mp3");
const mp4Part = videoPart("data:video/mp4;base64,AAAAGGZ0eXA=");
const imagePart = { type: "image_url", image_url: { url: "data:image/png;base64,xx" } };
const openRouterClaude = { provider: "openrouter", id: "anthropic/claude-sonnet-4" };

const usersPayload = (users: UserMessage["content"][], options?: Parameters<typeof chatPayload>[1]) =>
	chatPayload(
		users.map((content, index) => ({ role: "user", content, timestamp: index })),
		options,
	);

test("carries PDFs, the audio formats and the video types that OpenRouter lists, and no other types", () => {
	assert.deepEqual(
		[
			"application/pdf",
			"audio/wav",
			"audio/mpeg",
			"audio/aiff",
			"audio/aac",
			"audio/ogg",
			"audio/flac",
			"audio/x-m4a",
			"video/mp4",
			"video/mpeg",
			"video/webm",
			"video/quicktime",
			"audio/ogg; codecs=opus",
			"audio/mp4",
			"audio/x-wav",
			"video/ogg",
			"image/heic",
			"text/plain",
			"constructor",
		].map(carries),
		[true, true, true, true, true, true, true, true, true, true, true, false, false, false, false, false, false, false, false],
	);
});

test("replaces marker blocks with file, input_audio and video_url parts and keeps images and typed text", async () => {
	const payload = await usersPayload([
		[text("see these"), { type: "image", data: "xx", mimeType: "image/png" }, ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(marker)],
	]);
	assert.deepEqual(contentOf(assertPureRewrite(payload, find)), [
		[
			text("see these"),
			imagePart,
			pdfFilePart,
			audioPart("UklGRiQAAAA=", "wav"),
			mp3Part,
			audioPart("Rk9STQ==", "aiff"),
			audioPart("//FQ", "aac"),
			audioPart("T2dnUwAC", "ogg"),
			audioPart("ZkxhQw==", "flac"),
			audioPart("AAAAHGZ0eXBNNEE=", "m4a"),
			mp4Part,
			videoPart("data:video/mpeg;base64,AAABug=="),
			videoPart("data:video/webm;base64,GkXfow=="),
		],
	]);
});

test("leaves user text that only contains a marker", async () => {
	const payload = await usersPayload([
		"file says [[pi-media:abc:0]] literal",
		"[[pi-media:abc:0]]\nmore",
		"see\n[[pi-media:abc:0]]",
		[text("file says [[pi-media:abc:0]] literal")],
		[text("see\n[[pi-media:abc:0]]")],
		"hi",
	]);
	assert.equal(rewrite(payload, find, false), undefined);
});

test("removes markers of types it does not carry and of missing attachments, and keeps the typed text", async () => {
	const payload = await usersPayload([
		[text("hi"), text("[[pi-media:gone:0]]"), marker(99), marker(11), marker(12), marker(13), marker(14)],
	]);
	assert.deepEqual(contentOf(rewrite(payload, find, false)), [[text("hi")]]);
});

test("keeps the cache marker on the last text part when the marker block that held it is replaced", async () => {
	const payload = await usersPayload(
		[
			[text("earlier @a.mp3"), marker(2)],
			[text("see @doc.pdf"), marker(0)],
		],
		openRouterClaude,
	);
	assert.deepEqual(contentOf(payload)[1], [
		text("see @doc.pdf"),
		{ type: "text", text: "[[pi-media:e1:0]]", cache_control: { type: "ephemeral" } },
	]);
	assert.deepEqual(contentOf(rewrite(payload, find, false)), [
		[text("earlier @a.mp3"), mp3Part],
		[{ type: "text", text: "see @doc.pdf", cache_control: { type: "ephemeral" } }, pdfFilePart],
	]);
});

test("leaves markers in assistant and system messages", () => {
	const payload = {
		messages: [
			{ role: "assistant", content: "I saw [[pi-media:e1:0]]" },
			{ role: "system", content: [text("[[pi-media:e1:0]]")] },
		],
	};
	assert.equal(rewrite(payload, find, false), undefined);
});

test("leaves the messages without a marker as they are", () => {
	const system = { role: "system", content: "sys" };
	const earlier = { role: "user", content: [text("hello")] };
	const payload = { messages: [system, earlier, { role: "user", content: [text("[[pi-media:e1:0]]")] }] };
	assert.deepEqual(messagesOf(rewrite(payload, find, false)), [system, earlier, { role: "user", content: [pdfFilePart] }]);
});

test("returns undefined for a payload without a marker or without a message list", () => {
	assert.equal(rewrite({ messages: [{ role: "user", content: "hello" }] }, find, false), undefined);
	assert.equal(rewrite({ messages: [{ role: "assistant", content: null }] }, find, false), undefined);
	for (const payload of [undefined, "raw", { foo: 1 }, { messages: "nope" }, { messages: [null, 3] }]) {
		assert.equal(rewrite(payload, find, false), undefined);
	}
});

const followUp = (...parts: unknown[]) => ({ role: "user", content: [text("Attached file(s) from tool result:"), ...parts] });
const imageFollowUp = (...parts: unknown[]) => ({
	role: "user",
	content: [text("Attached image(s) from tool result:"), imagePart, ...parts],
});
const bridge = { role: "assistant", content: "I have processed the tool results." };
const toolNote = (toolCallId = "call_1") => ({ role: "tool", content: pdfNote, tool_call_id: toolCallId });

const readPdf = (toolCallId = "call_1") => readResult(toolCallId, [text(pdfNote), text("[[pi-media:e1:0]]")]);
const imageResult = (toolCallId: string) =>
	readResult(toolCallId, [text("Read image file [image/png]"), { type: "image", data: "xx", mimeType: "image/png" }]);

const pdf = { path: "/tmp/x/report.pdf", mimeType: "application/pdf", data: "JVBERi0xLjQ=" };
const reportPart = { type: "file", file: { filename: "report.pdf", file_data: "data:application/pdf;base64,JVBERi0xLjQ=" } };
const findPdf = findIn({ e1: [pdf] });

// The messages after the assistant turn, once the rewrite has run.
const afterCall = (payload: unknown, attachment = findPdf, requiresAssistantAfterToolResult = false) =>
	messagesOf(rewrite(payload, attachment, requiresAssistantAfterToolResult)).slice(2);

test("moves a PDF, audio or video from a tool result to a user message after it", async () => {
	const payload = await chatPayload(readTurn(readPdf()));
	assert.deepEqual(payload.messages[2], { role: "tool", content: `${pdfNote}\n[[pi-media:e1:0]]`, tool_call_id: "call_1" });
	for (const [attachment, part] of [
		[pdf, reportPart],
		[attachments[2], mp3Part],
		[attachments[8], mp4Part],
	] as const) {
		assert.deepEqual(afterCall(payload, findIn({ e1: [attachment] })), [toolNote(), followUp(part)]);
	}
});

test("removes the tool result marker of a type it does not carry or a missing attachment, and keeps the note", async () => {
	const payload = await chatPayload(readTurn(readPdf()));
	for (const attachment of [findIn({ e1: [attachments[11]] }), findIn({})]) {
		assert.deepEqual(afterCall(payload, attachment), [toolNote()]);
	}
});

test("leaves tool result text that only contains a marker", async () => {
	const payload = await chatPayload(readTurn(readResult("call_1", [text("file says [[pi-media:abc:0]] literal")])));
	assert.equal(rewrite(payload, findIn({ abc: [pdf] }), false), undefined);
});

test("takes only the marker lines at the end of a tool result", async () => {
	const payload = await chatPayload(
		readTurn(readResult("call_1", [text("first\n[[pi-media:abc:0]]\nlast"), text("[[pi-media:e1:0]]")])),
	);
	assert.deepEqual(afterCall(payload, findIn({ abc: [pdf], e1: [pdf] })), [
		{ role: "tool", content: "first\n[[pi-media:abc:0]]\nlast", tool_call_id: "call_1" },
		followUp(reportPart),
	]);
});

test("puts the files after the last of consecutive tool results", async () => {
	const payload = await chatPayload(readTurn(readPdf("call_1"), readResult("call_2", [text("line one")])));
	assert.deepEqual(afterCall(payload), [
		toolNote("call_1"),
		{ role: "tool", content: "line one", tool_call_id: "call_2" },
		followUp(reportPart),
	]);
});

test("adds the files to the user message that pi-ai adds for tool result images", async () => {
	const payload = await chatPayload(readTurn(imageResult("call_1"), readPdf("call_2")));
	assert.deepEqual(afterCall(payload), [
		{ role: "tool", content: "Read image file [image/png]", tool_call_id: "call_1" },
		toolNote("call_2"),
		imageFollowUp(reportPart),
	]);
});

const bridged = { provider: "openai", id: "gpt-4o", compat: { requiresAssistantAfterToolResult: true } };

test("puts the files after the assistant message that pi-ai adds after tool results for some providers", async () => {
	const next: Message = { role: "user", content: "and now?", timestamp: 3 };
	const payload = await chatPayload([...readTurn(readPdf()), next], bridged);
	assert.deepEqual(afterCall(payload, findPdf, true), [
		toolNote(),
		bridge,
		followUp(reportPart),
		{ role: "user", content: "and now?" },
	]);

	const withImage = await chatPayload(
		readTurn(readPdf(), readResult("call_2", [{ type: "image", data: "xx", mimeType: "image/png" }])),
		bridged,
	);
	assert.deepEqual(afterCall(withImage, findPdf, true), [
		toolNote(),
		{ role: "tool", content: "(see attached image)", tool_call_id: "call_2" },
		bridge,
		imageFollowUp(reportPart),
	]);
});

test("adds the assistant message that pi-ai adds after tool results for some providers when the tool results are last", async () => {
	const turn = readTurn(readPdf());
	const call = turn[1];
	assert.ok(call.role === "assistant");
	turn[1] = { ...call, content: [text("I will read the file."), ...call.content] };
	const payload = await chatPayload(turn, bridged);
	assert.deepEqual(afterCall(payload, findPdf, true), [toolNote(), bridge, followUp(reportPart)]);
	assert.deepEqual(afterCall(payload, findPdf, false), [toolNote(), followUp(reportPart)]);
});

test("rewrites a user message marker and a tool result marker in the same payload", async () => {
	const prompt: Message = { role: "user", content: [text("see @a.mp3"), text("[[pi-media:u1:0]]")], timestamp: 0 };
	const payload = await chatPayload([prompt, ...readTurn(readPdf()).slice(1)]);
	const result = messagesOf(assertPureRewrite(payload, findIn({ e1: [pdf], u1: [attachments[2]] })));
	assert.deepEqual(result[0], { role: "user", content: [text("see @a.mp3"), mp3Part] });
	assert.deepEqual(result.slice(2), [toolNote(), followUp(reportPart)]);
});

test("keeps the cache marker on the tool result text when the tool result is the last message", async () => {
	const payload = await chatPayload(readTurn(readPdf()), openRouterClaude);
	assert.deepEqual(payload.messages.at(-1)?.content, [
		{ type: "text", text: `${pdfNote}\n[[pi-media:e1:0]]`, cache_control: { type: "ephemeral" } },
	]);
	assert.deepEqual(afterCall(payload), [
		{ role: "tool", content: [{ type: "text", text: pdfNote, cache_control: { type: "ephemeral" } }], tool_call_id: "call_1" },
		followUp(reportPart),
	]);
});
