import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Attachment } from "./media-entry.ts";

type MediaCall = {
	file: Attachment;
	provider: string;
	id: string;
	instruction: string;
	signal: AbortSignal;
};

// `name` is the `api` value of a media model setting. `read` throws an error with the reason when the call fails.
export type MediaApi = {
	name: string;
	read: (call: MediaCall, registry: ExtensionContext["modelRegistry"]) => Promise<string>;
};
