import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, type Message } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { registerAdapter } from "../src/adapters/registry.ts";
import extension from "../src/index.ts";
import { takeMarkers } from "../src/marker.ts";
import { MP4_BYTES } from "./fixtures.ts";
import { startSession } from "./session-harness.ts";

// The model reads the file with the read tool, then answers.
const readThenAnswer = (path: string) => (messages: Message[]) => {
	if (messages.at(-1)?.role !== "user") return fauxAssistantMessage("ok");
	return fauxAssistantMessage(fauxToolCall("read", { path }, { id: "call-1" }), { stopReason: "toolUse" });
};

// The payload holds the tool results of the request, so an adapter can find markers in them.
function toolResultPayload(messages: Message[]) {
	return { toolResults: messages.filter((message) => message.role === "toolResult").map((message) => message.content) };
}

// Replaces the payload with the attachments that the markers in it name.
registerAdapter({
	api: "test-tool-result-api",
	carries: () => true,
	rewrite: (payload, attachment) => ({
		attachments: (payload as ReturnType<typeof toolResultPayload>).toolResults
			.flat()
			.flatMap((part) => (part.type === "text" ? (takeMarkers(part.text, false)?.markers ?? []) : []))
			.map(({ entryId, index }) => attachment(entryId, index)),
	}),
});

async function readFile(api: string, name: string, bytes: string | Buffer) {
	const started = await startSession([extension], {
		files: { [name]: bytes },
		api,
		tools: ["read"],
		reply: readThenAnswer(name),
		payload: toolResultPayload,
	});
	await started.settle(started.session.prompt(`summarize ${name}`));
	return started;
}

const readPdf = (api: string) => readFile(api, "report.pdf", "%PDF-1.4");

function toolResultEntries(branch: SessionEntry[]) {
	return branch.flatMap((entry) =>
		entry.type === "message" && entry.message.role === "toolResult" ? [{ id: entry.id, message: entry.message }] : [],
	);
}

function toolResultContents(messages: Message[]) {
	return messages.flatMap((message) => (message.role === "toolResult" ? [message.content] : []));
}

test("stores the bytes of a PDF that the model reads in the tool result details", async () => {
	const { session, dir } = await readPdf("openai-completions");
	assert.deepEqual(
		toolResultEntries(session.sessionManager.getBranch()).map(({ message }) => ({
			content: message.content,
			details: message.details,
		})),
		[
			{
				content: [{ type: "text", text: `Read PDF file [application/pdf]: ${join(dir, "report.pdf")}` }],
				details: { path: join(dir, "report.pdf"), mimeType: "application/pdf", data: "JVBERi0xLjQ=" },
			},
		],
	);
});

test("marks the tool result for an adapter that carries it, and the payload rewrite finds the attachment", async () => {
	const { session, dir, requests } = await readPdf("test-tool-result-api");
	const [entry] = toolResultEntries(session.sessionManager.getBranch());
	assert.deepEqual(toolResultContents(requests[1].messages), [
		[
			{ type: "text", text: `Read PDF file [application/pdf]: ${join(dir, "report.pdf")}` },
			{ type: "text", text: `[[pi-media:${entry.id}:0]]` },
		],
	]);
	assert.deepEqual(requests[1].payload, {
		attachments: [{ path: join(dir, "report.pdf"), mimeType: "application/pdf", data: "JVBERi0xLjQ=" }],
	});
	assert.deepEqual(toolResultEntries(session.sessionManager.getBranch())[0].message.content, [
		{ type: "text", text: `Read PDF file [application/pdf]: ${join(dir, "report.pdf")}` },
	]);
});

// Mistral has no adapter. Chat Completions has one, but it does not carry video.
for (const [api, name, bytes, kind] of [
	["mistral-conversations", "report.pdf", "%PDF-1.4", "PDF file [application/pdf]"],
	["openai-completions", "clip.mp4", MP4_BYTES, "video file [video/mp4]"],
] as const) {
	test(`tells a model with the ${api} API that ${name} is not in the request`, async () => {
		const { dir, requests } = await readFile(api, name, bytes);
		assert.deepEqual(toolResultContents(requests[1].messages), [
			[
				{ type: "text", text: `Read ${kind}: ${join(dir, name)}` },
				{
					type: "text",
					text: "[The API of the current model cannot take this file type. The file content is not in this request.]",
				},
			],
		]);
	});
}
