import assert from "node:assert/strict";
import { constants } from "node:fs";
import { access, chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, type Message } from "@earendil-works/pi-ai";
import extension from "../src/index.ts";
import { MP3_BYTES, MP3_PART } from "./fixtures.ts";
import { startMediaServer } from "./media-server.ts";
import { startSession } from "./session-harness.ts";

const KIND_ROWS = ["Image      not set", "Audio      not set", "Document   not set"];
const COMPLETIONS = "openai-completions      (default)  /chat/completions";
const TRANSCRIPTIONS = "openai-transcriptions              /audio/transcriptions";
const MODELS = ["gpt-4.1", "gpt-4.1-mini"];
const [ENTER, UP, DOWN, RIGHT, ESC, BACKSPACE] = ["\r", "\x1b[A", "\x1b[B", "\x1b[C", "\x1b", "\x7f"];

const PICKER_TIMEOUT = { timeout: 10000 };

type Session = Awaited<ReturnType<typeof startSession>>;

// The list rows of the model picker: the selected row starts with "→ ", the other rows with two spaces.
const listRows = (screen: string) => screen.split("\n").filter((line) => /^(→ | {2})/.test(line));

// Runs /media-models until the prompt ends or the model picker opens. Gives the first screen of the picker, if it opens.
// The wait stops when the prompt ends, because a wait that never stops keeps the test process alive.
async function openPicker({ session, customs, waitFor }: Session) {
	const shown = customs.length;
	let ended = false;
	const run = session.prompt("/media-models").finally(() => {
		ended = true;
	});
	await waitFor(() => ended || customs.length > shown);
	return { run, screen: customs.at(shown) };
}

// Runs /media-models and presses `keys` in the model picker. Gives the rows that the picker shows before each key.
async function pickModel(started: Session, keys: string[]) {
	const { run, screen: opened } = await openPicker(started);
	if (opened === undefined) throw new Error("the model picker did not open");
	let screen = opened;
	const screens: string[][] = [];
	for (const key of keys) {
		screens.push(listRows(screen));
		screen = started.press(key);
	}
	await run;
	return screens;
}

async function readConfig(dir: string) {
	return JSON.parse(await readFile(join(dir, "pi-media.json"), "utf8"));
}

test(
	"sets a typed model with the API the user selects, asks again for a typed model pi cannot use, and keeps the other keys",
	PICKER_TIMEOUT,
	async () => {
		const started = await startSession([extension], {
			models: MODELS,
			files: { "pi-media.json": '{"maxAttachmentBytes": 1000, "other": true}' },
			answers: ["Audio      not set", "gpt-transcribe", "faux/", "nope/gpt-transcribe", "faux/gpt-transcribe", TRANSCRIPTIONS],
		});
		const { dir, ui, dialogs, errors } = started;
		await writeFile(join(dir, "pi-media.json"), '{"maxAttachmentBytes": 1000, "other": true, "edited": true}');
		assert.deepEqual(await pickModel(started, [UP, ENTER]), [
			["→ Not set  ✓", "  faux/gpt-4.1", "  faux/gpt-4.1-mini", "  Type a model…"],
			["  Not set  ✓", "  faux/gpt-4.1", "  faux/gpt-4.1-mini", "→ Type a model…"],
		]);
		const typeModel = { title: "Audio model (provider/model-id)" };
		assert.deepEqual(dialogs, [
			{ title: "Media models", options: KIND_ROWS },
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
	},
);

test("writes a new pi-media.json on first use", PICKER_TIMEOUT, async () => {
	const started = await startSession([extension], { models: MODELS, answers: ["Image      not set", COMPLETIONS] });
	const { dir, ui, errors } = started;
	await pickModel(started, [DOWN, DOWN, ENTER]);
	assert.deepEqual(errors, []);
	assert.equal(
		await readFile(join(dir, "pi-media.json"), "utf8"),
		'{\n  "imageModel": {\n    "provider": "faux",\n    "id": "gpt-4.1-mini",\n    "api": "openai-completions"\n  }\n}\n',
	);
	assert.deepEqual(ui.statuses, { "pi-media": "media: image faux/gpt-4.1-mini" });
});

test(
	"filters the models as the user types, keeps Type a model… for every query, and sets the first row on Enter",
	PICKER_TIMEOUT,
	async () => {
		const started = await startSession([extension], { models: MODELS, answers: ["Image      not set", COMPLETIONS] });
		assert.deepEqual(await pickModel(started, ["m", "i", "z", BACKSPACE, ENTER]), [
			["→ Not set  ✓", "  faux/gpt-4.1", "  faux/gpt-4.1-mini", "  Type a model…"],
			["→ faux/gpt-4.1-mini", "  Type a model…"],
			["→ faux/gpt-4.1-mini", "  Type a model…"],
			["→ Type a model…"],
			["→ faux/gpt-4.1-mini", "  Type a model…"],
		]);
		assert.ok(
			started.customs[0].split("\n").some((line) => line.trim() === "Image model"),
			started.customs[0],
		);
		assert.deepEqual(started.errors, []);
		assert.deepEqual(await readConfig(started.dir), {
			imageModel: { provider: "faux", id: "gpt-4.1-mini", api: "openai-completions" },
		});
	},
);

test("finds a model by letters that are not next to each other", PICKER_TIMEOUT, async () => {
	const started = await startSession([extension], { models: MODELS, answers: ["Image      not set", COMPLETIONS] });
	const screens = await pickModel(started, [..."g41m", ENTER]);
	assert.deepEqual(screens.at(-1), ["→ faux/gpt-4.1-mini", "  Type a model…"]);
	assert.deepEqual(await readConfig(started.dir), {
		imageModel: { provider: "faux", id: "gpt-4.1-mini", api: "openai-completions" },
	});
});

test("keeps the selected model when the user moves the cursor in the query", PICKER_TIMEOUT, async () => {
	const started = await startSession([extension], { models: MODELS, answers: ["Image      not set", COMPLETIONS] });
	await pickModel(started, [DOWN, RIGHT, ENTER]);
	assert.deepEqual(started.errors, []);
	assert.deepEqual(await readConfig(started.dir), {
		imageModel: { provider: "faux", id: "gpt-4.1", api: "openai-completions" },
	});
});

test("shows the model list in a select dialog outside the terminal UI", PICKER_TIMEOUT, async () => {
	const started = await startSession([extension], {
		mode: "rpc",
		models: MODELS,
		answers: ["Image      not set", "faux/gpt-4.1-mini", COMPLETIONS],
	});
	const { dir, dialogs, errors } = started;
	const { run, screen } = await openPicker(started);
	assert.equal(screen, undefined, "the model picker opened in rpc mode");
	await run;
	assert.deepEqual(errors, []);
	assert.deepEqual(dialogs[1], {
		title: "Image model",
		options: ["Not set  ✓", "faux/gpt-4.1", "faux/gpt-4.1-mini", "Type a model…"],
	});
	assert.deepEqual((await readConfig(dir)).imageModel, { provider: "faux", id: "gpt-4.1-mini", api: "openai-completions" });
});

test(
	"shows the current models, marks a current model that is not in pi's list, and replaces it with a model from the list",
	PICKER_TIMEOUT,
	async () => {
		const started = await startSession([extension], {
			models: MODELS,
			files: {
				"pi-media.json": JSON.stringify({
					imageModel: { provider: "faux", id: "gpt-4.1-mini", api: "openai-completions" },
					audioModel: { provider: "faux", id: "gpt-transcribe", api: "openai-transcriptions" },
				}),
			},
			answers: ["Audio      faux/gpt-transcribe", COMPLETIONS],
		});
		const { dir, ui, dialogs, errors } = started;
		const [shown] = await pickModel(started, [DOWN, ENTER]);
		assert.deepEqual(errors, []);
		assert.deepEqual(shown, [
			"→ Not set",
			"  faux/gpt-4.1",
			"  faux/gpt-4.1-mini",
			"  faux/gpt-transcribe  ✓",
			"  Type a model…",
		]);
		assert.deepEqual(dialogs, [
			{
				title: "Media models",
				options: ["Image      faux/gpt-4.1-mini", "Audio      faux/gpt-transcribe", "Document   not set"],
			},
			{ title: "API for faux/gpt-4.1", options: [COMPLETIONS, TRANSCRIPTIONS] },
		]);
		assert.deepEqual(await readConfig(dir), {
			imageModel: { provider: "faux", id: "gpt-4.1-mini", api: "openai-completions" },
			audioModel: { provider: "faux", id: "gpt-4.1", api: "openai-completions" },
		});
		assert.deepEqual(ui.statuses, { "pi-media": "media: image faux/gpt-4.1-mini, audio faux/gpt-4.1" });
	},
);

test("removes a model with Not set and asks for no API", PICKER_TIMEOUT, async () => {
	const started = await startSession([extension], {
		models: MODELS,
		files: {
			"pi-media.json": JSON.stringify({
				imageModel: { provider: "faux", id: "gpt-4.1-mini", api: "openai-completions" },
				audioModel: { provider: "faux", id: "gpt-transcribe", api: "openai-transcriptions" },
			}),
		},
		answers: ["Image      faux/gpt-4.1-mini"],
	});
	const { dir, ui, dialogs, errors } = started;
	assert.deepEqual(await pickModel(started, [ENTER]), [
		["→ Not set", "  faux/gpt-4.1", "  faux/gpt-4.1-mini  ✓", "  Type a model…"],
	]);
	assert.deepEqual(errors, []);
	assert.equal(dialogs.length, 1);
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
	const cases: Array<[string, Array<string | undefined>, string[]?]> = [
		["file types", [undefined]],
		["models", ["Document   not set"], [ESC]],
		["typed model", ["Document   not set", undefined], [UP, ENTER]],
		["APIs", ["Document   not set", undefined], [DOWN, ENTER]],
	];
	for (const [name, answers, keys] of cases) {
		await t.test(`Esc in the ${name}`, PICKER_TIMEOUT, async () => {
			const started = await startSession([extension], {
				models: MODELS,
				files: { "pi-media.json": '{"other": true}' },
				answers,
			});
			const { session, dir, ui, dialogs, errors } = started;
			if (keys) await pickModel(started, keys);
			else await session.prompt("/media-models");
			assert.deepEqual(errors, []);
			assert.equal(dialogs.length, answers.length);
			assert.equal(await readFile(join(dir, "pi-media.json"), "utf8"), '{"other": true}');
			assert.deepEqual(ui, { notifications: [], statuses: {} });
		});
	}
});

test("keeps the file and the settings when the write of pi-media.json fails", PICKER_TIMEOUT, async (t) => {
	const text = JSON.stringify({ audioModel: { provider: "faux", id: "gpt-transcribe", api: "openai-transcriptions" } });
	const started = await startSession([extension], {
		models: MODELS,
		files: { "pi-media.json": text },
		answers: ["Image      not set", COMPLETIONS, undefined],
	});
	const { session, dir, ui, dialogs, errors } = started;
	const path = join(dir, "pi-media.json");
	await chmod(path, 0o444);
	t.after(() => chmod(path, 0o644));
	try {
		await access(path, constants.W_OK);
		t.skip("this process can write a read-only file");
		return;
	} catch {}
	await pickModel(started, [DOWN, DOWN, ENTER]);
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

test(
	"turns pi-media on from the next message when the change leaves no provider that pi does not know",
	PICKER_TIMEOUT,
	async () => {
		const started = await startSession([extension], {
			files: {
				"pi-media.json": JSON.stringify({ audioModel: { provider: "nope", id: "gpt-transcribe", api: "openai-transcriptions" } }),
				"a.mp3": MP3_BYTES,
			},
			answers: ["Audio      nope/gpt-transcribe"],
		});
		const { session, requests, ui, errors, settle } = started;
		assert.deepEqual(ui.statuses, {});
		await pickModel(started, [ENTER]);
		assert.deepEqual(errors, []);
		await settle(session.prompt("listen to @a.mp3"));
		assert.deepEqual(requests[0].payload, {
			messages: [{ role: "user", content: [{ type: "text", text: "listen to @a.mp3" }, MP3_PART] }],
		});
	},
);

test("uses the model that the user sets for the media call of the next message", PICKER_TIMEOUT, async () => {
	const server = await startMediaServer();
	after(server.close);
	const started = await startSession([server.provider, extension], {
		files: { "a.mp3": MP3_BYTES },
		answers: ["Audio      not set", "hebo/gpt-transcribe", TRANSCRIPTIONS],
	});
	const { session, requests, errors, settle } = started;
	await pickModel(started, [UP, ENTER]);
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

test("uses the model that the user sets for the next read of the read tool", PICKER_TIMEOUT, async () => {
	const server = await startMediaServer();
	after(server.close);
	const started = await startSession([server.provider, extension], {
		files: { "a.mp3": MP3_BYTES },
		answers: ["Audio      not set", "hebo/gpt-transcribe", TRANSCRIPTIONS],
		tools: ["read"],
		reply: (messages: Message[]) =>
			messages.at(-1)?.role === "user"
				? fauxAssistantMessage(fauxToolCall("read", { path: "a.mp3" }, { id: "call-1" }), { stopReason: "toolUse" })
				: fauxAssistantMessage("ok"),
	});
	const { session, errors, settle } = started;
	await pickModel(started, [UP, ENTER]);
	await settle(session.prompt("summarize a.mp3"));
	assert.deepEqual(errors, []);
	const results = session.sessionManager
		.getBranch()
		.flatMap((entry) => (entry.type === "message" && entry.message.role === "toolResult" ? [entry.message.content] : []));
	assert.deepEqual(results, [[{ type: "text", text: "Transcript of a.mp3 · hebo/gpt-transcribe\n\nmedia text" }]]);
});
