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

test("returns undefined when no user message has media", () => {
	const session = SessionManager.inMemory("/");
	session.appendMessage({ role: "user", content: "hello", timestamp: 1 });
	assert.equal(markContext([{ role: "user", content: "hello", timestamp: 1 }], session.getBranch(), carriesAll), undefined);
});
