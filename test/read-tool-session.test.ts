import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, type Message } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import { MOV_BYTES } from "./fixtures.ts";
import { startSession } from "./session-harness.ts";

// The model reads the file with the read tool, then answers.
const readThenAnswer = (path: string) => (messages: Message[]) => {
	if (messages.at(-1)?.role !== "user") return fauxAssistantMessage("ok");
	return fauxAssistantMessage(fauxToolCall("read", { path }, { id: "call-1" }), { stopReason: "toolUse" });
};

// The Chat Completions tool messages of the request.
function toolPayload(messages: Message[]) {
	return {
		messages: messages.flatMap((message) =>
			message.role === "toolResult"
				? [
						{
							role: "tool",
							content: message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"),
							tool_call_id: message.toolCallId,
						},
					]
				: [],
		),
	};
}

async function readFile(api: string, name: string, bytes: string | Buffer) {
	const started = await startSession([extension], {
		files: { [name]: bytes },
		api,
		tools: ["read"],
		reply: readThenAnswer(name),
		payload: toolPayload,
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

test("marks the tool result of a Chat Completions model, and the payload carries the file after the tool message", async () => {
	const { session, dir, requests } = await readPdf("openai-completions");
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
	assert.deepEqual(toolResultEntries(session.sessionManager.getBranch())[0].message.content, [{ type: "text", text: note }]);
});

// Only Chat Completions takes files, and it does not take QuickTime video.
for (const [api, name, bytes, kind] of [
	["mistral-conversations", "report.pdf", "%PDF-1.4", "PDF file [application/pdf]"],
	["test-unknown-api", "report.pdf", "%PDF-1.4", "PDF file [application/pdf]"],
	["openai-completions", "clip.mov", MOV_BYTES, "video file [video/quicktime]"],
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
