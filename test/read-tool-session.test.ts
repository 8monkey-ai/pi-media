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

async function startReadSession(api: string, name: string, bytes: string | Buffer) {
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

const readPdf = (api: string) => startReadSession(api, "report.pdf", "%PDF-1.4");

function toolResultEntries(branch: SessionEntry[]) {
	return branch.flatMap((entry) =>
		entry.type === "message" && entry.message.role === "toolResult" ? [{ id: entry.id, message: entry.message }] : [],
	);
}

function toolResultContents(messages: Message[]) {
	return messages.flatMap((message) => (message.role === "toolResult" ? [message.content] : []));
}

test("stores the PDF bytes in the tool result details, marks the request copy, and the payload carries the file after the tool message", async () => {
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
for (const [api, name, bytes, kind] of [
	["mistral-conversations", "report.pdf", "%PDF-1.4", "PDF file [application/pdf]"],
	["openai-responses", "report.pdf", "%PDF-1.4", "PDF file [application/pdf]"],
	["openai-completions", "clip.mov", MOV_BYTES, "video file [video/quicktime]"],
] as const) {
	test(`tells a model with the ${api} API that ${name} is not in the request`, async () => {
		const { dir, requests } = await startReadSession(api, name, bytes);
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
