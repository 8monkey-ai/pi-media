import type { MediaApi } from "./media-api.ts";
import { openaiCompletions } from "./openai-completions-api.ts";
import { openaiTranscriptions } from "./openai-transcriptions-api.ts";

const mediaApis: MediaApi[] = [openaiCompletions, openaiTranscriptions];

export const mediaApiNames = mediaApis.map(({ name }) => name);

// `readSettings` allows only the names in `mediaApiNames`, so the error is for a caller that skips that check.
export function mediaApi(name: string) {
	const api = mediaApis.find((candidate) => candidate.name === name);
	if (!api) throw new Error(`pi-media has no API "${name}"`);
	return api;
}
