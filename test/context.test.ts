import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { markContext } from "../src/context.ts";

test("appends one marker block per attachment and turns string content into blocks", () => {
	const session = SessionManager.inMemory("/");
	const entryId = session.appendCustomEntry("pi-media", {
		text: "compare @a.pdf @b.pdf",
		attachments: [
			{ path: "/a.pdf", mimeType: "application/pdf", data: "JVBERi0xLjQ=" },
			{ path: "/b.pdf", mimeType: "application/pdf", data: "JVBERi0xLjc=" },
		],
	});
	session.appendMessage({ role: "user", content: "compare @a.pdf @b.pdf", timestamp: 1 });
	session.appendMessage({ role: "user", content: "thanks", timestamp: 2 });
	const messages = [
		{ role: "user" as const, content: "compare @a.pdf @b.pdf", timestamp: 1 },
		{ role: "user" as const, content: "thanks", timestamp: 2 },
	];
	assert.deepEqual(markContext(messages, session.getBranch()), {
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: "compare @a.pdf @b.pdf" },
					{ type: "text", text: `[[pi-media:${entryId}:0]]` },
					{ type: "text", text: `[[pi-media:${entryId}:1]]` },
				],
				timestamp: 1,
			},
			{ role: "user", content: "thanks", timestamp: 2 },
		],
	});
});

test("returns undefined when no user message has media", () => {
	const session = SessionManager.inMemory("/");
	session.appendMessage({ role: "user", content: "hello", timestamp: 1 });
	assert.equal(markContext([{ role: "user", content: "hello", timestamp: 1 }], session.getBranch()), undefined);
});
