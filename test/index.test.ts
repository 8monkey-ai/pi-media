import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type ExtensionFactory, type InputEvent, SessionManager } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import { MP3_BYTES, PNG_BYTES, WAV_BYTES } from "./fixtures.ts";
import { startSession } from "./session-harness.ts";

const MP3_PART = { type: "file", file: { data: "//uQRAAAAAA=", media_type: "audio/mpeg" } };
const PNG_IMAGE = { type: "image", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ", mimeType: "image/png" };

// Runs after pi-media and records the input that pi-media passes on.
function inputObserver() {
	const inputs: Pick<InputEvent, "text" | "images">[] = [];
	const observer: ExtensionFactory = (pi) => {
		pi.on("input", ({ text, images }) => {
			inputs.push({ text, images });
			return { action: "continue" };
		});
	};
	return { inputs, observer };
}

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

test("marks the request copy of the user message and sends the attachment as a file part", async () => {
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

for (const api of ["anthropic-messages", "test-unknown-api"]) {
	test(`sends only the typed path as text to a model with the ${api} API`, async () => {
		const { session, requests, settle } = await startSession([extension], { files: { "a.mp3": MP3_BYTES }, api });
		await settle(session.prompt("listen to @a.mp3"));
		assert.deepEqual(
			requests[0].messages.filter((message) => message.role === "user").map((message) => message.content),
			[[{ type: "text", text: "listen to @a.mp3" }]],
		);
		assert.deepEqual(requests[0].payload, {
			messages: [{ role: "user", content: [{ type: "text", text: "listen to @a.mp3" }] }],
		});
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
	assert.deepEqual(inputs, [{ text: "see @shot.png", images: [existing, PNG_IMAGE] }]);
	assert.deepEqual(
		session.sessionManager.getBranch().filter((entry) => entry.type === "custom"),
		[],
	);
});

test("attaches from every input source", async () => {
	const { inputs, observer } = inputObserver();
	const { session, settle } = await startSession([extension, observer], { files: { "shot.png": PNG_BYTES } });
	for (const source of ["interactive", "rpc", "extension"] as const) await settle(session.prompt("@shot.png", { source }));
	assert.deepEqual(inputs, [
		{ text: "@shot.png", images: [PNG_IMAGE] },
		{ text: "@shot.png", images: [PNG_IMAGE] },
		{ text: "@shot.png", images: [PNG_IMAGE] },
	]);
});

test("passes input without media on unchanged", async () => {
	const { inputs, observer } = inputObserver();
	const { session, requests, settle } = await startSession([extension, observer]);
	await settle(session.prompt("hello"));
	assert.deepEqual(inputs, [{ text: "hello", images: undefined }]);
	assert.deepEqual(requests[0].payload, { messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }] });
});
