import assert from "node:assert/strict";
import { type Message, type Model, normalizeContext } from "@earendil-works/pi-ai";
import { stream } from "@earendil-works/pi-ai/api/openai-completions";

type ModelOptions = Pick<Model<"openai-completions">, "provider" | "id">;

const defaultModel = { provider: "openai", id: "gpt-4o" };

// Builds the Chat Completions payload with pi-ai's own converter. `onPayload` takes a copy of the payload and throws, so
// the request stops before any network call.
export async function chatPayload(messages: Message[], options: ModelOptions = defaultModel) {
	const model: Model<"openai-completions"> = {
		name: options.id,
		api: "openai-completions",
		baseUrl: "http://127.0.0.1:9",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 100,
		...options,
	};
	let payload: unknown;
	const onPayload = (params: unknown) => {
		payload = structuredClone(params);
		throw new Error("payload captured");
	};
	for await (const _ of stream(model, normalizeContext({ messages }), { apiKey: "test", onPayload }));
	assert.ok(payload);
	return payload as { messages: Record<string, unknown>[] };
}

export const text = (value: string) => ({ type: "text" as const, text: value });
