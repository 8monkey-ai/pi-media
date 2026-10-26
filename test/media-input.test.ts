import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { Message } from "@earendil-works/pi-ai";
import type { ProviderConfig, SessionEntry } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import { MP3_BYTES, MP4_BYTES, PNG_BYTES } from "./fixtures.ts";
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

type MediaSessionOptions = { mode?: Mode; provider?: ProviderConfig };

async function startMediaSession(
	settings: Record<string, unknown>,
	files: Record<string, string | Buffer> = {},
	{ mode, provider }: MediaSessionOptions = {},
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

// The role and text of each message in the session, in order.
const transcript = (branch: SessionEntry[]) =>
	branch.flatMap((entry) => {
		if (entry.type === "custom_message") return [`custom: ${entry.content}`];
		if (entry.type !== "message") return [];
		const { message } = entry;
		if (message.role !== "user" && message.role !== "assistant") return [];
		const content = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
		return [`${message.role}: ${content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")}`];
	});

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
	assert.deepEqual(ui.customs, [["⠋ Transcribing a.mp3 with hebo/gpt-transcribe…", "escape/ctrl+c cancel"]]);
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

test("puts the PDF part where the marker is in the payload of the media call", async () => {
	const { session, server, settle } = await startMediaSession({ documentModel: DOCUMENT_MODEL }, { "report.pdf": "%PDF-1.4" });
	await settle(session.prompt("summarize @report.pdf"));
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
				model: "gpt-4.1-mini",
				messages: [
					{
						role: "user",
						content: [
							{ type: "text", text: DOCUMENT_INSTRUCTION },
							{ type: "file", file: { filename: "report.pdf", file_data: "data:application/pdf;base64,JVBERi0xLjQ=" } },
						],
					},
				],
			},
		],
	);
	assert.deepEqual(customMessages(session.sessionManager.getBranch()), [
		{
			customType: "pi-media-text",
			content: "Text of report.pdf · hebo/gpt-4.1-mini\n\nmedia text",
			details: { error: false },
		},
	]);
});

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
const PNG_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ";

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

test("sends one Authorization header to a provider that adds its own", async () => {
	const { session, server, settle } = await startMediaSession(
		{ audioModel: AUDIO_MODEL },
		{ "a.mp3": MP3_BYTES },
		{ provider: { authHeader: true } },
	);
	await settle(session.prompt("listen to @a.mp3"));
	assert.deepEqual(
		server.requests.map(({ authorization }) => authorization),
		["Bearer test-key"],
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

for (const { name, settings, file, failed, stopped } of [
	{
		name: "transcription",
		settings: { audioModel: AUDIO_MODEL },
		file: "a.mp3",
		failed: "pi-media: hebo/gpt-transcribe could not transcribe a.mp3: 413 File too large.",
		stopped: "pi-media: hebo/gpt-transcribe could not transcribe a.mp3: The user stopped the call.",
	},
	{
		name: "chat",
		settings: { documentModel: DOCUMENT_MODEL },
		file: "report.pdf",
		failed: 'pi-media: hebo/gpt-4.1-mini could not read report.pdf: 413: {"message":"File too large"}.',
		stopped: "pi-media: hebo/gpt-4.1-mini could not read report.pdf: The user stopped the call.",
	},
]) {
	const files = { "a.mp3": MP3_BYTES, "report.pdf": "%PDF-1.4" };

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

	test(`stops the call to the ${name} model on Esc and gives the main model an error note`, async () => {
		const { session, server, requests, ui, press, waitFor, settle } = await startMediaSession(settings, files);
		server.state.hold = true;
		const run = session.prompt(`see @${file}`);
		await waitFor(() => server.requests.length === 1 && ui.customs.length === 1);
		press("\x1b");
		await settle(run);
		assert.deepEqual(customMessages(session.sessionManager.getBranch()), [
			{ customType: "pi-media-text", content: stopped, details: { error: true } },
		]);
		assert.deepEqual(userContents(requests[0].messages), [
			[{ type: "text", text: `see @${file}` }],
			[{ type: "text", text: stopped }],
		]);
	});
}

test("stops the call and the remaining media calls of the message on Esc", async () => {
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
	assert.deepEqual(
		customMessages(session.sessionManager.getBranch()).map(({ content }) => content),
		[
			"pi-media: hebo/gpt-transcribe could not transcribe a.mp3: The user stopped the call.",
			"pi-media: hebo/gpt-transcribe could not transcribe b.mp3: The user stopped the call.",
		],
	);
});

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

const userTexts = (messages: Message[]) =>
	userContents(messages).map((content) =>
		typeof content === "string" ? content : content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
	);

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
		assert.deepEqual(transcript(session.sessionManager.getBranch()), [
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
