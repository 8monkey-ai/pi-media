import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
// Pi's main module sets up this dispatcher before it loads extensions. The package does not export it.
import { configureHttpDispatcher } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/http-dispatcher.js";
import extension from "../src/index.ts";
import { MP3_BYTES } from "./fixtures.ts";
import { startMediaServer } from "./media-server.ts";
import { startSession } from "./session-harness.ts";

// This file has its own process, so the short idle timeout applies to no other test.
configureHttpDispatcher(50);

const server = await startMediaServer();
server.state.hold = true;
after(server.close);

// pi-media sends each note as a string.
const notes = (branch: SessionEntry[]) =>
	branch.flatMap((entry) => (entry.type === "custom_message" && typeof entry.content === "string" ? [entry.content] : []));

async function timedOutNotes(settings: Record<string, unknown>, file: string) {
	const { session, settle } = await startSession([server.provider, extension], {
		files: { "pi-media.json": JSON.stringify(settings), "a.mp3": MP3_BYTES, "report.pdf": "%PDF-1.4" },
	});
	await settle(session.prompt(`see @${file}`));
	return notes(session.sessionManager.getBranch());
}

test("stops a call to the transcription model after pi's HTTP idle timeout", { timeout: 5000 }, async () => {
	const settings = { audioModel: { provider: "hebo", id: "gpt-transcribe", api: "openai-transcriptions" } };
	assert.deepEqual(await timedOutNotes(settings, "a.mp3"), [
		"pi-media: hebo/gpt-transcribe could not transcribe a.mp3: fetch failed: Headers Timeout Error.",
	]);
});

// pi-ai adds a hint after "Request timed out." that can change in any release.
test("stops a call to the chat model after pi's HTTP idle timeout", { timeout: 5000 }, async () => {
	const settings = { documentModel: { provider: "hebo", id: "gpt-4.1-mini", api: "openai-completions" } };
	const [note, ...others] = await timedOutNotes(settings, "report.pdf");
	assert.ok(note.startsWith("pi-media: hebo/gpt-4.1-mini could not read report.pdf: Request timed out."), note);
	assert.deepEqual(others, []);
});
