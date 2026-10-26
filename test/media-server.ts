import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { buffer } from "node:stream/consumers";
import type { ExtensionFactory, ProviderConfig } from "@earendil-works/pi-coding-agent";

type Reply = { status: number; body: string } | { text: string; finishReason?: string };
type MediaRequest = { path: string; headers: IncomingHttpHeaders; chat?: { model: string; messages: unknown }; form?: FormData };

const chunk = (delta: Record<string, unknown>, finishReason: string | null) =>
	`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;

// An OpenAI-compatible server for media models. `/chat/completions` streams `reply`, `/audio/transcriptions` returns it
// as JSON, and `hold` keeps each response open until the client goes. `providerConfig` changes the provider "hebo".
export async function startMediaServer(providerConfig: ProviderConfig = {}) {
	const requests: MediaRequest[] = [];
	const state: { reply: Reply; hold: boolean } = { reply: { text: "media text" }, hold: false };
	const server = createServer(async (request, response) => {
		const body = await buffer(request);
		const path = request.url ?? "";
		const recorded: MediaRequest = { path, headers: request.headers };
		if (path.endsWith("/chat/completions")) recorded.chat = JSON.parse(body.toString());
		else
			recorded.form = await new Response(body, { headers: { "content-type": request.headers["content-type"] ?? "" } }).formData();
		requests.push(recorded);
		if (state.hold) return;
		const { reply } = state;
		if ("status" in reply) response.writeHead(reply.status, { "content-type": "application/json" }).end(reply.body);
		else if (!recorded.chat) response.end(JSON.stringify({ text: reply.text }));
		else response.end(`${chunk({ content: reply.text }, null)}${chunk({}, reply.finishReason ?? "stop")}data: [DONE]\n\n`);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
	// Pi's list has one "hebo" model, so other ids test the path for unknown models.
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
