import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import extension from "../src/index.ts";
import { isMediaEntry } from "../src/media-entry.ts";
import { MP3_BYTES, MP3_PART, WAV_BYTES } from "./fixtures.ts";
import { startSession } from "./session-harness.ts";

// Which user messages a pi-media entry links to, across normal, queued, cleared and branched prompts.

function userWith(text: string, ...parts: unknown[]) {
	return { role: "user", content: [{ type: "text", text }, ...parts] };
}

function user(text: string, files = 0) {
	return userWith(text, ...Array.from({ length: files }, () => MP3_PART));
}

const WAV_PART = { type: "input_audio", input_audio: { data: "UklGRiQAAABXQVZFZm10IA==", format: "wav" } };

async function start() {
	return startSession([extension], { files: { "a.mp3": MP3_BYTES, "b.wav": WAV_BYTES } });
}

test("links a steer message sent while pi streams", async () => {
	const { session, requests, waitForCall, settle } = await start();
	const run = session.prompt("first");
	await waitForCall();
	await session.steer("steer @a.mp3");
	await settle(run);
	assert.deepEqual(requests.at(-1)?.payload, { messages: [user("first"), user("steer @a.mp3", 1)] });
});

test("links a follow-up message sent while pi streams", async () => {
	const { session, requests, waitForCall, settle } = await start();
	const run = session.prompt("first");
	await waitForCall();
	await session.followUp("later @a.mp3");
	await settle(run);
	assert.deepEqual(requests.at(-1)?.payload, { messages: [user("first"), user("later @a.mp3", 1)] });
});

test("links each of two queued messages that share a timestamp to its own entry", async (t) => {
	t.mock.method(Date, "now", () => 1000);
	const { session, requests, waitForCall, settle } = await start();
	const run = session.prompt("first");
	await waitForCall();
	await session.followUp("one @a.mp3");
	await session.steer("two @b.wav");
	await settle(run);
	assert.deepEqual(requests.at(-1)?.payload, {
		messages: [user("first"), userWith("two @b.wav", WAV_PART), userWith("one @a.mp3", MP3_PART)],
	});
});

test("links each of two queued messages with the same text to one entry", async () => {
	const { session, requests, waitForCall, settle } = await start();
	const run = session.prompt("first");
	await waitForCall();
	await session.followUp("same @a.mp3");
	await session.followUp("same @a.mp3");
	await settle(run);
	assert.deepEqual(requests.at(-1)?.payload, {
		messages: [user("first"), user("same @a.mp3", 1), user("same @a.mp3", 1)],
	});
});

test("leaves the entry of a cleared queue unlinked for other text, and links it to the same text", async () => {
	const { session, dir, requests, waitForCall, settle } = await start();
	const run = session.prompt("first");
	await waitForCall();
	await session.followUp("lost @a.mp3");
	session.clearQueue();
	await settle(run);
	await settle(session.prompt("other text"));
	assert.deepEqual(requests.at(-1)?.payload, { messages: [user("first"), user("other text")] });
	await rm(join(dir, "a.mp3"));
	await settle(session.prompt("lost @a.mp3"));
	assert.deepEqual(requests.at(-1)?.payload, {
		messages: [user("first"), user("other text"), user("lost @a.mp3", 1)],
	});
});

test("links one entry when the same text attaches again after a cleared queue", async () => {
	const { session, requests, waitForCall, settle } = await start();
	const run = session.prompt("first");
	await waitForCall();
	await session.followUp("lost @a.mp3");
	session.clearQueue();
	await settle(run);
	await settle(session.prompt("lost @a.mp3"));
	assert.deepEqual(requests.at(-1)?.payload, { messages: [user("first"), user("lost @a.mp3", 1)] });
});

test("does not apply an entry from another branch", async () => {
	const { session, dir, requests, settle } = await start();
	await settle(session.prompt("one"));
	const fork = session.sessionManager.getLeafId();
	assert.ok(fork);
	await settle(session.prompt("two @a.mp3"));
	await session.navigateTree(fork);
	await rm(join(dir, "a.mp3"));
	await settle(session.prompt("two @a.mp3"));
	assert.deepEqual(requests.at(-1)?.payload, { messages: [user("one"), user("two @a.mp3")] });
});

test("links one entry when a message edited from the tree is sent again with the same text", async () => {
	const { session, requests, settle } = await start();
	await settle(session.prompt("see @a.mp3"));
	const first = session.sessionManager.getBranch().find((entry) => entry.type === "message" && entry.message.role === "user");
	assert.ok(first);
	assert.equal((await session.navigateTree(first.id)).editorText, "see @a.mp3");
	await settle(session.prompt("see @a.mp3"));
	assert.deepEqual(requests.at(-1)?.payload, { messages: [user("see @a.mp3", 1)] });
});

test("links a message to which pi adds image hints", async () => {
	const { session, requests, settle } = await start();
	await settle(session.prompt("look @a.mp3", { images: [{ type: "image", data: "AAAA", mimeType: "image/bmp" }] }));
	assert.deepEqual(requests[0].payload, {
		messages: [user("look @a.mp3\n\n[Image omitted: could not be converted to a supported inline image format.]", 1)],
	});
});

test("documents a known limit: does not link a message that a skill or prompt template expands", async () => {
	const { session, requests, settle } = await start();
	await settle(session.prompt("/skill:greet @a.mp3"));
	await settle(session.prompt("/review @a.mp3"));
	assert.deepEqual(
		session.sessionManager.getBranch().flatMap((entry) => (isMediaEntry(entry) ? [entry.data.text] : [])),
		["/skill:greet @a.mp3", "/review @a.mp3"],
	);
	const payload = requests.at(-1)?.payload as { messages: { content: { type: string }[] }[] };
	assert.deepEqual(
		payload.messages.map((message) => message.content.map((part) => part.type)),
		[["text"], ["text"]],
	);
});
