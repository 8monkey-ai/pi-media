import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { markContext } from "../src/context.ts";

const carriesAll = { carries: () => true };
const carriesAudio = { carries: (mimeType: string) => mimeType.startsWith("audio/") };

function sessionWithMedia() {
	const session = SessionManager.inMemory("/");
	const entryId = session.appendCustomEntry("pi-media", {
		text: "compare @a.pdf @b.mp3",
		attachments: [
			{ path: "/a.pdf", mimeType: "application/pdf", data: "JVBERi0xLjQ=" },
			{ path: "/b.mp3", mimeType: "audio/mpeg", data: "//uQRAAAAAA=" },
		],
	});
	session.appendMessage({ role: "user", content: "compare @a.pdf @b.mp3", timestamp: 1 });
	session.appendMessage({ role: "user", content: "thanks", timestamp: 2 });
	const messages = [
		{ role: "user" as const, content: "compare @a.pdf @b.mp3", timestamp: 1 },
		{ role: "user" as const, content: "thanks", timestamp: 2 },
	];
	return { entryId, branch: session.getBranch(), messages };
}

test("appends one marker block per attachment and turns string content into blocks", () => {
	const { entryId, branch, messages } = sessionWithMedia();
	assert.deepEqual(markContext(messages, branch, carriesAll), {
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: "compare @a.pdf @b.mp3" },
					{ type: "text", text: `[[pi-media:${entryId}:0]]` },
					{ type: "text", text: `[[pi-media:${entryId}:1]]` },
				],
				timestamp: 1,
			},
			{ role: "user", content: "thanks", timestamp: 2 },
		],
	});
});

test("marks only the attachments that the adapter carries", () => {
	const { entryId, branch, messages } = sessionWithMedia();
	assert.deepEqual(markContext(messages, branch, carriesAudio)?.messages[0], {
		role: "user",
		content: [
			{ type: "text", text: "compare @a.pdf @b.mp3" },
			{ type: "text", text: `[[pi-media:${entryId}:1]]` },
		],
		timestamp: 1,
	});
});

test("returns undefined when the adapter carries none of the attachments", () => {
	const { branch, messages } = sessionWithMedia();
	assert.equal(markContext(messages, branch, { carries: () => false }), undefined);
});

test("does not mark user attachments for an adapter that carries files only in tool results", () => {
	const { branch, messages } = sessionWithMedia();
	assert.equal(markContext(messages, branch, { carries: (_mimeType, place) => place === "toolResult" }), undefined);
});

test("returns undefined without an adapter", () => {
	const { branch, messages } = sessionWithMedia();
	assert.equal(markContext(messages, branch, undefined), undefined);
});

test("returns undefined when no user message has media", () => {
	const session = SessionManager.inMemory("/");
	session.appendMessage({ role: "user", content: "hello", timestamp: 1 });
	assert.equal(markContext([{ role: "user", content: "hello", timestamp: 1 }], session.getBranch(), carriesAll), undefined);
});

test("ignores a pi-media entry whose attachments do not have the attachment shape", () => {
	const session = SessionManager.inMemory("/");
	session.appendCustomEntry("pi-media", { text: "look", attachments: [{ path: 1 }] });
	session.appendMessage({ role: "user", content: "look", timestamp: 1 });
	assert.equal(markContext([{ role: "user", content: "look", timestamp: 1 }], session.getBranch(), carriesAll), undefined);
});

function readResult(toolCallId: string, timestamp: number, path: string) {
	return {
		role: "toolResult" as const,
		toolCallId,
		toolName: "read",
		content: [{ type: "text" as const, text: `Read PDF file [application/pdf]: ${path}` }],
		details: { path, mimeType: "application/pdf", data: "JVBERi0xLjQ=" },
		isError: false,
		timestamp,
	};
}

// Stores the tool results on a branch, then marks the context that holds the results at `inContext`.
// Returns the entry ids of the results and the content of each marked context message.
function markStoredResults(results: ReturnType<typeof readResult>[], inContext: number[]) {
	const session = SessionManager.inMemory("/");
	const ids = results.map((result) => session.appendMessage(result));
	const marked = markContext(
		inContext.map((index) => results[index]),
		session.getBranch(),
		carriesAll,
	);
	return { ids, contents: marked?.messages.map((message) => (message.role === "toolResult" ? message.content : undefined)) };
}

const markedRead = (path: string, entryId: string) => [
	{ type: "text", text: `Read PDF file [application/pdf]: ${path}` },
	{ type: "text", text: `[[pi-media:${entryId}:0]]` },
];

test("marks a tool result with its own entry when a result with the same timestamp is not in the context", () => {
	const { ids, contents } = markStoredResults([readResult("call_1", 1, "/a.pdf"), readResult("call_2", 1, "/b.pdf")], [1]);
	assert.deepEqual(contents, [markedRead("/b.pdf", ids[1])]);
});

test("marks a tool result with its own entry when an earlier result with the same tool call id is not in the context", () => {
	const { ids, contents } = markStoredResults([readResult("call_0", 1, "/a.pdf"), readResult("call_0", 2, "/b.pdf")], [1]);
	assert.deepEqual(contents, [markedRead("/b.pdf", ids[1])]);
});

test("marks each of two tool results with the same tool call id and timestamp with its own entry", () => {
	const { ids, contents } = markStoredResults([readResult("call_0", 1, "/a.pdf"), readResult("call_0", 1, "/b.pdf")], [0, 1]);
	assert.deepEqual(contents, [markedRead("/a.pdf", ids[0]), markedRead("/b.pdf", ids[1])]);
});

test("marks only read results whose details hold an attachment", () => {
	const results = {
		"a result of another tool": { ...readResult("call_0", 1, "/a.pdf"), toolName: "bash" },
		"a truncated text read": {
			...readResult("call_0", 1, "/a.md"),
			details: { truncation: { truncated: true, truncatedBy: "lines" } },
		},
	};
	for (const [name, result] of Object.entries(results)) {
		const session = SessionManager.inMemory("/");
		session.appendMessage(result);
		assert.equal(markContext([result], session.getBranch(), carriesAll), undefined, name);
	}
});

test("links a message to the entry with its exact text before an entry whose text with image hints matches", () => {
	const session = SessionManager.inMemory("/");
	const attachments = [{ path: "/a.pdf", mimeType: "application/pdf", data: "JVBERi0xLjQ=" }];
	const exactId = session.appendCustomEntry("pi-media", { text: "a\n\nb", attachments });
	session.appendCustomEntry("pi-media", { text: "a", attachments });
	session.appendMessage({ role: "user", content: "a\n\nb", timestamp: 1 });
	assert.deepEqual(markContext([{ role: "user", content: "a\n\nb", timestamp: 1 }], session.getBranch(), carriesAll), {
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: "a\n\nb" },
					{ type: "text", text: `[[pi-media:${exactId}:0]]` },
				],
				timestamp: 1,
			},
		],
	});
});
