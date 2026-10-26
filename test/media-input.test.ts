import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { ProviderConfig } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import { MP3_BYTES, MP3_PART, MP4_BYTES, PNG_BYTES, PNG_IMAGE } from "./fixtures.ts";
import { startMediaServer } from "./media-server.ts";
import { inputObserver, startSession } from "./session-harness.ts";

const AUDIO_MODEL = { provider: "hebo", id: "gpt-transcribe", api: "openai-transcriptions" };
const CHAT_MODEL = { provider: "hebo", id: "gpt-4.1-mini", api: "openai-completions" };
const TRANSCRIPT = "Transcript of a.mp3 · hebo/gpt-transcribe\n\nmedia text";
const FILES = {
	"a.mp3": MP3_BYTES,
	"b.mp3": MP3_BYTES,
	"voice.amr": "#!AMR\n\0\0\0\0",
	"report.pdf": "%PDF-1.4",
	"shot.png": PNG_BYTES,
	"clip.mp4": MP4_BYTES,
};

const servers: Array<() => void> = [];
after(() => {
	for (const close of servers) close();
});

async function startMediaSession(
	settings: Record<string, unknown>,
	{ mode, provider }: { mode?: "rpc"; provider?: ProviderConfig } = {},
) {
	const server = await startMediaServer(provider);
	servers.push(server.close);
	const { observer, inputs } = inputObserver();
	const started = await startSession([server.provider, extension, observer], {
		files: { "pi-media.json": JSON.stringify(settings), ...FILES },
		mode,
	});
	const notes = () =>
		started.session.sessionManager
			.getBranch()
			.flatMap((entry) => (entry.type === "custom_message" ? [{ content: entry.content, details: entry.details }] : []));
	const texts = () => notes().map(({ content }) => content);
	return { ...started, server, inputs, notes, texts };
}

// The payload that the faux main model gets for user messages of text only.
const textPayload = (...texts: string[]) => ({
	messages: texts.map((text) => ({ role: "user", content: [{ type: "text", text }] })),
});

const chatCall = (instruction: string, part: unknown) => [{ role: "user", content: [{ type: "text", text: instruction }, part] }];

test("sends an audio file to the transcription model and gives the main model the transcript after the user message", async () => {
	const { session, server, requests, customs, notes, settle } = await startMediaSession({ audioModel: AUDIO_MODEL });
	server.state.reply = { text: "OK, let's start." };
	await settle(session.prompt("listen to @a.mp3"));
	assert.equal(server.requests.length, 1);
	const [{ path, headers, form }] = server.requests;
	const file = form?.get("file");
	assert.ok(file instanceof File);
	assert.deepEqual([path, headers.authorization], ["/v1/audio/transcriptions", "Bearer test-key"]);
	const data = Buffer.from(await file.arrayBuffer()).toString("base64");
	assert.deepEqual([form?.get("model"), file.name, file.type, data], ["gpt-transcribe", "a.mp3", "audio/mpeg", "//uQRAAAAAA="]);
	assert.match(customs.join(), /Transcribing a\.mp3 with hebo\/gpt-transcribe…/);
	const transcript = "Transcript of a.mp3 · hebo/gpt-transcribe\n\nOK, let's start.";
	assert.deepEqual(notes(), [{ content: transcript, details: { error: false } }]);
	assert.deepEqual(requests[0].payload, textPayload("listen to @a.mp3", transcript));
});

// "gpt-4.1" is not in pi's list, so its call goes to the base URL of its provider.
test("puts the file part where the marker is in the payload of the media call, in the order of the mentions", async () => {
	const { session, server, texts, settle } = await startMediaSession({
		audioModel: { ...AUDIO_MODEL, api: "openai-completions" },
		documentModel: { ...CHAT_MODEL, id: "gpt-4.1" },
		imageModel: CHAT_MODEL,
	});
	await settle(session.prompt("@report.pdf and @a.mp3 and @shot.png"));
	assert.deepEqual(
		server.requests.map(({ chat }) => ({ model: chat?.model, messages: chat?.messages })),
		[
			{
				model: "gpt-4.1",
				messages: chatCall(
					"Give the full text of this document. In the place of each image or chart, give a description of the image or chart.",
					{ type: "file", file: { filename: "report.pdf", file_data: "data:application/pdf;base64,JVBERi0xLjQ=" } },
				),
			},
			{ model: "gpt-transcribe", messages: chatCall("Transcribe this audio word for word. Give only the transcript.", MP3_PART) },
			{
				model: "gpt-4.1-mini",
				messages: chatCall("Describe this image. Then give all text that is in the image, word for word.", {
					type: "image_url",
					image_url: { url: `data:image/png;base64,${PNG_IMAGE.data}` },
				}),
			},
		],
	);
	assert.deepEqual(texts(), [
		"Text of report.pdf · hebo/gpt-4.1\n\nmedia text",
		TRANSCRIPT,
		"Description of shot.png · hebo/gpt-4.1-mini\n\nmedia text",
	]);
});

test("sends the images that pi has and the mentioned images to the image model and none to the main model", async () => {
	const { session, server, requests, inputs, settle } = await startMediaSession({ imageModel: CHAT_MODEL });
	await settle(session.prompt("see @shot.png", { images: [{ type: "image", data: "AAAA", mimeType: "image/jpeg" }] }));
	const instruction = "Describe this image. Then give all text that is in the image, word for word.";
	assert.deepEqual(
		server.requests.map(({ chat }) => chat?.messages),
		["data:image/jpeg;base64,AAAA", `data:image/png;base64,${PNG_IMAGE.data}`].map((url) =>
			chatCall(instruction, { type: "image_url", image_url: { url } }),
		),
	);
	assert.deepEqual(inputs, [{ text: "see @shot.png", images: [] }]);
	assert.deepEqual(
		requests[0].payload,
		textPayload(
			"see @shot.png",
			"Description of image 1 · hebo/gpt-4.1-mini\n\nmedia text",
			"Description of shot.png · hebo/gpt-4.1-mini\n\nmedia text",
		),
	);
});

test("attaches a file of a type without a media model to the main model", async () => {
	const { session, server, requests, settle } = await startMediaSession({ audioModel: AUDIO_MODEL });
	await settle(session.prompt("watch @clip.mp4"));
	assert.deepEqual(server.requests, []);
	const video = { type: "video_url", video_url: { url: `data:video/mp4;base64,${MP4_BYTES.toString("base64")}` } };
	assert.deepEqual(requests[0].payload, {
		messages: [{ role: "user", content: [{ type: "text", text: "watch @clip.mp4" }, video] }],
	});
});

for (const [name, provider, authorization] of [
	["keeps the Authorization header of the provider", { headers: { Authorization: "Basic abc" } }, "Basic abc"],
	["sends no credentials for a provider that has no key in pi", { apiKey: undefined }, undefined],
] as const) {
	test(`${name} in the transcription request`, async () => {
		const { session, server, texts, settle } = await startMediaSession({ audioModel: AUDIO_MODEL }, { provider });
		await settle(session.prompt("listen to @a.mp3"));
		assert.deepEqual(
			server.requests.map(({ headers }) => headers.authorization),
			[authorization],
		);
		assert.deepEqual(texts(), [TRANSCRIPT]);
	});
}

const tooLarge = { status: 413, body: JSON.stringify({ error: { message: "File too large" } }) };
for (const { api, file = "a.mp3", reply = { text: "" }, reason } of [
	{ api: "openai-transcriptions", reply: tooLarge, reason: "413 File too large." },
	{ api: "openai-transcriptions", reply: { status: 502, body: "<html>Bad Gateway</html>" }, reason: "502 Bad Gateway." },
	{ api: "openai-completions", reply: tooLarge, reason: '413: {"message":"File too large"}.' },
	{
		api: "openai-completions",
		reply: { text: "The", finishReason: "length" },
		reason: "the output hit the model's length limit.",
	},
	{ api: "openai-completions", reason: "the model gave no text." },
	{ api: "openai-completions", file: "voice.amr", reason: "the openai-completions API cannot take audio/amr files." },
]) {
	test(`gives the error note "${reason}" for a call with the ${api} API`, async () => {
		const { session, server, notes, settle } = await startMediaSession({ audioModel: { ...AUDIO_MODEL, api } });
		server.state.reply = reply;
		await settle(session.prompt(`listen to @${file}`));
		const content = `pi-media: hebo/gpt-transcribe could not transcribe ${file}: ${reason}`;
		assert.deepEqual(notes(), [{ content, details: { error: true } }]);
	});
}

for (const api of ["openai-transcriptions", "openai-completions"]) {
	test(`stops the ${api} call and the remaining media calls of the message on Esc`, { timeout: 5000 }, async () => {
		const { session, server, customs, press, texts, waitFor, settle } = await startMediaSession({
			audioModel: { ...AUDIO_MODEL, api },
		});
		server.state.hold = true;
		const run = session.prompt("listen to @a.mp3 and @b.mp3");
		await waitFor(() => server.requests.length === 1 && customs.length === 1);
		press("\x1b");
		await settle(run);
		assert.equal(server.requests.length, 1);
		assert.equal(customs.length, 1);
		assert.deepEqual(
			texts(),
			["a.mp3", "b.mp3"].map((file) => `pi-media: hebo/gpt-transcribe could not transcribe ${file}: The user stopped the call.`),
		);
	});
}

test("calls the media model without a loader in rpc mode", async () => {
	const { session, customs, texts, settle } = await startMediaSession({ audioModel: AUDIO_MODEL }, { mode: "rpc" });
	await settle(session.prompt("listen to @a.mp3"));
	assert.deepEqual(customs, []);
	assert.deepEqual(texts(), [TRANSCRIPT]);
});

// Pi gives the main model one queued message per turn by default, so the main model answers the transcript alone before
// it gets the user message.
test("queues the transcript before a user message that waits in the queue", async () => {
	const { session, requests, settle, waitForCall } = await startMediaSession({ audioModel: AUDIO_MODEL });
	const run = session.prompt("first");
	await waitForCall();
	await session.prompt("listen to @a.mp3", { streamingBehavior: "steer" });
	await settle(run);
	assert.deepEqual(
		requests.map(({ payload }) => payload),
		[textPayload("first"), textPayload("first", TRANSCRIPT), textPayload("first", TRANSCRIPT, "listen to @a.mp3")],
	);
});

test("stores the transcript and does not call the media model again on later turns", async () => {
	const { session, server, requests, settle } = await startMediaSession({ audioModel: AUDIO_MODEL });
	await settle(session.prompt("listen to @a.mp3"));
	await settle(session.prompt("again"));
	assert.equal(server.requests.length, 1);
	assert.deepEqual(requests[1].payload, textPayload("listen to @a.mp3", TRANSCRIPT, "again"));
});
