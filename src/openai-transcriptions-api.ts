import { basename } from "node:path";
import { isRecord } from "./is-record.ts";
import type { MediaApi } from "./media-api.ts";

// OpenAI-compatible servers give the reason in `error.message` of a JSON body.
async function failureReason(response: Response) {
	const body = await response.text();
	let message = body.trim() || response.statusText;
	try {
		const parsed: unknown = JSON.parse(body);
		if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === "string") message = parsed.error.message;
	} catch {}
	return `${response.status} ${message}`;
}

// A provider with `authHeader: true` has the Authorization header in its headers already. A header with the value null is
// a header that the provider removes.
function requestHeaders(apiKey: string | undefined, providerHeaders: Record<string, string | null>) {
	const headers = new Headers(
		Object.entries(providerHeaders).flatMap(([name, value]) => (value === null ? [] : [[name, value]])),
	);
	if (apiKey && !headers.has("authorization")) headers.set("authorization", `Bearer ${apiKey}`);
	return headers;
}

// Pi has no API for transcription models, so pi-media sends the request itself, with the credentials that pi has for the
// provider. Pi has no credentials for a provider without a key, such as a local server, so that request has none.
// Pi's HTTP dispatcher, and with it pi's HTTP idle timeout, applies to the global `fetch`.
export const openaiTranscriptions: MediaApi = {
	name: "openai-transcriptions",
	read: async ({ file, provider, id, signal }, registry) => {
		const auth = (await registry.getProviderAuth(provider))?.auth;
		const baseUrl = auth?.baseUrl ?? registry.getProvider(provider)?.baseUrl;
		if (!baseUrl) throw new Error(`provider "${provider}" has no base URL`);
		const form = new FormData();
		form.append("model", id);
		form.append("file", new Blob([Buffer.from(file.data, "base64")], { type: file.mimeType }), basename(file.path));
		const response = await fetch(`${baseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
			method: "POST",
			headers: requestHeaders(auth?.apiKey, auth?.headers ?? {}),
			body: form,
			signal,
		});
		if (!response.ok) throw new Error(await failureReason(response));
		const result: unknown = await response.json();
		if (!isRecord(result) || typeof result.text !== "string") throw new Error("the response has no text");
		return result.text;
	},
};
