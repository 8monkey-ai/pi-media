import assert from "node:assert/strict";
import { type AssistantMessage, type Message, type Model, normalizeContext, type ToolResultMessage } from "@earendil-works/pi-ai";
import { stream } from "@earendil-works/pi-ai/api/openai-completions";

type ModelOptions = Pick<Model<"openai-completions">, "provider" | "id"> & Pick<Partial<Model<"openai-completions">>, "compat">;

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

// An earlier assistant turn of the default model.
function assistant(content: AssistantMessage["content"]): Message {
	return {
		role: "assistant",
		content,
		api: "openai-completions",
		provider: defaultModel.provider,
		model: defaultModel.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: 1,
	};
}

export const pdfNote = "Read PDF file [application/pdf]: /tmp/x/report.pdf";

export function readResult(toolCallId: string, content: ToolResultMessage["content"]): ToolResultMessage {
	return { role: "toolResult", toolCallId, toolName: "read", content, isError: false, timestamp: 1 };
}

// A user prompt, an assistant message that calls `read` once for each result, and the results.
export function readTurn(...results: ToolResultMessage[]): Message[] {
	const calls = results.map(({ toolCallId }) => ({
		type: "toolCall" as const,
		id: toolCallId,
		name: "read",
		arguments: { path: "/tmp/x/report.pdf" },
	}));
	return [{ role: "user", content: "read the file", timestamp: 1 }, assistant(calls), ...results];
}
