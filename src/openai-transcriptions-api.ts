import { basename } from "node:path";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { isRecord } from "./is-record.ts";
import type { Attachment } from "./media-entry.ts";

// OpenAI-compatible servers give the reason in `error.message` of a JSON body. Other bodies, such as the HTML page of a
// proxy, go in no note.
async function failureReason(response: Response) {
	try {
		const { message } = JSON.parse(await response.text()).error;
		if (typeof message === "string") return `${response.status} ${message}`;
	} catch {}
	return `${response.status} ${response.statusText}`;
}

// Pi has no API for transcription models, so pi-media sends the request itself, with the credentials that pi has for the
// provider. Pi has no credentials for a provider without a key, such as a local server, so that request has none.
// Pi's HTTP dispatcher, and with it pi's HTTP idle timeout, applies to the global `fetch`.
export async function transcribe(file: Attachment, provider: string, id: string, registry: ModelRegistry, signal: AbortSignal) {
	const auth = (await registry.getProviderAuth(provider))?.auth;
	const baseUrl = auth?.baseUrl ?? registry.getProvider(provider)?.baseUrl;
	if (!baseUrl) throw new Error(`provider "${provider}" has no base URL`);
	// A provider with `authHeader: true` has the Authorization header in its headers already. A header with the value null
	// is a header that the provider removes.
	const headers = new Headers(
		Object.entries(auth?.headers ?? {}).flatMap(([name, value]) => (value === null ? [] : [[name, value]])),
	);
	if (auth?.apiKey && !headers.has("authorization")) headers.set("authorization", `Bearer ${auth.apiKey}`);
	const form = new FormData();
	form.append("model", id);
	form.append("file", new Blob([Buffer.from(file.data, "base64")], { type: file.mimeType }), basename(file.path));
	const url = `${baseUrl.replace(/\/$/, "")}/audio/transcriptions`;
	const response = await fetch(url, { method: "POST", headers, body: form, signal });
	if (!response.ok) throw new Error(await failureReason(response));
	const result: unknown = await response.json();
	if (!isRecord(result) || typeof result.text !== "string") throw new Error("the response has no text");
	return result.text;
}
