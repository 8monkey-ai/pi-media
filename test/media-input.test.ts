import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { Message } from "@earendil-works/pi-ai";
import type { ProviderConfig, SessionEntry } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import { MP3_BYTES, MP4_BYTES, PNG_BYTES, PNG_DATA } from "./fixtures.ts";
import { startMediaServer } from "./media-server.ts";
import { inputObserver, type Mode, startSession } from "./session-harness.ts";

const AUDIO_MODEL = { provider: "hebo", id: "gpt-transcribe", api: "openai-transcriptions" };
const IMAGE_MODEL = { provider: "hebo", id: "gpt-4.1-mini", api: "openai-completions" };
const DOCUMENT_MODEL = { provider: "hebo", id: "gpt-4.1-mini", api: "openai-completions" };

const DOCUMENT_INSTRUCTION =
	"Give the full text of this document. In the place of each image or chart, give a description of the image or chart.";
const IMAGE_INSTRUCTION = "Describe this image. Then give all text that is in the image, word for word.";

const servers: Array<() => void> = [];
after(() => {
	for (const close of servers) close();
});

async function startMediaSession(
	settings: Record<string, unknown>,
	files: Record<string, string | Buffer> = {},
	{ mode, provider }: { mode?: Mode; provider?: ProviderConfig } = {},
) {
	const server = await startMediaServer(provider);
	const { observer, inputs } = inputObserver();
	const started = await startSession([server.provider, extension, observer], {
		files: { "pi-media.json": JSON.stringify(settings), ...files },
		mode,
	});
	servers.push(server.close);
	return { ...started, server, inputs };
}

const customMessages = (branch: SessionEntry[]) =>
	branch.flatMap((entry) =>
		entry.type === "custom_message" ? [{ customType: entry.customType, content: entry.content, details: entry.details }] : [],
	);

const customEntries = (branch: SessionEntry[]) => branch.filter((entry) => entry.type === "custom");

const textOf = (content: string | Exclude<Message["content"], string>[number][]) =>
	typeof content === "string" ? content : content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");

const conversation = (branch: SessionEntry[]) =>
	branch.flatMap((entry) => {
		if (entry.type === "custom_message") return [`custom: ${entry.content}`];
		if (entry.type !== "message") return [];
		const { message } = entry;
		if (message.role !== "user" && message.role !== "assistant") return [];
		return [`${message.role}: ${textOf(message.content)}`];
	});

// For each loader, whether it shows the progress line of pi-media.
const showsProgress = (customs: string[][], progress: string) =>
	customs.map((lines) => lines.some((line) => line.endsWith(progress)));

const userContents = (messages: Message[]) => messages.flatMap((message) => (message.role === "user" ? [message.content] : []));

test("sends an audio file to the transcription model and gives the main model the transcript after the user message", async () => {
	const { session, server, requests, ui, settle } = await startMediaSession({ audioModel: AUDIO_MODEL }, { "a.mp3": MP3_BYTES });
	server.state.reply = () => ({ text: "OK, let's start." });
	await settle(session.prompt("listen to @a.mp3"));
	assert.deepEqual(server.requests, [
		{
			path: "/v1/audio/transcriptions",
			authorization: "Bearer test-key",
			transcription: { model: "gpt-transcribe", fileName: "a.mp3", fileType: "audio/mpeg", fileData: "//uQRAAAAAA=" },
		},
	]);
	assert.deepEqual(showsProgress(ui.customs, "Transcribing a.mp3 with hebo/gpt-transcribe…"), [true]);
	const branch = session.sessionManager.getBranch();
	assert.deepEqual(customMessages(branch), [
		{
			customType: "pi-media-text",
			content: "Transcript of a.mp3 · hebo/gpt-transcribe\n\nOK, let's start.",
			details: { error: false },
		},
	]);
	assert.deepEqual(customEntries(branch), []);
	assert.deepEqual(userContents(requests[0].messages), [
		[{ type: "text", text: "listen to @a.mp3" }],
		[{ type: "text", text: "Transcript of a.mp3 · hebo/gpt-transcribe\n\nOK, let's start." }],
	]);
});

for (const { name, settings, file, prompt, model, content, text } of [
	{
		name: "PDF",
		settings: { documentModel: DOCUMENT_MODEL },
		file: { "report.pdf": "%PDF-1.4" },
		prompt: "summarize @report.pdf",
		model: "gpt-4.1-mini",
		content: [
			{ type: "text", text: DOCUMENT_INSTRUCTION },
			{ type: "file", file: { filename: "report.pdf", file_data: "data:application/pdf;base64,JVBERi0xLjQ=" } },
		],
		text: "Text of report.pdf · hebo/gpt-4.1-mini\n\nmedia text",
	},
	{
		name: "audio",
		settings: { audioModel: { ...AUDIO_MODEL, api: "openai-completions" } },
		file: { "a.mp3": MP3_BYTES },
		prompt: "listen to @a.mp3",
		model: "gpt-transcribe",
		content: [
			{ type: "text", text: "Transcribe this audio word for word. Give only the transcript." },
			{ type: "input_audio", input_audio: { data: "//uQRAAAAAA=", format: "mp3" } },
		],
		text: "Transcript of a.mp3 · hebo/gpt-transcribe\n\nmedia text",
	},
]) {
	test(`puts the ${name} part where the marker is in the payload of the media call`, async () => {
		const { session, server, settle } = await startMediaSession(settings, file);
		await settle(session.prompt(prompt));
		assert.deepEqual(
			server.requests.map(({ path, authorization, chat }) => ({
				path,
				authorization,
				model: chat?.model,
				messages: chat?.messages,
			})),
			[
				{
					path: "/v1/chat/completions",
					authorization: "Bearer test-key",
					model,
					messages: [{ role: "user", content }],
				},
			],
		);
		assert.deepEqual(customMessages(session.sessionManager.getBranch()), [
			{ customType: "pi-media-text", content: text, details: { error: false } },
		]);
	});
}

test("calls a chat model that is not in pi's list at the base URL of its provider", async () => {
	const { session, server, settle } = await startMediaSession(
		{ documentModel: { ...DOCUMENT_MODEL, id: "gpt-4.1" } },
		{ "report.pdf": "%PDF-1.4" },
	);
	await settle(session.prompt("summarize @report.pdf"));
	assert.deepEqual(
		server.requests.map(({ path, chat }) => ({ path, model: chat?.model })),
		[{ path: "/v1/chat/completions", model: "gpt-4.1" }],
	);
});

const PASTED = { type: "image" as const, data: "AAAA", mimeType: "image/jpeg" };
const PNG_URL = `data:image/png;base64,${PNG_DATA}`;

for (const { name, text, urls, descriptions } of [
	{
		name: "the images that pi has and the mentioned images",
		text: "see @shot.png",
		urls: ["data:image/jpeg;base64,AAAA", PNG_URL],
		descriptions: ["image 1", "shot.png"],
	},
	{ name: "the images that pi has", text: "see this", urls: ["data:image/jpeg;base64,AAAA"], descriptions: ["image 1"] },
]) {
	test(`sends ${name} to the image model and none to the main model`, async () => {
		const { session, server, requests, inputs, settle } = await startMediaSession(
			{ imageModel: IMAGE_MODEL },
			{ "shot.png": PNG_BYTES },
		);
		await settle(session.prompt(text, { images: [PASTED] }));
		assert.deepEqual(
			server.requests.map(({ chat }) => chat?.messages),
			urls.map((url) => [
				{
					role: "user",
					content: [
						{ type: "text", text: IMAGE_INSTRUCTION },
						{ type: "image_url", image_url: { url } },
					],
				},
			]),
		);
		assert.deepEqual(inputs, [{ text, images: [] }]);
		assert.deepEqual(userContents(requests[0].messages), [
			[{ type: "text", text }],
			...descriptions.map((file) => [{ type: "text", text: `Description of ${file} · hebo/gpt-4.1-mini\n\nmedia text` }]),
		]);
	});
}

test("gives the texts in the order of the files in the message", async () => {
	const { session, settle } = await startMediaSession(
		{ audioModel: AUDIO_MODEL, imageModel: IMAGE_MODEL },
		{ "a.mp3": MP3_BYTES, "b.png": PNG_BYTES },
	);
	await settle(session.prompt("@a.mp3 and @b.png"));
	assert.deepEqual(
		customMessages(session.sessionManager.getBranch()).map(({ content }) => content),
		["Transcript of a.mp3 · hebo/gpt-transcribe\n\nmedia text", "Description of b.png · hebo/gpt-4.1-mini\n\nmedia text"],
	);
});

test("keeps the Authorization header of the provider", async () => {
	const { session, server, settle } = await startMediaSession(
		{ audioModel: AUDIO_MODEL },
		{ "a.mp3": MP3_BYTES },
		{ provider: { headers: { Authorization: "Basic abc", "x-team": "a" } } },
	);
	await settle(session.prompt("listen to @a.mp3"));
	assert.deepEqual(
		server.requests.map(({ authorization, team }) => ({ authorization, team })),
		[{ authorization: "Basic abc", team: "a" }],
	);
});

test("sends the transcription request without credentials to a provider that has no key in pi", async () => {
	const { session, server, settle } = await startMediaSession(
		{ audioModel: AUDIO_MODEL },
		{ "a.mp3": MP3_BYTES },
		{ provider: { apiKey: undefined } },
	);
	await settle(session.prompt("listen to @a.mp3"));
	assert.deepEqual(
		server.requests.map(({ path, authorization }) => ({ path, authorization })),
		[{ path: "/v1/audio/transcriptions", authorization: undefined }],
	);
	assert.deepEqual(
		customMessages(session.sessionManager.getBranch()).map(({ content }) => content),
		["Transcript of a.mp3 · hebo/gpt-transcribe\n\nmedia text"],
	);
});

for (const { name, reply, reason } of [
	{
		name: "stops at its length limit",
		reply: { text: "The report", finishReason: "length" },
		reason: "the output hit the model's length limit.",
	},
	{ name: "gives no text", reply: { text: "" }, reason: "the model gave no text." },
]) {
	test(`gives an error note when the chat model ${name}`, async () => {
		const { session, server, settle } = await startMediaSession({ documentModel: DOCUMENT_MODEL }, { "report.pdf": "%PDF-1.4" });
		server.state.reply = () => reply;
		await settle(session.prompt("summarize @report.pdf"));
		assert.deepEqual(customMessages(session.sessionManager.getBranch()), [
			{
				customType: "pi-media-text",
				content: `pi-media: hebo/gpt-4.1-mini could not read report.pdf: ${reason}`,
				details: { error: true },
			},
		]);
	});
}

test("attaches a file of a type without a media model to the main model", async () => {
	const { session, server, requests, settle } = await startMediaSession({ audioModel: AUDIO_MODEL }, { "clip.mp4": MP4_BYTES });
	await settle(session.prompt("watch @clip.mp4"));
	assert.deepEqual(server.requests, []);
	assert.deepEqual(requests[0].payload, {
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: "watch @clip.mp4" },
					{ type: "video_url", video_url: { url: `data:video/mp4;base64,${MP4_BYTES.toString("base64")}` } },
				],
			},
		],
	});
});

for (const { name, settings, file, progress, failed, stopped } of [
	{
		name: "transcription",
		settings: { audioModel: AUDIO_MODEL },
		file: "a.mp3",
		progress: "Transcribing a.mp3 with hebo/gpt-transcribe…",
		failed: "pi-media: hebo/gpt-transcribe could not transcribe a.mp3: 413 File too large.",
		stopped: "pi-media: hebo/gpt-transcribe could not transcribe a.mp3: The user stopped the call.",
	},
	{
		name: "chat",
		settings: { documentModel: DOCUMENT_MODEL },
		file: "report.pdf",
		progress: "Reading report.pdf with hebo/gpt-4.1-mini…",
		failed: 'pi-media: hebo/gpt-4.1-mini could not read report.pdf: 413: {"message":"File too large"}.',
		stopped: "pi-media: hebo/gpt-4.1-mini could not read report.pdf: The user stopped the call.",
	},
	{
		name: "image",
		settings: { imageModel: IMAGE_MODEL },
		file: "shot.png",
		progress: "Describing shot.png with hebo/gpt-4.1-mini…",
		failed: 'pi-media: hebo/gpt-4.1-mini could not describe shot.png: 413: {"message":"File too large"}.',
		stopped: "pi-media: hebo/gpt-4.1-mini could not describe shot.png: The user stopped the call.",
	},
]) {
	const files = { "a.mp3": MP3_BYTES, "report.pdf": "%PDF-1.4", "shot.png": PNG_BYTES };

	test(`gives the main model an error note when the ${name} model fails`, async () => {
		const { session, server, requests, settle } = await startMediaSession(settings, files);
		server.state.reply = () => ({ status: 413, body: JSON.stringify({ error: { message: "File too large" } }) });
		await settle(session.prompt(`see @${file}`));
		assert.deepEqual(customMessages(session.sessionManager.getBranch()), [
			{ customType: "pi-media-text", content: failed, details: { error: true } },
		]);
		assert.deepEqual(userContents(requests[0].messages), [
			[{ type: "text", text: `see @${file}` }],
			[{ type: "text", text: failed }],
		]);
	});

	test(`stops the call to the ${name} model on Esc and gives the main model an error note`, { timeout: 5000 }, async () => {
		const { session, server, requests, ui, press, waitFor, settle } = await startMediaSession(settings, files);
		server.state.hold = true;
		const run = session.prompt(`see @${file}`);
		await waitFor(() => server.requests.length === 1 && ui.customs.length === 1);
		press("\x1b");
		await settle(run);
		assert.deepEqual(showsProgress(ui.customs, progress), [true]);
		assert.deepEqual(customMessages(session.sessionManager.getBranch()), [
			{ customType: "pi-media-text", content: stopped, details: { error: true } },
		]);
		assert.deepEqual(userContents(requests[0].messages), [
			[{ type: "text", text: `see @${file}` }],
			[{ type: "text", text: stopped }],
		]);
	});
}

test("stops the call and the remaining media calls of the message on Esc", { timeout: 5000 }, async () => {
	const { session, server, ui, press, waitFor, settle } = await startMediaSession(
		{ audioModel: AUDIO_MODEL },
		{ "a.mp3": MP3_BYTES, "b.mp3": MP3_BYTES },
	);
	server.state.hold = true;
	const run = session.prompt("listen to @a.mp3 and @b.mp3");
	await waitFor(() => server.requests.length === 1 && ui.customs.length === 1);
	press("\x1b");
	await settle(run);
	assert.equal(server.requests.length, 1);
	assert.equal(ui.customs.length, 1);
	assert.deepEqual(
		customMessages(session.sessionManager.getBranch()).map(({ content }) => content),
		[
			"pi-media: hebo/gpt-transcribe could not transcribe a.mp3: The user stopped the call.",
			"pi-media: hebo/gpt-transcribe could not transcribe b.mp3: The user stopped the call.",
		],
	);
});

for (const { name, contentType, body } of [
	{ name: "an HTML body", contentType: "text/html", body: "<html><body><h1>502 Bad Gateway</h1></body></html>" },
	{ name: "a text body", contentType: "text/plain", body: "Bad Gateway" },
]) {
	test(`gives the HTTP status text in the note when the transcription server fails with ${name}`, async () => {
		const { session, server, settle } = await startMediaSession({ audioModel: AUDIO_MODEL }, { "a.mp3": MP3_BYTES });
		server.state.reply = () => ({ status: 502, body, contentType });
		await settle(session.prompt("listen to @a.mp3"));
		assert.deepEqual(
			customMessages(session.sessionManager.getBranch()).map(({ content }) => content),
			["pi-media: hebo/gpt-transcribe could not transcribe a.mp3: 502 Bad Gateway."],
		);
	});
}

test("gives an error note and calls no model for an audio type that the openai-completions API cannot take", async () => {
	const { session, server, settle } = await startMediaSession(
		{ audioModel: { ...AUDIO_MODEL, api: "openai-completions" } },
		{ "voice.amr": Buffer.from("#!AMR\n\0\0\0\0") },
	);
	await settle(session.prompt("listen to @voice.amr"));
	assert.deepEqual(server.requests, []);
	assert.deepEqual(customMessages(session.sessionManager.getBranch()), [
		{
			customType: "pi-media-text",
			content:
				"pi-media: hebo/gpt-transcribe could not transcribe voice.amr: the openai-completions API cannot take audio/amr files.",
			details: { error: true },
		},
	]);
});

for (const mode of ["print", "rpc"] as const) {
	test(`calls the media model without a loader in ${mode} mode`, async () => {
		const { session, server, settle } = await startMediaSession({ audioModel: AUDIO_MODEL }, { "a.mp3": MP3_BYTES }, { mode });
		await settle(session.prompt("listen to @a.mp3"));
		assert.equal(server.requests.length, 1);
		assert.deepEqual(customMessages(session.sessionManager.getBranch()), [
			{
				customType: "pi-media-text",
				content: "Transcript of a.mp3 · hebo/gpt-transcribe\n\nmedia text",
				details: { error: false },
			},
		]);
	});
}

const userTexts = (messages: Message[]) => userContents(messages).map(textOf);

for (const streamingBehavior of ["steer", "followUp"] as const) {
	// Pi gives the main model one queued message per turn by default, so the main model answers the transcript alone
	// before it gets the user message.
	test(`queues the transcript with ${streamingBehavior} before a user message that is queued with ${streamingBehavior}`, async () => {
		const { session, requests, settle, waitForCall } = await startMediaSession(
			{ audioModel: AUDIO_MODEL },
			{ "a.mp3": MP3_BYTES },
		);
		const run = session.prompt("first");
		await waitForCall();
		await session.prompt("listen to @a.mp3", { streamingBehavior });
		await settle(run);
		const text = "Transcript of a.mp3 · hebo/gpt-transcribe\n\nmedia text";
		assert.deepEqual(conversation(session.sessionManager.getBranch()), [
			"user: first",
			"assistant: ok",
			`custom: ${text}`,
			"assistant: ok",
			"user: listen to @a.mp3",
			"assistant: ok",
		]);
		assert.deepEqual(
			requests.map(({ messages }) => userTexts(messages)),
			[["first"], ["first", text], ["first", text, "listen to @a.mp3"]],
		);
	});
}

test("stores the transcript and does not call the media model again on later turns", async () => {
	const { session, server, requests, settle } = await startMediaSession({ audioModel: AUDIO_MODEL }, { "a.mp3": MP3_BYTES });
	await settle(session.prompt("listen to @a.mp3"));
	await settle(session.prompt("again"));
	assert.equal(server.requests.length, 1);
	assert.deepEqual(userContents(requests[1].messages), [
		[{ type: "text", text: "listen to @a.mp3" }],
		[{ type: "text", text: "Transcript of a.mp3 · hebo/gpt-transcribe\n\nmedia text" }],
		[{ type: "text", text: "again" }],
	]);
});
