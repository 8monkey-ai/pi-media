import assert from "node:assert/strict";
import { join } from "node:path";
import { after, test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, type Message } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import { AUDIO_MODEL, CHAT_MODEL, MOV_BYTES, MP3_BYTES, PNG_BYTES } from "./fixtures.ts";
import { startMediaServer } from "./media-server.ts";
import { startSession } from "./session-harness.ts";

// The model reads the file with the read tool, then answers.
const readThenAnswer = (path: string) => (messages: Message[]) => {
	if (messages.at(-1)?.role !== "user") return fauxAssistantMessage("ok");
	return fauxAssistantMessage(fauxToolCall("read", { path }, { id: "call-1" }), { stopReason: "toolUse" });
};

// The Chat Completions user and tool messages of the request.
function userAndToolPayload(messages: Message[]) {
	return {
		messages: messages.flatMap((message) => {
			if (message.role === "user") return [{ role: "user", content: message.content }];
			if (message.role !== "toolResult") return [];
			const content = message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
			return [{ role: "tool", content, tool_call_id: message.toolCallId }];
		}),
	};
}

const servers: Array<() => void> = [];
after(() => {
	for (const close of servers) close();
});

// `read` sends the prompt that makes the model read `name`, and `result` gives the first tool result.
async function startReadSession(name: string, { api, settings = {} }: { api?: string; settings?: Record<string, unknown> } = {}) {
	const server = await startMediaServer();
	servers.push(server.close);
	const files = { "a.mp3": MP3_BYTES, "shot.png": PNG_BYTES, "report.pdf": "%PDF-1.4", "clip.mov": MOV_BYTES };
	const started = await startSession([server.provider, extension], {
		files: { "pi-media.json": JSON.stringify(settings), ...files },
		api,
		tools: ["read"],
		reply: readThenAnswer(name),
		payload: userAndToolPayload,
	});
	const read = () => started.settle(started.session.prompt(`summarize ${name}`));
	const result = () => {
		const { content, details } = toolResultEntries(started.session.sessionManager.getBranch())[0].message;
		return { content, details };
	};
	return { ...started, server, read, result };
}

const NOT_IN_REQUEST = "[The API of the current model cannot take this file type. The file content is not in this request.]";

function toolResultEntries(branch: SessionEntry[]) {
	return branch.flatMap((entry) =>
		entry.type === "message" && entry.message.role === "toolResult" ? [{ id: entry.id, message: entry.message }] : [],
	);
}

function toolResultContents(messages: Message[]) {
	return messages.flatMap((message) => (message.role === "toolResult" ? [message.content] : []));
}

test("stores the PDF bytes in the tool result details, marks the request copy, and the payload carries the file after the tool message", async () => {
	const { session, dir, requests, read } = await startReadSession("report.pdf");
	await read();
	const [entry] = toolResultEntries(session.sessionManager.getBranch());
	const note = `Read PDF file [application/pdf]: ${join(dir, "report.pdf")}`;
	assert.deepEqual(toolResultContents(requests[1].messages), [
		[
			{ type: "text", text: note },
			{ type: "text", text: `[[pi-media:${entry.id}:0]]` },
		],
	]);
	assert.deepEqual(requests[1].payload, {
		messages: [
			{ role: "user", content: [{ type: "text", text: "summarize report.pdf" }] },
			{ role: "tool", content: note, tool_call_id: "call-1" },
			{
				role: "user",
				content: [
					{ type: "text", text: "Attached file(s) from tool result:" },
					{ type: "file", file: { filename: "report.pdf", file_data: "data:application/pdf;base64,JVBERi0xLjQ=" } },
				],
			},
		],
	});
	const { content, details } = toolResultEntries(session.sessionManager.getBranch())[0].message;
	assert.deepEqual(
		{ content, details },
		{
			content: [{ type: "text", text: note }],
			details: { path: join(dir, "report.pdf"), mimeType: "application/pdf", data: "JVBERi0xLjQ=" },
		},
	);
});

// Only Chat Completions takes files, and it does not take QuickTime video.
for (const [api, name, kind] of [
	["mistral-conversations", "report.pdf", "PDF file [application/pdf]"],
	["openai-responses", "report.pdf", "PDF file [application/pdf]"],
	["openai-completions", "clip.mov", "video file [video/quicktime]"],
] as const) {
	test(`tells a model with the ${api} API that ${name} is not in the request`, async () => {
		const { dir, requests, read } = await startReadSession(name, { api });
		await read();
		assert.deepEqual(toolResultContents(requests[1].messages), [
			[
				{ type: "text", text: `Read ${kind}: ${join(dir, name)}` },
				{ type: "text", text: NOT_IN_REQUEST },
			],
		]);
	});
}

test("sends a model that needs an assistant message after tool results the PDF from the message and not the PDF from the read tool", async () => {
	const { session, dir, requests, settle } = await startSession([extension], {
		files: { "report.pdf": "%PDF-1.4" },
		compat: { requiresAssistantAfterToolResult: true },
		tools: ["read"],
		reply: readThenAnswer("report.pdf"),
		payload: userAndToolPayload,
	});
	await settle(session.prompt("summarize @report.pdf"));
	assert.deepEqual(requests[1].payload, {
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: "summarize @report.pdf" },
					{ type: "file", file: { filename: "report.pdf", file_data: "data:application/pdf;base64,JVBERi0xLjQ=" } },
				],
			},
			{
				role: "tool",
				content: `Read PDF file [application/pdf]: ${join(dir, "report.pdf")}\n${NOT_IN_REQUEST}`,
				tool_call_id: "call-1",
			},
		],
	});
});

test("reads a PDF as pi's read tool does when a media model has a provider that pi does not know", async () => {
	const { session, settle } = await startSession([extension], {
		files: {
			"pi-media.json": '{"documentModel": {"provider": "nope", "id": "gpt-4.1", "api": "openai-completions"}}',
			"report.pdf": "%PDF-1.4",
		},
		tools: ["read"],
		reply: readThenAnswer("report.pdf"),
	});
	await settle(session.prompt("summarize report.pdf"));
	const { content, details } = toolResultEntries(session.sessionManager.getBranch())[0].message;
	assert.deepEqual({ content, details }, { content: [{ type: "text", text: "%PDF-1.4" }], details: undefined });
});

for (const [name, settings, model, text] of [
	["a.mp3", { audioModel: AUDIO_MODEL }, "hebo/gpt-transcribe", "Transcript of a.mp3 · hebo/gpt-transcribe\n\nmedia text"],
	["shot.png", { imageModel: CHAT_MODEL }, "hebo/gpt-4.1-mini", "Description of shot.png · hebo/gpt-4.1-mini\n\nmedia text"],
] as const) {
	test(`reads ${name} through the media model and gives the main model the text in place of the file`, async () => {
		const { dir, server, requests, read, result } = await startReadSession(name, { settings });
		await read();
		assert.equal(server.requests.length, 1);
		assert.deepEqual(result(), { content: [{ type: "text", text }], details: { model, path: join(dir, name) } });
		assert.deepEqual(requests[1].payload, {
			messages: [
				{ role: "user", content: [{ type: "text", text: `summarize ${name}` }] },
				{ role: "tool", content: text, tool_call_id: "call-1" },
			],
		});
	});
}

test("gives the error note of the media model in the tool result", async () => {
	const { dir, server, read, result } = await startReadSession("a.mp3", { settings: { audioModel: AUDIO_MODEL } });
	server.state.reply = { status: 413, body: JSON.stringify({ error: { message: "File too large" } }) };
	await read();
	assert.deepEqual(result(), {
		content: [{ type: "text", text: "pi-media: hebo/gpt-transcribe could not transcribe a.mp3: 413 File too large." }],
		details: { model: "hebo/gpt-transcribe", path: join(dir, "a.mp3") },
	});
});

test("stops the media call of the read tool when pi aborts", { timeout: 5000 }, async () => {
	const { session, server, waitFor, read, result } = await startReadSession("a.mp3", { settings: { audioModel: AUDIO_MODEL } });
	server.state.hold = true;
	const reading = read();
	await waitFor(() => server.requests.length === 1);
	await session.abort();
	await reading;
	assert.deepEqual(result().content, [
		{ type: "text", text: "pi-media: hebo/gpt-transcribe could not transcribe a.mp3: The user stopped the call." },
	]);
});

for (const [name, settings, kind] of [
	["a.mp3", { audioModel: AUDIO_MODEL }, "audio file [audio/mpeg]"],
	["shot.png", { imageModel: CHAT_MODEL }, "image file [image/png]"],
] as const) {
	test(`calls no media model for ${name} when it is larger than maxAttachmentBytes`, async () => {
		const { dir, server, read, result } = await startReadSession(name, { settings: { ...settings, maxAttachmentBytes: 7 } });
		await read();
		assert.deepEqual(server.requests, []);
		const text = `${kind} is larger than the pi-media limit maxAttachmentBytes (7 bytes): ${join(dir, name)}`;
		assert.deepEqual(result(), { content: [{ type: "text", text }], details: undefined });
	});
}

test("reads a PDF into details when only an audio model is set", async () => {
	const { dir, server, read, result } = await startReadSession("report.pdf", { settings: { audioModel: AUDIO_MODEL } });
	await read();
	assert.deepEqual(server.requests, []);
	assert.deepEqual(result(), {
		content: [{ type: "text", text: `Read PDF file [application/pdf]: ${join(dir, "report.pdf")}` }],
		details: { path: join(dir, "report.pdf"), mimeType: "application/pdf", data: "JVBERi0xLjQ=" },
	});
});
