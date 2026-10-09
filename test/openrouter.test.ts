import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "@earendil-works/pi-ai";
import { stream } from "@earendil-works/pi-ai/api/openai-completions";
import "../src/adapters/openai-completions.ts";
import "../src/adapters/openrouter.ts";
import { findAdapter } from "../src/adapters/registry.ts";
import type { Attachment } from "../src/media-entry.ts";
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
	readResult,
	readTurn,
	testModel,
	text,
	user,
} from "./pi-payload.ts";

// OpenRouter uses the Chat Completions message engine; test/openai-completions.test.ts covers the engine. These tests
// cover the kinds and parts that only OpenRouter carries.
const adapter = adapterFor({ api: "openai-completions", provider: "openrouter" });

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
const find = findIn({ e1: attachments });
const rewrite = (payload: unknown) => adapter.rewrite(payload, find);

const audioPart = (data: string, format: string) => ({ type: "input_audio", input_audio: { data, format } });
const videoPart = (url: string) => ({ type: "video_url", video_url: { url } });

const model = testModel("openai-completions", {
	id: "google/gemini-2.5-flash",
	provider: "openrouter",
	baseUrl: "https://openrouter.ai/api/v1",
});

const payloadFor = async (messages: Message[]) =>
	(await capturePayload(stream, model, messages, { apiKey: "test" })) as { messages: Record<string, unknown>[] };

test("takes priority over the Chat Completions adapter for OpenRouter only", () => {
	assert.equal(findAdapter({ api: "openai-completions", provider: "openai" })?.carries("video/mp4", "user"), false);
	assert.equal(adapter.carries("video/mp4", "user"), true);
});

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
			"video/ogg",
			"image/heic",
			"text/plain",
			"constructor",
		].map((type) => [adapter.carries(type, "user"), adapter.carries(type, "toolResult")]),
		[true, true, true, true, true, true, true, true, true, true, true, false, false, false, false, false, false, false].map(
			(carried) => [carried, carried],
		),
	);
});

test("replaces marker blocks with file, input_audio and video_url parts and keeps images and typed text", async () => {
	const payload = await payloadFor([
		user([
			text("see these"),
			{ type: "image", data: "xx", mimeType: "image/png" },
			...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(marker),
		]),
	]);
	assert.deepEqual(contentOf(assertPureRewrite(adapter, payload, find)), [
		[
			{ type: "text", text: "see these" },
			{ type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
			pdfFilePart,
			audioPart("UklGRiQAAAA=", "wav"),
			audioPart("//uQRAAAAAA=", "mp3"),
			audioPart("Rk9STQ==", "aiff"),
			audioPart("//FQ", "aac"),
			audioPart("T2dnUwAC", "ogg"),
			audioPart("ZkxhQw==", "flac"),
			audioPart("AAAAHGZ0eXBNNEE=", "m4a"),
			videoPart("data:video/mp4;base64,AAAAGGZ0eXA="),
			videoPart("data:video/mpeg;base64,AAABug=="),
			videoPart("data:video/webm;base64,GkXfow=="),
		],
	]);
});

test("removes markers of types it does not carry and of missing attachments, and keeps the typed text", async () => {
	const payload = await payloadFor([
		user([text("hi"), text("[[pi-media:gone:0]]"), marker(99), marker(11), marker(12), marker(13), marker(14)]),
	]);
	assert.deepEqual(contentOf(rewrite(payload)), [[{ type: "text", text: "hi" }]]);
});

const toolTail = async (attachment: Attachment | undefined) => {
	const payload = await payloadFor(readTurn(assistantOf(model), readResult("call_1", pdfRead("[[pi-media:e1:0]]"))));
	return messagesOf(adapter.rewrite(payload, findIn({ e1: attachment ? [attachment] : [] }))).slice(2);
};
const toolNote = { role: "tool", content: pdfNote, tool_call_id: "call_1" };

test("moves a video from a tool result to a user message after it", async () => {
	assert.deepEqual(await toolTail(attachments[8]), [
		toolNote,
		{
			role: "user",
			content: [{ type: "text", text: "Attached file(s) from tool result:" }, videoPart("data:video/mp4;base64,AAAAGGZ0eXA=")],
		},
	]);
});

test("removes the tool result marker of a type it does not carry or a missing attachment, and keeps the note", async () => {
	for (const attachment of [attachments[11], attachments[13], undefined]) {
		assert.deepEqual(await toolTail(attachment), [toolNote]);
	}
});
