import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { ExtensionFactory, ProviderConfig } from "@earendil-works/pi-coding-agent";

type Reply = { status: number; body: string } | { text: string; finishReason?: string };
type Transcription = { model: string; fileName: string; fileType: string; fileData: string };
type MediaRequest = {
	path: string;
	authorization: string | undefined;
	chat?: Record<string, unknown>;
	transcription?: Transcription;
};

const chunk = (delta: Record<string, unknown>, finishReason: string | null) =>
	`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;

async function readBody(request: IncomingMessage) {
	const chunks: Buffer[] = [];
	for await (const part of request) chunks.push(part);
	return Buffer.concat(chunks);
}

async function readTranscription(request: IncomingMessage, body: Buffer): Promise<Transcription> {
	const form = await new Request("http://local", {
		method: "POST",
		headers: { "content-type": request.headers["content-type"] ?? "" },
		body,
	}).formData();
	const file = form.get("file") as File;
	return {
		model: String(form.get("model")),
		fileName: file.name,
		fileType: file.type,
		fileData: Buffer.from(await file.arrayBuffer()).toString("base64"),
	};
}

// An OpenAI-compatible server for media models. `/chat/completions` streams the reply text, `/audio/transcriptions`
// returns it as JSON. `reply` makes the answer for each request; `hold` keeps the response open until the client goes.
// `providerConfig` changes the settings of provider "hebo".
export async function startMediaServer(providerConfig: ProviderConfig = {}) {
	const requests: MediaRequest[] = [];
	const state: { reply: (request: MediaRequest) => Reply; hold: boolean } = {
		reply: () => ({ text: "media text" }),
		hold: false,
	};
	const server = createServer(async (request, response) => {
		const body = await readBody(request);
		const path = request.url ?? "";
		const recorded: MediaRequest = { path, authorization: request.headers.authorization };
		if (path.endsWith("/chat/completions")) recorded.chat = JSON.parse(body.toString());
		if (path.endsWith("/audio/transcriptions")) recorded.transcription = await readTranscription(request, body);
		requests.push(recorded);
		if (state.hold) return;
		const reply = state.reply(recorded);
		if ("status" in reply) {
			response.writeHead(reply.status, { "content-type": "application/json" }).end(reply.body);
		} else if (recorded.chat) {
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.end(
				`${chunk({ role: "assistant", content: reply.text }, null)}${chunk({}, reply.finishReason ?? "stop")}data: [DONE]\n\n`,
			);
		} else {
			response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ text: reply.text }));
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
	// Registers the server as provider "hebo" with one chat model. Other model ids are not in pi's list.
	const provider: ExtensionFactory = (pi) => {
		pi.registerProvider("hebo", {
			baseUrl,
			apiKey: "test-key",
			api: "openai-completions",
			models: [
				{
					id: "gpt-4.1-mini",
					name: "GPT-4.1 mini",
					reasoning: false,
					input: ["text", "image"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 1000,
					maxTokens: 100,
				},
			],
			...providerConfig,
		});
	};
	const close = () => {
		server.closeAllConnections();
		server.close();
	};
	return { requests, state, provider, close };
}
