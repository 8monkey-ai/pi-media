import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { rewrite } from "./chat-completions.ts";
import { carries } from "./file-parts.ts";
import { makeMarker } from "./marker.ts";
import type { MediaApi } from "./media-api.ts";

// A model that is not in pi's list, for example one typed in by the user, gets the base URL of its provider.
function chatModel(registry: ExtensionContext["modelRegistry"], provider: string, id: string): Model<"openai-completions"> {
	const known = registry.find(provider, id);
	if (known) return { ...known, api: "openai-completions" };
	return {
		id,
		name: id,
		api: "openai-completions",
		provider,
		baseUrl: registry.getProvider(provider)?.baseUrl ?? "",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 0,
		maxTokens: 0,
	};
}

// The file goes in a marker, and `rewrite` puts the file part where the marker is, as for the main model.
export const openaiCompletions: MediaApi = {
	name: "openai-completions",
	read: async ({ file, provider, id, instruction, signal }, registry) => {
		if (!carries(file.mimeType)) throw new Error(`the openai-completions API cannot take ${file.mimeType} files`);
		const content = [
			{ type: "text" as const, text: instruction },
			{ type: "text" as const, text: makeMarker("file", 0) },
		];
		const response = await registry.complete(
			chatModel(registry, provider, id),
			{ messages: [{ role: "user", content, timestamp: Date.now() }] },
			{ signal, onPayload: (payload) => rewrite(payload, () => file) },
		);
		if (response.stopReason === "error" || response.stopReason === "aborted") {
			throw new Error(response.errorMessage ?? response.stopReason);
		}
		if (response.stopReason === "length") throw new Error("the output hit the model's length limit");
		return response.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
	},
};
