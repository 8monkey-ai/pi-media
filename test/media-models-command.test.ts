import assert from "node:assert/strict";
import { constants } from "node:fs";
import { access, chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";
import extension from "../src/index.ts";
import { MP3_BYTES, MP3_PART } from "./fixtures.ts";
import { startMediaServer } from "./media-server.ts";
import { startSession } from "./session-harness.ts";

const KIND_ROWS = ["Image      not set", "Audio      not set", "Document   not set"];
const COMPLETIONS = "openai-completions      (default)  /chat/completions";
const TRANSCRIPTIONS = "openai-transcriptions              /audio/transcriptions";
const MODELS = ["gpt-4.1", "gpt-4.1-mini"];

async function readConfig(dir: string) {
	return JSON.parse(await readFile(join(dir, "pi-media.json"), "utf8"));
}

test("sets a typed model with the API the user selects, asks again for a typed model pi cannot use, and keeps the other keys", async () => {
	const { session, dir, ui, dialogs, errors } = await startSession([extension], {
		models: MODELS,
		files: { "pi-media.json": '{"maxAttachmentBytes": 1000, "other": true}' },
		answers: [
			"Audio      not set",
			"Type a model…",
			"gpt-transcribe",
			"faux/",
			"nope/gpt-transcribe",
			"faux/gpt-transcribe",
			TRANSCRIPTIONS,
		],
	});
	await writeFile(join(dir, "pi-media.json"), '{"maxAttachmentBytes": 1000, "other": true, "edited": true}');
	await session.prompt("/media-models");
	const typeModel = { title: "Audio model (provider/model-id)" };
	assert.deepEqual(dialogs, [
		{ title: "Media models", options: KIND_ROWS },
		{ title: "Audio model", options: ["Not set  ✓", "faux/gpt-4.1", "faux/gpt-4.1-mini", "Type a model…"] },
		typeModel,
		typeModel,
		typeModel,
		typeModel,
		{ title: "API for faux/gpt-transcribe", options: [COMPLETIONS, TRANSCRIPTIONS] },
	]);
	assert.deepEqual(await readConfig(dir), {
		maxAttachmentBytes: 1000,
		other: true,
		edited: true,
		audioModel: { provider: "faux", id: "gpt-transcribe", api: "openai-transcriptions" },
	});
	assert.deepEqual(ui, {
		notifications: [
			{ message: "Type the model as provider/model-id, for example hebo/gpt-transcribe.", type: "error" },
			{ message: "Type the model as provider/model-id, for example hebo/gpt-transcribe.", type: "error" },
			{ message: 'pi has no provider "nope". Add it in models.json or with an extension.', type: "error" },
			{
				message: `Audio model: faux/gpt-transcribe (openai-transcriptions).\nSaved to ${join(dir, "pi-media.json")}`,
				type: "info",
			},
		],
		statuses: { "pi-media": "media: audio faux/gpt-transcribe" },
	});
	assert.deepEqual(errors, []);
});

test("writes a new pi-media.json on first use", async () => {
	const { session, dir, ui, errors } = await startSession([extension], {
		models: MODELS,
		answers: ["Image      not set", "faux/gpt-4.1-mini", COMPLETIONS],
	});
	await session.prompt("/media-models");
	assert.deepEqual(errors, []);
	assert.equal(
		await readFile(join(dir, "pi-media.json"), "utf8"),
		'{\n  "imageModel": {\n    "provider": "faux",\n    "id": "gpt-4.1-mini",\n    "api": "openai-completions"\n  }\n}\n',
	);
	assert.deepEqual(ui.statuses, { "pi-media": "media: image faux/gpt-4.1-mini" });
});

test("shows the current models, marks a current model that is not in pi's list, and replaces it with a model from the list", async () => {
	const { session, dir, ui, dialogs, errors } = await startSession([extension], {
		models: MODELS,
		files: {
			"pi-media.json": JSON.stringify({
				imageModel: { provider: "faux", id: "gpt-4.1-mini", api: "openai-completions" },
				audioModel: { provider: "faux", id: "gpt-transcribe", api: "openai-transcriptions" },
			}),
		},
		answers: ["Audio      faux/gpt-transcribe", "faux/gpt-4.1", COMPLETIONS],
	});
	await session.prompt("/media-models");
	assert.deepEqual(errors, []);
	assert.deepEqual(dialogs, [
		{ title: "Media models", options: ["Image      faux/gpt-4.1-mini", "Audio      faux/gpt-transcribe", "Document   not set"] },
		{
			title: "Audio model",
			options: ["Not set", "faux/gpt-4.1", "faux/gpt-4.1-mini", "faux/gpt-transcribe  ✓", "Type a model…"],
		},
		{ title: "API for faux/gpt-4.1", options: [COMPLETIONS, TRANSCRIPTIONS] },
	]);
	assert.deepEqual(await readConfig(dir), {
		imageModel: { provider: "faux", id: "gpt-4.1-mini", api: "openai-completions" },
		audioModel: { provider: "faux", id: "gpt-4.1", api: "openai-completions" },
	});
	assert.deepEqual(ui.statuses, { "pi-media": "media: image faux/gpt-4.1-mini, audio faux/gpt-4.1" });
});

test("removes a model with Not set and asks for no API", async () => {
	const { session, dir, ui, dialogs, errors } = await startSession([extension], {
		models: MODELS,
		files: {
			"pi-media.json": JSON.stringify({
				imageModel: { provider: "faux", id: "gpt-4.1-mini", api: "openai-completions" },
				audioModel: { provider: "faux", id: "gpt-transcribe", api: "openai-transcriptions" },
			}),
		},
		answers: ["Image      faux/gpt-4.1-mini", "Not set"],
	});
	await session.prompt("/media-models");
	assert.deepEqual(errors, []);
	assert.deepEqual(dialogs.slice(1), [
		{ title: "Image model", options: ["Not set", "faux/gpt-4.1", "faux/gpt-4.1-mini  ✓", "Type a model…"] },
	]);
	assert.deepEqual(await readConfig(dir), {
		audioModel: { provider: "faux", id: "gpt-transcribe", api: "openai-transcriptions" },
	});
	assert.deepEqual(ui, {
		notifications: [
			{
				message: `Image model removed. pi-media attaches images to the main model.\nSaved to ${join(dir, "pi-media.json")}`,
				type: "info",
			},
		],
		statuses: { "pi-media": "media: audio faux/gpt-transcribe" },
	});
});

test("changes nothing when the user presses Esc in any dialog", async (t) => {
	for (const answers of [
		[undefined],
		["Document   not set", undefined],
		["Document   not set", "Type a model…", undefined],
		["Document   not set", "faux/gpt-4.1", undefined],
	]) {
		await t.test(answers.map((answer) => answer ?? "Esc").join(" → "), async () => {
			const { session, dir, ui, dialogs, errors } = await startSession([extension], {
				models: MODELS,
				files: { "pi-media.json": '{"other": true}' },
				answers,
			});
			await session.prompt("/media-models");
			assert.deepEqual(errors, []);
			assert.equal(dialogs.length, answers.length);
			assert.equal(await readFile(join(dir, "pi-media.json"), "utf8"), '{"other": true}');
			assert.deepEqual(ui, { notifications: [], statuses: {} });
		});
	}
});

test("keeps the file and the settings when the write of pi-media.json fails", async (t) => {
	const text = JSON.stringify({ audioModel: { provider: "faux", id: "gpt-transcribe", api: "openai-transcriptions" } });
	const { session, dir, ui, dialogs, errors } = await startSession([extension], {
		models: MODELS,
		files: { "pi-media.json": text },
		answers: ["Image      not set", "faux/gpt-4.1-mini", COMPLETIONS, undefined],
	});
	const path = join(dir, "pi-media.json");
	await chmod(path, 0o444);
	t.after(() => chmod(path, 0o644));
	try {
		await access(path, constants.W_OK);
		t.skip("this process can write a read-only file");
		return;
	} catch {}
	await session.prompt("/media-models");
	assert.equal(errors.length, 1);
	assert.ok(errors[0].startsWith("EACCES: "), errors[0]);
	assert.equal(await readFile(path, "utf8"), text);
	assert.deepEqual(ui.statuses, { "pi-media": "media: audio faux/gpt-transcribe" });
	await session.prompt("/media-models");
	assert.deepEqual(dialogs.at(-1), {
		title: "Media models",
		options: ["Image      not set", "Audio      faux/gpt-transcribe", "Document   not set"],
	});
});

test("writes to stderr that /media-models needs the terminal UI when pi has no UI", async (t) => {
	const consoleError = t.mock.method(console, "error", () => {});
	const { session, dir, errors } = await startSession([extension], { mode: "print" });
	await session.prompt("/media-models");
	assert.deepEqual(errors, []);
	assert.deepEqual(
		consoleError.mock.calls.map((call) => call.arguments),
		[[`pi-media: /media-models needs the terminal UI. Set the media models in ${join(dir, "pi-media.json")}.`]],
	);
});

test("turns pi-media on from the next message when the change leaves no provider that pi does not know", async () => {
	const { session, requests, ui, errors, settle } = await startSession([extension], {
		files: {
			"pi-media.json": JSON.stringify({ audioModel: { provider: "nope", id: "gpt-transcribe", api: "openai-transcriptions" } }),
			"a.mp3": MP3_BYTES,
		},
		answers: ["Audio      nope/gpt-transcribe", "Not set"],
	});
	assert.deepEqual(ui.statuses, {});
	await session.prompt("/media-models");
	assert.deepEqual(errors, []);
	await settle(session.prompt("listen to @a.mp3"));
	assert.deepEqual(requests[0].payload, {
		messages: [{ role: "user", content: [{ type: "text", text: "listen to @a.mp3" }, MP3_PART] }],
	});
});

test("uses the model that the user sets for the media call of the next message", async () => {
	const server = await startMediaServer();
	after(server.close);
	const { session, requests, errors, settle } = await startSession([server.provider, extension], {
		files: { "a.mp3": MP3_BYTES },
		answers: ["Audio      not set", "Type a model…", "hebo/gpt-transcribe", TRANSCRIPTIONS],
	});
	await session.prompt("/media-models");
	await settle(session.prompt("listen to @a.mp3"));
	assert.deepEqual(errors, []);
	assert.deepEqual(
		server.requests.map(({ path, form }) => [path, form?.get("model")]),
		[["/v1/audio/transcriptions", "gpt-transcribe"]],
	);
	assert.deepEqual(requests[0].payload, {
		messages: [
			{ role: "user", content: [{ type: "text", text: "listen to @a.mp3" }] },
			{ role: "user", content: [{ type: "text", text: "Transcript of a.mp3 · hebo/gpt-transcribe\n\nmedia text" }] },
		],
	});
});
