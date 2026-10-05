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
async function payloadFor(api: string, messages: Message[], modelId = "gemini-2.5-flash") {
	const context = normalizeContext({ messages });
	let payload: unknown;
	const onPayload = (params: unknown) => {
		payload = params;
		throw new Error("payload captured");
	};
	const events =
		api === "google-generative-ai"
			? geminiStream(getModel("google", modelId as "gemini-2.5-flash"), context, { apiKey: "test", onPayload })
			: vertexStream(getModel("google-vertex", modelId as "gemini-2.5-flash"), context, {
					apiKey: "test",
					project: "test",
					location: "us-central1",
					onPayload,
				});
	for await (const _ of events);
	return payload as { model: string; contents: { role: string; parts: unknown[] }[] };
}

function user(content: Extract<Message, { role: "user" }>["content"]): Message {
	return { role: "user", content, timestamp: 1 };
}

const PDF_NOTE = "Read PDF file [application/pdf]: /tmp/x/report.pdf";

function toolResult(toolCallId: string, content: Extract<Message, { role: "toolResult" }>["content"], isError = false): Message {
	return { role: "toolResult", toolCallId, toolName: "read", content, isError, timestamp: 1 };
}

// A user turn, a model turn that calls `read` once for each tool result, and the tool results.
function readContext(...results: Extract<Message, { role: "toolResult" }>["content"][]): Message[] {
	return [
		user("go"),
		fauxAssistantMessage(results.map((_, index) => fauxToolCall("read", { path: `f${index}` }, { id: `t${index}` }))),
		...results.map((content, index) => toolResult(`t${index}`, content)),
	];
}

function readOf(marker: string) {
	return [
		{ type: "text" as const, text: PDF_NOTE },
		{ type: "text" as const, text: marker },
	];
}

for (const [api, provider] of [
	["google-generative-ai", "google"],
	["google-vertex", "google-vertex"],
]) {
	const adapter = findAdapter({ api, provider });
	const rewrite = (payload: unknown) => adapter?.rewrite(payload, find);

	test(`${api}: carries audio, video and PDFs, and no other types`, () => {
		assert.deepEqual(
			["audio/wav", "video/webm", "application/pdf", "image/heic", "text/plain"].map((type) => adapter?.carries(type, "user")),
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

	test(`${api}: leaves markers in model turns`, async () => {
		const payload = await payloadFor(api, [user("go"), fauxAssistantMessage([fauxText("I saw [[pi-media:e1:0]]")])]);
		assert.deepEqual(
			payload.contents.map((content) => content.role),
			["user", "model"],
		);
		assert.equal(rewrite(payload), undefined);
	});

	test(`${api}: carries audio, video and PDFs in tool results, and no other types`, () => {
		assert.deepEqual(
			["audio/wav", "video/webm", "application/pdf", "image/heic", "text/plain"].map((type) =>
				adapter?.carries(type, "toolResult"),
			),
			[true, true, true, false, false],
		);
	});

	test(`${api}: Gemini 3 takes a PDF from a tool result in functionResponse.parts`, async () => {
		const payload = await payloadFor(api, readContext(readOf("[[pi-media:e1:0]]")), "gemini-3-flash-preview");
		assert.deepEqual(rewrite(payload), {
			...payload,
			contents: [
				payload.contents[0],
				payload.contents[1],
				{
					role: "user",
					parts: [{ functionResponse: { name: "read", response: { output: PDF_NOTE }, parts: [pdfPart], id: "t0" } }],
				},
			],
		});
	});

	test(`${api}: Gemini 3 adds a PDF after the images of the same tool result`, async () => {
		const payload = await payloadFor(
			api,
			readContext([
				{ type: "text", text: PDF_NOTE },
				{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
				{ type: "text", text: "[[pi-media:e1:0]]" },
			]),
			"gemini-3-flash-preview",
		);
		assert.deepEqual((rewrite(payload) as typeof payload).contents[2], {
			role: "user",
			parts: [{ functionResponse: { name: "read", response: { output: PDF_NOTE }, parts: [pngPart, pdfPart], id: "t0" } }],
		});
	});

	for (const [kind, marker, part] of [
		["audio", "[[pi-media:e1:1]]", mp3Part],
		["video", "[[pi-media:e1:2]]", mp4Part],
	] as const) {
		test(`${api}: Gemini 3 sends ${kind} from a tool result in a user turn after the function responses`, async () => {
			const payload = await payloadFor(api, readContext(readOf(marker)), "gemini-3-flash-preview");
			assert.deepEqual(rewrite(payload), {
				...payload,
				contents: [
					payload.contents[0],
					payload.contents[1],
					{ role: "user", parts: [{ functionResponse: { name: "read", response: { output: PDF_NOTE }, id: "t0" } }] },
					{ role: "user", parts: [{ text: "Tool result file:" }, part] },
				],
			});
		});
	}

	for (const [kind, marker, part] of [
		["a PDF", "[[pi-media:e1:0]]", pdfPart],
		["audio", "[[pi-media:e1:1]]", mp3Part],
		["video", "[[pi-media:e1:2]]", mp4Part],
	] as const) {
		test(`${api}: Gemini 2.5 sends ${kind} from a tool result in a user turn after the function responses`, async () => {
			const payload = await payloadFor(api, readContext(readOf(marker)));
			assert.deepEqual(rewrite(payload), {
				...payload,
				contents: [
					payload.contents[0],
					payload.contents[1],
					{ role: "user", parts: [{ functionResponse: { name: "read", response: { output: PDF_NOTE } } }] },
					{ role: "user", parts: [{ text: "Tool result file:" }, part] },
				],
			});
		});
	}

	test(`${api}: removes a tool result marker whose attachment is missing or of a type it does not carry`, async () => {
		for (const marker of ["[[pi-media:gone:0]]", "[[pi-media:e1:7]]", "[[pi-media:e1:3]]"]) {
			for (const modelId of ["gemini-2.5-flash", "gemini-3-flash-preview"]) {
				const payload = await payloadFor(api, readContext(readOf(marker)), modelId);
				const result = rewrite(payload) as typeof payload;
				assert.equal(result.contents.length, 3);
				assert.deepEqual(result.contents[2].parts, [
					{
						functionResponse: {
							name: "read",
							response: { output: PDF_NOTE },
							...(modelId === "gemini-3-flash-preview" && { id: "t0" }),
						},
					},
				]);
			}
		}
	});

	test(`${api}: removes a marker from an error result`, async () => {
		const payload = await payloadFor(api, [
			user("go"),
			fauxAssistantMessage([fauxToolCall("read", { path: "a" }, { id: "t0" })]),
			toolResult("t0", readOf("[[pi-media:e1:0]]"), true),
		]);
		assert.deepEqual((rewrite(payload) as typeof payload).contents.slice(2), [
			{ role: "user", parts: [{ functionResponse: { name: "read", response: { error: PDF_NOTE } } }] },
			{ role: "user", parts: [{ text: "Tool result file:" }, pdfPart] },
		]);
	});

	test(`${api}: Gemini 3 places media from one of two tool results and keeps the other one`, async () => {
		const payload = await payloadFor(
			api,
			readContext(readOf("[[pi-media:e1:0]]"), [{ type: "text", text: "plain text" }]),
			"gemini-3-flash-preview",
		);
		const result = rewrite(payload) as typeof payload;
		assert.deepEqual(result.contents.slice(2), [
			{
				role: "user",
				parts: [
					{ functionResponse: { name: "read", response: { output: PDF_NOTE }, parts: [pdfPart], id: "t0" } },
					{ functionResponse: { name: "read", response: { output: "plain text" }, id: "t1" } },
				],
			},
		]);
		assert.equal(result.contents[2].parts[1], payload.contents[2].parts[1]);
	});

	test(`${api}: Gemini 2.5 sends the files of all tool results in one user turn after the function responses`, async () => {
		const payload = await payloadFor(
			api,
			readContext(readOf("[[pi-media:e1:1]]"), [{ type: "text", text: "plain text" }], readOf("[[pi-media:e1:0]]")),
		);
		assert.deepEqual((rewrite(payload) as typeof payload).contents.slice(2), [
			{
				role: "user",
				parts: [
					{ functionResponse: { name: "read", response: { output: PDF_NOTE } } },
					{ functionResponse: { name: "read", response: { output: "plain text" } } },
					{ functionResponse: { name: "read", response: { output: PDF_NOTE } } },
				],
			},
			{ role: "user", parts: [{ text: "Tool result file:" }, mp3Part, pdfPart] },
		]);
	});

	test(`${api}: Gemini 2.5 adds files to the image turn that pi-ai adds after the same function responses`, async () => {
		const payload = await payloadFor(
			api,
			readContext(readOf("[[pi-media:e1:0]]"), [
				{ type: "text", text: "Read image file [image/png]" },
				{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
			]),
		);
		assert.deepEqual((rewrite(payload) as typeof payload).contents.slice(2), [
			{
				role: "user",
				parts: [
					{ functionResponse: { name: "read", response: { output: PDF_NOTE } } },
					{ functionResponse: { name: "read", response: { output: "Read image file [image/png]" } } },
				],
			},
			{ role: "user", parts: [{ text: "Tool result image:" }, pngPart, { text: "Tool result file:" }, pdfPart] },
		]);
	});

	test(`${api}: replaces markers in user messages and tool results of one payload`, async () => {
		const payload = await payloadFor(
			api,
			[
				user([
					{ type: "text", text: "listen" },
					{ type: "text", text: "[[pi-media:e1:1]]" },
				]),
				...readContext(readOf("[[pi-media:e1:0]]")).slice(1),
			],
			"gemini-3-flash-preview",
		);
		const result = rewrite(payload) as typeof payload;
		assert.deepEqual(result.contents[0], { role: "user", parts: [{ text: "listen" }, mp3Part] });
		assert.equal(result.contents[1], payload.contents[1]);
		assert.deepEqual(result.contents[2], {
			role: "user",
			parts: [{ functionResponse: { name: "read", response: { output: PDF_NOTE }, parts: [pdfPart], id: "t0" } }],
		});
	});

	test(`${api}: gives the same tool result output for the same input`, async () => {
		for (const modelId of ["gemini-2.5-flash", "gemini-3-flash-preview"]) {
			const payload = await payloadFor(api, readContext(readOf("[[pi-media:e1:0]]"), readOf("[[pi-media:e1:2]]")), modelId);
			assert.equal(JSON.stringify(rewrite(payload)), JSON.stringify(rewrite(payload)));
		}
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
