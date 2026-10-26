import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import { MP3_BYTES, MP3_PART, PNG_BYTES, PNG_DATA, WAV_BYTES } from "./fixtures.ts";
import { inputObserver, startSession } from "./session-harness.ts";

test("stores a PDF in a pi-media entry and keeps the typed text in the user message", async () => {
	const { session, dir, settle } = await startSession([extension], { files: { "report.pdf": "%PDF-1.4" } });
	await settle(session.prompt("summarize @report.pdf"));
	const branch = session.sessionManager.getBranch();
	assert.deepEqual(
		branch.flatMap((entry) => (entry.type === "custom" ? [{ customType: entry.customType, data: entry.data }] : [])),
		[
			{
				customType: "pi-media",
				data: {
					text: "summarize @report.pdf",
					attachments: [{ path: join(dir, "report.pdf"), mimeType: "application/pdf", data: "JVBERi0xLjQ=" }],
				},
			},
		],
	);
	assert.deepEqual(
		branch.flatMap((entry) => (entry.type === "message" && entry.message.role === "user" ? [entry.message.content] : [])),
		[[{ type: "text", text: "summarize @report.pdf" }]],
	);
});

test("marks the request copy of the user message and sends the attachment as an audio part", async () => {
	const { session, requests, settle } = await startSession([extension], { files: { "a.mp3": MP3_BYTES } });
	await settle(session.prompt("listen to @a.mp3"));
	const entry = session.sessionManager.getBranch().find((candidate) => candidate.type === "custom");
	assert.ok(entry);
	const user = requests[0].messages.filter((message) => message.role === "user");
	assert.deepEqual(
		user.map((message) => message.content),
		[
			[
				{ type: "text", text: "listen to @a.mp3" },
				{ type: "text", text: `[[pi-media:${entry.id}:0]]` },
			],
		],
	);
	assert.deepEqual(requests[0].payload, {
		messages: [{ role: "user", content: [{ type: "text", text: "listen to @a.mp3" }, MP3_PART] }],
	});
});

for (const api of ["mistral-conversations", "openai-responses"]) {
	test(`sends only the typed path as text to a model with the ${api} API`, async () => {
		const { session, requests, settle } = await startSession([extension], { files: { "a.mp3": MP3_BYTES }, api });
		await settle(session.prompt("listen to @a.mp3"));
		assert.deepEqual(
			requests[0].messages.filter((message) => message.role === "user").map((message) => message.content),
			[[{ type: "text", text: "listen to @a.mp3" }]],
		);
	});
}

test("sends the stored bytes on later turns after the file changes and after it is deleted", async () => {
	const { session, dir, requests, settle } = await startSession([extension], { files: { "a.mp3": MP3_BYTES } });
	await settle(session.prompt("listen to @a.mp3"));
	await writeFile(join(dir, "a.mp3"), WAV_BYTES);
	await settle(session.prompt("again"));
	await rm(join(dir, "a.mp3"));
	await settle(session.prompt("once more"));
	const expected = [
		{ role: "user", content: [{ type: "text", text: "listen to @a.mp3" }, MP3_PART] },
		{ role: "user", content: [{ type: "text", text: "again" }] },
	];
	assert.deepEqual(requests[1].payload, { messages: expected });
	assert.deepEqual(requests[2].payload, {
		messages: [...expected, { role: "user", content: [{ type: "text", text: "once more" }] }],
	});
});

test("sends the stored bytes in a resumed session after the file is deleted", async () => {
	const sessions = await mkdtemp(join(tmpdir(), "pi-media-sessions-"));
	const first = await startSession([extension], {
		files: { "a.mp3": MP3_BYTES },
		sessionManager: (dir) => SessionManager.create(dir, sessions),
	});
	await first.settle(first.session.prompt("listen to @a.mp3"));
	const file = first.session.sessionFile;
	assert.ok(file);
	first.session.dispose();
	await rm(join(first.dir, "a.mp3"));
	const resumed = await startSession([extension], { sessionManager: () => SessionManager.open(file, sessions) });
	await resumed.settle(resumed.session.prompt("again"));
	assert.deepEqual(resumed.requests[0].payload, {
		messages: [
			{ role: "user", content: [{ type: "text", text: "listen to @a.mp3" }, MP3_PART] },
			{ role: "user", content: [{ type: "text", text: "again" }] },
		],
	});
});

test("passes mentioned images to pi after the images already in the input and keeps the text", async () => {
	const { inputs, observer } = inputObserver();
	const { session, settle } = await startSession([extension, observer], { files: { "shot.png": PNG_BYTES } });
	const existing = { type: "image" as const, data: "AAAA", mimeType: "image/jpeg" };
	await settle(session.prompt("see @shot.png", { images: [existing] }));
	assert.deepEqual(inputs, [
		{ text: "see @shot.png", images: [existing, { type: "image", data: PNG_DATA, mimeType: "image/png" }] },
	]);
	assert.deepEqual(
		session.sessionManager.getBranch().filter((entry) => entry.type === "custom"),
		[],
	);
});

test("passes input without media on unchanged", async () => {
	const { inputs, observer } = inputObserver();
	const { session, requests, settle } = await startSession([extension, observer]);
	await settle(session.prompt("hello"));
	assert.deepEqual(inputs, [{ text: "hello", images: undefined }]);
	assert.deepEqual(requests[0].payload, { messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }] });
});

const MODELS = {
	documentModel: { provider: "faux", id: "gpt-4.1", api: "openai-completions" },
	audioModel: { provider: "faux", id: "gpt-transcribe", api: "openai-transcriptions" },
	imageModel: { provider: "faux", id: "gpt-4.1-mini", api: "openai-completions" },
};

test("shows the media models in the footer in the order image, audio, document", async () => {
	const { ui } = await startSession([extension], { files: { "pi-media.json": JSON.stringify(MODELS) } });
	assert.deepEqual(ui, {
		notifications: [],
		statuses: { "pi-media": "media: image faux/gpt-4.1-mini, audio faux/gpt-transcribe, document faux/gpt-4.1" },
		customs: [],
	});
});

test("shows only the media models that are set in the footer", async () => {
	const { ui } = await startSession([extension], {
		files: { "pi-media.json": JSON.stringify({ audioModel: MODELS.audioModel }) },
	});
	assert.deepEqual(ui.statuses, { "pi-media": "media: audio faux/gpt-transcribe" });
});

test("shows nothing in the footer when no media model is set", async () => {
	const { ui } = await startSession([extension]);
	assert.deepEqual(ui, { notifications: [], statuses: {}, customs: [] });
});

test("shows an error for each media model with a provider that pi does not know and then attaches no files", async () => {
	const settings = {
		imageModel: { provider: "nope", id: "gpt-4.1-mini", api: "openai-completions" },
		audioModel: { provider: "faux", id: "gpt-transcribe", api: "openai-transcriptions" },
		documentModel: { provider: "gone", id: "gpt-4.1", api: "openai-completions" },
	};
	const { session, dir, requests, ui, settle } = await startSession([extension], {
		files: { "pi-media.json": JSON.stringify(settings), "a.mp3": MP3_BYTES },
	});
	const path = join(dir, "pi-media.json");
	assert.deepEqual(ui, {
		notifications: [
			{
				message: `pi-media: imageModel in ${path}: pi has no provider "nope". Add it in models.json or with an extension. pi-media is off for this session.`,
				type: "error",
			},
			{
				message: `pi-media: documentModel in ${path}: pi has no provider "gone". Add it in models.json or with an extension. pi-media is off for this session.`,
				type: "error",
			},
		],
		statuses: {},
		customs: [],
	});
	await settle(session.prompt("listen to @a.mp3"));
	assert.deepEqual(
		session.sessionManager.getBranch().filter((entry) => entry.type === "custom"),
		[],
	);
	assert.deepEqual(requests[0].payload, { messages: [{ role: "user", content: [{ type: "text", text: "listen to @a.mp3" }] }] });
});

test("writes each unknown provider error to stderr when pi has no UI", async (t) => {
	const consoleError = t.mock.method(console, "error", () => {});
	const { dir } = await startSession([extension], {
		files: { "pi-media.json": JSON.stringify({ audioModel: { ...MODELS.audioModel, provider: "nope" } }) },
		mode: "print",
	});
	assert.deepEqual(
		consoleError.mock.calls.map((call) => call.arguments),
		[
			[
				`pi-media: audioModel in ${join(dir, "pi-media.json")}: pi has no provider "nope". Add it in models.json or with an extension. pi-media is off for this session.`,
			],
		],
	);
});

// The prompt is the marker text of the stored attachment, so that the payload has a marker even when the context hook adds none.
test("gives no file for a marker in the prompt while a media model has a provider that pi does not know", async () => {
	let entryId = "";
	const { session, requests, settle } = await startSession([extension], {
		files: { "pi-media.json": JSON.stringify({ audioModel: { ...MODELS.audioModel, provider: "nope" } }) },
		sessionManager: (dir) => {
			const manager = SessionManager.inMemory(dir);
			const text = "listen to @a.mp3";
			entryId = manager.appendCustomEntry("pi-media", {
				text,
				attachments: [{ path: join(dir, "a.mp3"), mimeType: "audio/mpeg", data: MP3_BYTES.toString("base64") }],
			});
			manager.appendMessage({ role: "user", content: [{ type: "text", text }], timestamp: 1 });
			manager.appendMessage(fauxAssistantMessage("ok"));
			return manager;
		},
	});
	await settle(session.prompt(`[[pi-media:${entryId}:0]]`));
	assert.deepEqual(requests[0].payload, {
		messages: [
			{ role: "user", content: [{ type: "text", text: "listen to @a.mp3" }] },
			{ role: "user", content: [{ type: "text", text: `[[pi-media:${entryId}:0]]` }] },
		],
	});
});

test("tells the model that a stored read of a media file is not in the request while a media model has a provider that pi does not know", async () => {
	const { session, requests, settle } = await startSession([extension], {
		files: { "pi-media.json": JSON.stringify({ audioModel: { ...MODELS.audioModel, provider: "nope" } }) },
		sessionManager: (dir) => {
			const manager = SessionManager.inMemory(dir);
			manager.appendMessage({ role: "user", content: [{ type: "text", text: "listen to a.mp3" }], timestamp: 1 });
			manager.appendMessage(
				fauxAssistantMessage(fauxToolCall("read", { path: "a.mp3" }, { id: "call-1" }), { stopReason: "toolUse" }),
			);
			manager.appendMessage({
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "read",
				content: [{ type: "text", text: "Read audio file [audio/mpeg]" }],
				details: { path: join(dir, "a.mp3"), mimeType: "audio/mpeg", data: MP3_BYTES.toString("base64") },
				isError: false,
				timestamp: 2,
			});
			manager.appendMessage(fauxAssistantMessage("ok"));
			return manager;
		},
	});
	await settle(session.prompt("again"));
	assert.deepEqual(
		requests[0].messages.flatMap((message) => (message.role === "toolResult" ? [message.content] : [])),
		[
			[
				{ type: "text", text: "Read audio file [audio/mpeg]" },
				{
					type: "text",
					text: "[The API of the current model cannot take this file type. The file content is not in this request.]",
				},
			],
		],
	);
});
